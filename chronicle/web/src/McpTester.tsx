import { Anchored } from './Popover.tsx';
import { useEffect, useId, useRef, useState } from 'react';
import { McpTestState, Operation_McpTestTools, Operation_StartMcpTest, Operation_ReadMcpTest, Operation_CancelMcpTest, Result_McpTestTools, Result_McpTestRun, type McpTestCatalog, type McpTestEvent, type McpTestSnapshot } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { type ManagerStats } from './transport/types.ts';
import { randomUUID } from './uuid.ts';
import { scalarUtf8Bytes } from './completion.ts';
import { appendMcpPage, traceItems, traceRows, validateMcpPage, MCP_EVENT_PAGE_LIMIT, type TraceItem, type TraceRow } from './mcp-trace.ts';
import { Glyph } from './Glyph.tsx';
import { ToolCatalog } from './ToolCatalog.tsx';
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
  const authorityEpoch = useRef(0), startLock = useRef(false), readLock = useRef(false), cancelLock = useRef(false), readPump = useRef<() => void>(() => {}), pumpTimer = useRef<number | null>(null), disposed = useRef(false);
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
  // The pump outlives its effect: a dependency change only kicks it. A read in flight is judged by the live key, handle and
  // authority epoch when its reply arrives, never by the effect run that started it, so a re-render cannot discard the reply
  // and restart the cursor.
  readPump.current = () => {
    if (disposed.current || owner === null || handle === null || stats.activeId === null || startLock.current || readLock.current) return;
    if (handle.state === McpTestState.AuthorizationLost || handle.state === McpTestState.Expired) return;
    readLock.current = true; const requestAuthority = authorityEpoch.current;
    const cursor = data.current.key === key ? data.current.events.at(-1)?.sequence ?? 0n : 0n;
    let discarded = false;
    const superseded = () => discarded = disposed.current || live.current !== key || authorityEpoch.current !== requestAuthority || handles.current.get(owner) !== handle;
    void read(connection, new Operation_ReadMcpTest(handle.instanceId, handle.runId, cursor, MCP_EVENT_PAGE_LIMIT), result => result instanceof Result_McpTestRun ? result.result : null).then(page => {
      if (superseded()) return;
      accept(page, handle, key);
      pumpTimer.current = window.setTimeout(() => readPump.current(), page.hasMore ? 0 : MCP_POLL_MS);
    }).catch((cause: unknown) => {
      if (superseded()) return;
      handle.state = 'Uncertain';
      erase(`${cause instanceof Error ? cause.message : 'Run read failed'}. Outcome unknown; no Start will be replayed. Retain the original instance and run IDs.`);
      // Explicit read retry avoids treating a rotated/changed registry as evidence of non-execution.
    }).finally(() => { readLock.current = false; if (discarded) readPump.current(); });
  };
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; if (pumpTimer.current !== null) window.clearTimeout(pumpTimer.current); }; }, []);
  useEffect(() => {
    if (pumpTimer.current !== null) { window.clearTimeout(pumpTimer.current); pumpTimer.current = null; }
    readPump.current();
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
      handles.current.set(owner, admitted); setVersion(n => n + 1); const next: Display = { key, catalog, events: [], error: null, observedAt: null, state: 'Uncertain' }; data.current = next; setDisplay(next);
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
  const current: Display = display.key === key ? display : { key, catalog: null, events: [], error: null, state: handle === null ? null : 'Uncertain', observedAt: null };
  return { ...current, handle, prompt: display.key === key ? prompt : '', setPrompt, starting, cancelling, connected: stats.activeId !== null, run, cancel, clear, retryRead: () => setPollRevision(n => n + 1) };
}
export type McpTesterState = ReturnType<typeof useMcpTester>;
const TRACE_FOLD_LINES = 12;
const STATUS_CLASS: Readonly<Record<McpTestState | 'Uncertain', string>> = {
  [McpTestState.Queued]: 'status-run', [McpTestState.Running]: 'status-run', [McpTestState.Complete]: 'status-ok', [McpTestState.Failed]: 'status-danger',
  [McpTestState.Cancelled]: 'status-idle', [McpTestState.AuthorizationLost]: 'status-danger', [McpTestState.Expired]: 'status-danger', Uncertain: 'status-warn',
};
/** Literal trace text: long output keeps its first lines until the reader asks for all of it. */
function TraceText({ item, label }: { item: TraceItem; label: string }) {
  const [all, setAll] = useState(false);
  if (item.text === null) return <p className="xs muted" role="status">Receiving complete item · {item.received} / {item.total} parts. No partial item is presented as complete.</p>;
  const lines = item.text.split('\n'), folded = !all && lines.length > TRACE_FOLD_LINES;
  return <div className="mcp-text"><div className="xs muted">{label}</div><pre className="code-block">{folded ? lines.slice(0, TRACE_FOLD_LINES).join('\n') : item.text}</pre>
    {folded && <p className="xs muted">… {lines.length - TRACE_FOLD_LINES} more lines · <button type="button" className="link-button" onClick={() => setAll(true)}>Show all</button></p>}</div>;
}
function ToolRow({ row, open }: { row: Extract<TraceRow, { kind: 'tool' }>; open: boolean }) {
  const args = row.call?.text;
  return <details className="mcp-call" open={open} data-trace-item={row.key}>
    <summary><span className="mcp-call-tool">{row.tool ?? 'Tool result'}</span><code className="mcp-call-args">{args === undefined ? 'arguments not received' : args === null ? 'receiving arguments…' : args.replace(/\s+/g, ' ')}</code><span className="mcp-call-meta">call {row.callId}</span></summary>
    <div className="mcp-call-body">
      {row.call !== null && <TraceText item={row.call} label="Arguments"/>}
      {row.result === null ? <p className="xs muted">No result yet.</p> : <TraceText item={row.result} label="Result"/>}
    </div>
  </details>;
}
function Trace({ rows }: { rows: readonly TraceRow[] }) {
  const calls = rows.filter(row => row.kind === 'tool');
  return <>{calls.length > 0 && <div className="mcp-tool-group">{calls.map((row, index) => <ToolRow key={row.key} row={row} open={index === 0}/>)}</div>}{rows.map(row => row.kind === 'tool' ? null
    : <article key={row.key} className="mcp-response" data-trace-item="response"><div className="mcp-response-head">Response</div>
      {row.response.text === null ? <p className="xs muted" role="status">Receiving complete item · {row.response.received} / {row.response.total} parts. No partial item is presented as complete.</p> : <div className="mcp-response-text">{row.response.text}</div>}</article>)}</>;
}
export function McpTester({ tester }: { tester: McpTesterState }) {
  const [acknowledged, setAcknowledged] = useState(false), promptId = useId();
  useEffect(() => setAcknowledged(false), [tester.handle?.runId, tester.state]);
  const catalog = tester.catalog, handle = tester.handle, state = tester.state ?? 'Uncertain';
  const running = handle !== null && active(handle.state), blocked = tester.starting || tester.cancelling || !tester.connected || running;
  let bytes: number | null = null; try { bytes = scalarUtf8Bytes(tester.prompt); } catch { /* Invalid scalar input is explained at the boundary below. */ }
  const rows = traceRows(traceItems(tester.events));
  return <main className="page page-narrow stack-lg" aria-label="MCP tester">
    <div className="page-head">
      <div><h1 className="page-title">MCP tester</h1><p className="page-sub">Run one fresh prompt against the search tools exactly as an MCP client would, and inspect the trace.</p></div>
      {catalog !== null && <Anchored className="" buttonClassName="btn" buttonState={undefined} ariaLabel={undefined} describedBy={undefined} panel="dialog" panelClassName="popover mcp-popover" panelLabel={undefined} label={<><Glyph name="info"/>Runtime limits</>}>
        <p className="xs muted">Instance <code>{catalog.instanceId}</code></p>
        <dl className="dl xs mcp-limits">{Object.entries(catalog.limits.toJSON()).map(([name, value]) => <div key={name} className="mcp-limit"><dt>{name}</dt><dd>{String(value)}</dd></div>)}</dl>
      </Anchored>}
    </div>
    {tester.error !== null && <div className="notice notice-danger" role="alert"><Glyph name="alert"/><div>{tester.error}</div></div>}
    <div className={catalog === null ? 'mcp mcp-single' : 'mcp'}>
      {catalog !== null && <section className="card mcp-tools" aria-label="Current MCP test catalog">
        <div className="card-head"><h2>Tool catalog</h2><span className="count">{catalog.tools.length}</span></div>
        <div className="card-body"><dl className="dl xs"><dt>Model</dt><dd className="mono">{catalog.model}</dd><dt>Revision</dt><dd className="mono">{catalog.modelRevision}</dd><dt>Max output</dt><dd>{catalog.maximumOutputTokens} tokens</dd><dt>Reasoning</dt><dd>{catalog.reasoningPolicy}</dd></dl></div>
        <div className="divider"/>
        <ToolCatalog key={catalog.instanceId} tools={catalog.tools}/>
      </section>}
      <div className="stack-lg">
        <section className="card">
          <div className="card-head"><h2>Fresh prompt</h2><span className="xs muted">{bytes === null ? 'Invalid Unicode scalar input' : `${bytes} / ${MAX_PROMPT_BYTES} UTF-8 bytes`}</span></div>
          <form className="card-body stack" onSubmit={event => { event.preventDefault(); void tester.run(); }}>
            <textarea id={promptId} className="textarea" value={tester.prompt} onChange={event => tester.setPrompt(event.target.value)} rows={4} disabled={tester.starting} aria-label="Fresh prompt" placeholder="Ask something the archive should be able to answer, e.g. “Where did we decide the retry cap for the uploader?”"/>
            <div className="form-actions">
              {running
                ? <button type="button" className="btn btn-danger-quiet" disabled={tester.cancelling || tester.starting || !tester.connected} onClick={() => void tester.cancel()}>{tester.cancelling ? 'Requesting cancel…' : 'Request cancellation'}</button>
                : <button type="submit" className="btn btn-primary" disabled={blocked || bytes === null || bytes > MAX_PROMPT_BYTES || tester.prompt.trim().length === 0}><Glyph name="play"/>{tester.starting ? 'Submitting once…' : 'Run fresh prompt'}</button>}
              <Anchored className="context-help mcp-run-help" buttonClassName="btn btn-ghost btn-icon" buttonState={undefined} ariaLabel="About running prompts" describedBy={undefined} panel="dialog" panelClassName="popover" panelLabel={undefined} label={<Glyph name="info"/>}>
                <p>Run incurs model cost and may send authorized source data to the declared model through read-only tools. Each run uses only this prompt and a fresh tool catalog; no prior run is added. Starts are never replayed automatically.</p>
                <p>Cancellation cannot recall data or guarantee the provider stopped or incurred no cost. Traces are temporary and reauthorized while displayed.</p>
              </Anchored>
              <span className="xs muted">Every run starts a new instance; nothing is remembered between runs.</span>
            </div>
          </form>
        </section>
        {handle !== null && <section className="card" aria-label="MCP run controls">
          <div className="card-head"><h2>Run</h2><span className={`status ${STATUS_CLASS[state]}`} data-run-state={state}>{state}</span>
            <button type="button" className="btn btn-sm" disabled={tester.starting || !tester.connected} onClick={tester.retryRead}>Read original run</button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={tester.starting || tester.cancelling || (running && !acknowledged)} onClick={() => tester.clear(acknowledged)}>Clear run and trace</button>
            <Anchored className="" buttonClassName="btn btn-sm btn-ghost btn-icon" buttonState={undefined} ariaLabel="Run identifiers" describedBy={undefined} panel="dialog" panelClassName="popover mcp-popover" panelLabel={undefined} label={<Glyph name="more"/>}>
              <dl className="dl dl-stack xs"><dt>Original instance</dt><dd className="mono">{handle.instanceId}</dd><dt>Run</dt><dd className="mono">{handle.runId}</dd>{tester.observedAt !== null && <><dt>Observed</dt><dd>{tester.observedAt}</dd></>}</dl>
            </Anchored>
          </div>
          <div className="card-body stack-sm">
            {running && <p className="xs muted">Cancellation cannot guarantee that the provider stopped or incurred no cost.</p>}
            {running && <label className="check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>I acknowledge that this run may still be active or have incurred cost. Clearing loses its controls; a new Run may incur additional cost.</label>}
            <section className="mcp-trace stack-sm" aria-label="MCP test trace" aria-live="polite"><Trace rows={rows}/></section>
            {running && <div className="list-foot"><span className="spinner" aria-hidden="true"/>Waiting for the model…</div>}
          </div>
        </section>}
      </div>
    </div>
  </main>;
}
