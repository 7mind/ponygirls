import { useEffect, useId, useRef, useState } from 'react';
import { McpTestState, Operation_McpTestTools, Operation_StartMcpTest, Operation_ReadMcpTest, Operation_CancelMcpTest, Result_McpTestTools, Result_McpTestRun, type McpTestCatalog, type McpTestEvent, type McpTestSnapshot } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { type ManagerStats } from './transport/types.ts';
import { randomUUID } from './uuid.ts';
import { scalarUtf8Bytes } from './completion.ts';
import { appendMcpPage, traceItems, validateMcpPage, MCP_EVENT_PAGE_LIMIT } from './mcp-trace.ts';
import { ErrorNotice } from './App.tsx';
import './mcp-tester.css';
const MCP_POLL_MS = 2_000, MAX_PROMPT_BYTES = 16 * 1024;
interface RunHandle { instanceId: string; runId: string; catalog: McpTestCatalog; state: McpTestState | 'Uncertain' }
interface Display { key: string; catalog: McpTestCatalog | null; events: McpTestEvent[]; error: string | null; observedAt: string | null; state: McpTestState | 'Uncertain' | null }
function validateCatalog(catalog: McpTestCatalog): McpTestCatalog {
  if (!catalog.instanceId || !catalog.model || !catalog.modelRevision || !catalog.reasoningPolicy || !Number.isInteger(catalog.maximumOutputTokens) || catalog.maximumOutputTokens <= 0 || catalog.tools.length === 0 || new Set(catalog.tools.map(tool => tool.name)).size !== catalog.tools.length) throw new Error('Invalid MCP test catalog.');
  for (const [name, value] of Object.entries(catalog.limits.toJSON())) if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new Error(`Invalid declared MCP limit: ${name}.`);
  for (const tool of catalog.tools) { if (!tool.name) throw new Error('Invalid MCP tool definition.'); JSON.parse(tool.inputSchemaJson); }
  return catalog;
}
function active(state: McpTestState | 'Uncertain') { return state === 'Uncertain' || state === McpTestState.Queued || state === McpTestState.Running; }
export function useMcpTester(connection: ChronicleConnection, stats: ManagerStats, owner: string | null, visible: boolean) {
  const [epoch, setEpoch] = useState(0), [version, setVersion] = useState(0), [pollRevision, setPollRevision] = useState(0), [prompt, setPrompt] = useState(''), [starting, setStarting] = useState(false), [cancelling, setCancelling] = useState(false);
  const key = JSON.stringify([owner, stats.generation, stats.activeId, epoch]), live = useRef(key); live.current = key;
  const handles = useRef(new Map<string, RunHandle>()), handle = owner === null ? null : handles.current.get(owner) ?? null;
  const [display, setDisplay] = useState<Display>({ key, catalog: null, events: [], error: null, observedAt: null, state: null });
  const data = useRef(display); data.current = display;
  const authorityEpoch = useRef(0), startLock = useRef(false), readLock = useRef(false), cancelLock = useRef(false), readPump = useRef<() => void>(() => {});
  function erase(message: string | null) { authorityEpoch.current++; if (owner !== null) { const run = handles.current.get(owner); if (run !== undefined) run.state = 'Uncertain'; } setPrompt(''); const next: Display = { key, catalog: null, events: [], error: message, observedAt: null, state: owner !== null && handles.current.has(owner) ? 'Uncertain' : null }; data.current = next; setDisplay(next); }
  useEffect(() => connection.onInvalidate(() => {
    live.current = ''; authorityEpoch.current++; setPrompt(''); setDisplay(previous => ({ ...previous, key: '', catalog: null, events: [], error: null, observedAt: null, state: 'Uncertain' }));
    for (const value of handles.current.values()) value.state = 'Uncertain';
    setEpoch(n => n + 1);
  }), [connection]);
  useEffect(() => {
    setPrompt(''); setDisplay({ key, catalog: null, events: [], error: null, observedAt: null, state: handle === null ? null : 'Uncertain' });
  }, [connection, key]);
  useEffect(() => {
    if (!visible || owner === null || stats.activeId === null) return;
    let mounted = true; const requestAuthority = authorityEpoch.current;
    void read(connection, new Operation_McpTestTools(), result => result instanceof Result_McpTestTools ? validateCatalog(result.result) : null).then(catalog => { if (mounted && live.current === key && authorityEpoch.current === requestAuthority) setDisplay(current => ({ ...current, key, catalog, error: null })); }).catch((cause: unknown) => { if (mounted && live.current === key) { erase(cause instanceof Error ? cause.message : 'MCP catalog unavailable'); } });
    return () => { mounted = false; };
  }, [connection, key, visible]);
  function accept(page: McpTestSnapshot, run: RunHandle, requestKey: string) {
    if (live.current !== requestKey || owner === null || handles.current.get(owner) !== run) return;
    validateMcpPage(page, run.instanceId, run.runId, run.catalog.limits);
    if (page.state === McpTestState.AuthorizationLost || page.state === McpTestState.Expired || page.state === McpTestState.Cancelled) {
      authorityEpoch.current++; run.state = page.state; setPrompt(''); const next: Display = { key, catalog: null, events: [], error: page.failure?.message ?? `Run ${page.state}; private trace erased.`, state: page.state, observedAt: page.observedAt }; data.current = next; setDisplay(next); return;
    }
    const previous = data.current.key === key ? data.current.events : [], events = appendMcpPage(previous, page, run.instanceId, run.runId, run.catalog.limits);
    run.state = page.state;
    const next: Display = { key, catalog: data.current.key === key ? data.current.catalog : null, events, error: page.failure === undefined ? null : `${page.failure.code}: ${page.failure.message}`, observedAt: page.observedAt, state: page.state };
    data.current = next; setDisplay(next);
  }
  useEffect(() => {
    let mounted = true, timer: number | null = null;
    readPump.current = () => {
      if (!mounted || owner === null || handle === null || stats.activeId === null || startLock.current || readLock.current) return;
      if (handle.state === McpTestState.AuthorizationLost || handle.state === McpTestState.Expired) return;
      readLock.current = true; const requestAuthority = authorityEpoch.current;
      const cursor = data.current.key === key ? data.current.events.at(-1)?.sequence ?? 0n : 0n;
      void read(connection, new Operation_ReadMcpTest(handle.instanceId, handle.runId, cursor, MCP_EVENT_PAGE_LIMIT), result => result instanceof Result_McpTestRun ? result.result : null).then(page => {
        if (!mounted || live.current !== key || authorityEpoch.current !== requestAuthority || handles.current.get(owner) !== handle) return;
        accept(page, handle, key);
        timer = window.setTimeout(() => readPump.current(), page.hasMore ? 0 : MCP_POLL_MS);
      }).catch((cause: unknown) => {
        if (!mounted || live.current !== key || authorityEpoch.current !== requestAuthority || handles.current.get(owner) !== handle) return;
        handle.state = 'Uncertain';
        erase(`${cause instanceof Error ? cause.message : 'Run read failed'}. Outcome unknown; no Start will be replayed. Retain the original instance and run IDs.`);
        // Explicit read retry avoids treating a rotated/changed registry as evidence of non-execution.
      }).finally(() => { readLock.current = false; if (!mounted) readPump.current(); });
    };
    readPump.current();
    return () => { mounted = false; if (timer !== null) window.clearTimeout(timer); };
  }, [connection, key, handle?.instanceId, handle?.runId, version, pollRevision, starting]);
  async function run() {
    if (owner === null || stats.activeId === null || startLock.current || cancelLock.current || (handle !== null && active(handle.state))) return;
    const requestKey = key, requestAuthority = authorityEpoch.current, text = prompt;
    try { const bytes = scalarUtf8Bytes(text); if (text.trim().length === 0 || bytes > MAX_PROMPT_BYTES) throw new Error('Enter a nonempty fresh prompt of at most 16384 UTF-8 bytes.'); }
    catch (cause) { setDisplay(current => ({ ...current, error: cause instanceof Error ? cause.message : 'Invalid prompt' })); return; }
    startLock.current = true; setStarting(true); setDisplay({ key, catalog: null, events: [], error: null, observedAt: null, state: null });
    let admitted: RunHandle | null = null;
    try {
      const catalog = await read(connection, new Operation_McpTestTools(), result => result instanceof Result_McpTestTools ? validateCatalog(result.result) : null);
      if (live.current !== requestKey || authorityEpoch.current !== requestAuthority) return;
      if (scalarUtf8Bytes(text) > catalog.limits.maximumPromptBytes) throw new Error('Prompt exceeds the current catalog limit.');
      const runId = randomUUID(crypto); admitted = { instanceId: catalog.instanceId, runId, catalog, state: 'Uncertain' };
      handles.current.set(owner, admitted); setVersion(n => n + 1); setDisplay({ key, catalog, events: [], error: null, observedAt: null, state: 'Uncertain' });
      const result = await connection.request(new Operation_StartMcpTest(catalog.instanceId, runId, text), { mutation: false, receiptId: null, delivery: 'once' });
      if (live.current !== requestKey || authorityEpoch.current !== requestAuthority) return;
      if (!(result instanceof Result_McpTestRun)) throw new Error('Unverified MCP start response.');
      accept(result.result, admitted, requestKey); setPrompt('');
    } catch (cause) {
      if (live.current !== requestKey || authorityEpoch.current !== requestAuthority) return;
      const message = cause instanceof Error ? cause.message : 'MCP test failed';
      if (admitted === null) erase(`Catalog preflight failed: ${message}. Start was not submitted.`);
      else {
        admitted.state = 'Uncertain'; erase(`${message}. Start delivery or admission is uncertain; it may have incurred cost. No automatic Start/model retry. Read the original run or explicitly acknowledge uncertainty before clearing.`);
      }
    } finally { startLock.current = false; setStarting(false); }
  }
  async function cancel() {
    if (owner === null || handle === null || stats.activeId === null || cancelLock.current) return;
    const requestKey = key, requestAuthority = authorityEpoch.current; cancelLock.current = true; setCancelling(true);
    try {
      const page = await read(connection, new Operation_CancelMcpTest(handle.instanceId, handle.runId), result => result instanceof Result_McpTestRun ? result.result : null);
      if (live.current === requestKey && authorityEpoch.current === requestAuthority && handles.current.get(owner) === handle) {
        // Cancel snapshots may repeat earlier events; read from the existing cursor to reconcile completion.
        validateMcpPage(page, handle.instanceId, handle.runId, handle.catalog.limits);
        if (page.state === McpTestState.AuthorizationLost || page.state === McpTestState.Expired || page.state === McpTestState.Cancelled) accept(page, handle, requestKey);
        setPollRevision(n => n + 1);
      }
    } catch (cause) { if (live.current === requestKey && authorityEpoch.current === requestAuthority && handles.current.get(owner) === handle) { handle.state = 'Uncertain'; erase(`${cause instanceof Error ? cause.message : 'Cancellation failed'}. Cancellation is not proof that the provider stopped or no cost was incurred.`); } }
    finally { cancelLock.current = false; setCancelling(false); }
  }
  function clear(acknowledged: boolean) {
    if (owner === null || handle === null || starting || cancelling) return;
    if (active(handle.state) && !acknowledged) return;
    handles.current.delete(owner); setPrompt(''); erase(null); setVersion(n => n + 1);
  }
  const current = display.key === key ? display : { key, catalog: null, events: [], error: null, state: handle === null ? null : 'Uncertain', observedAt: null };
  return { ...current, handle, prompt: display.key === key ? prompt : '', setPrompt, starting, cancelling, connected: stats.activeId !== null, run, cancel, clear, retryRead: () => setPollRevision(n => n + 1) };
}
export type McpTesterState = ReturnType<typeof useMcpTester>;
export function McpTester({ tester }: { tester: McpTesterState }) {
  const [acknowledged, setAcknowledged] = useState(false), promptId = useId();
  useEffect(() => setAcknowledged(false), [tester.handle?.runId, tester.state]);
  const catalog = tester.catalog, handle = tester.handle;
  const blocked = tester.starting || tester.cancelling || !tester.connected || (handle !== null && active(handle.state));
  let bytes: number | null = null; try { bytes = scalarUtf8Bytes(tester.prompt); } catch { /* Invalid scalar input is explained at the boundary below. */ }
  return <main className="management-page mcp-tester"><h1>Fresh-prompt MCP tester</h1><p>Each explicit Run starts empty model history using only this prompt and the current server tool catalog. Read-only tools can expose authorized source data to the declared model. Run is cost-bearing. Nothing is automatically replayed, persisted or added to a later prompt.</p>
    {tester.error !== null && <ErrorNotice>{tester.error}</ErrorNotice>}
    {catalog !== null && <section className="management-section" aria-label="Current MCP test catalog"><h2>Declared runtime and actual tools</h2><p>Model <code>{catalog.model}</code> · revision <code>{catalog.modelRevision}</code> · maximum output tokens {catalog.maximumOutputTokens} · reasoning {catalog.reasoningPolicy}</p><p className="tiny">Instance <code>{catalog.instanceId}</code>. A fresh catalog is requested before every explicit Run; old active runs retain their original instance.</p><dl className="goal50-settings">{Object.entries(catalog.limits.toJSON()).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{String(value)}</dd></div>)}</dl><details><summary>Actual tool catalog ({catalog.tools.length})</summary>{catalog.tools.map(tool => <details key={tool.name}><summary>{tool.name}</summary><p>{tool.description}</p><pre>{tool.inputSchemaJson}</pre></details>)}</details></section>}
    <form onSubmit={event => { event.preventDefault(); void tester.run(); }}><label htmlFor={promptId}>Fresh prompt</label><textarea id={promptId} value={tester.prompt} onChange={event => tester.setPrompt(event.target.value)} rows={5} disabled={tester.starting}/><p className="tiny">{bytes === null ? 'Invalid Unicode scalar input' : `${bytes} / ${MAX_PROMPT_BYTES} UTF-8 bytes`}. Maximum context, source, result, trace and execution limits are declared above; limit errors are explicit, never silently truncated.</p><button className="primary" disabled={blocked || bytes === null || bytes > MAX_PROMPT_BYTES || tester.prompt.trim().length === 0}>{tester.starting ? 'Submitting once…' : 'Run fresh prompt'}</button></form>
    {handle !== null && <section className="management-section" aria-label="MCP run controls"><h2>Run {tester.state ?? 'Uncertain'}</h2><p className="tiny">Original instance <code>{handle.instanceId}</code><br/>Run <code>{handle.runId}</code>{tester.observedAt !== null && <><br/>Observed {tester.observedAt}</>}</p><p className="tiny">Controls and run identity survive navigation in this tab. Cancellation cannot recall submitted data, prove that the provider stopped, or prove zero cost. Terminal traces are reauthorized while displayed and expire after the server-declared retention (normally 600 seconds).</p><div className="button-row"><button disabled={tester.starting || !tester.connected} onClick={tester.retryRead}>Read original run</button><button disabled={tester.cancelling || tester.starting || !tester.connected} onClick={() => void tester.cancel()}>{tester.cancelling ? 'Requesting cancel…' : 'Request cancellation'}</button></div>{active(handle.state) && <label className="check-label"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>I acknowledge that this run may still be active or have incurred cost. Clearing loses its controls; a new Run may incur additional cost.</label>}<button disabled={tester.starting || tester.cancelling || (active(handle.state) && !acknowledged)} onClick={() => tester.clear(acknowledged)}>Clear run and trace</button></section>}
    <section className="mcp-trace" aria-label="MCP test trace" aria-live="polite">{traceItems(tester.events).map(item => <article key={item.key}><h3>{item.title}</h3>{item.text === null ? <p role="status">Receiving complete item · {item.received} / {item.total} parts. No partial item is presented as complete.</p> : <pre>{item.text}</pre>}</article>)}</section>
  </main>;
}
