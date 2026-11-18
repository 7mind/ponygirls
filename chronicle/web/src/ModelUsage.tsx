import { useEffect, useRef, useState } from 'react';
import { ModelPurpose, Operation_ModelUsage, Result_ModelUsage, type ModelUsageResult, type TokenRateWindow, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
import { validateModelUsage } from './model-usage.ts';
import { Anchored } from './Popover.tsx';
import { Glyph } from './Glyph.tsx';
import { clockTime } from './activity/time.tsx';
const USAGE_POLL_MS = 4_000;
const purposes = [ModelPurpose.Annotation, ModelPurpose.DocumentEmbedding, ModelPurpose.QueryEmbedding, ModelPurpose.McpTest] as const;
const PURPOSE_LABELS: Readonly<Record<ModelPurpose, string>> = { [ModelPurpose.Annotation]: 'Annotation', [ModelPurpose.DocumentEmbedding]: 'Document embedding', [ModelPurpose.QueryEmbedding]: 'Query embedding', [ModelPurpose.McpTest]: 'MCP test' };
const RATE_DIGITS = 3;

export interface ModelUsageState { data: ModelUsageResult | null; error: string | null }
/**
 * Completed-call usage, read while `enabled` and again USAGE_POLL_MS after each read settles (a slow read is never
 * overlapped). A failed read or a security change erases the previous sample.
 */
export function useModelUsage(connection: ChronicleConnection, stats: ManagerStats, user: UserInfo, enabled: boolean): ModelUsageState {
  const [epoch, setEpoch] = useState(0), [snapshot, setSnapshot] = useState<{ key: string; data: ModelUsageResult } | null>(null), [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([user.id, stats.generation, stats.activeId, epoch]), current = useRef(key); current.current = key;
  const busy = useRef(false), kick = useRef<() => void>(() => {});
  useEffect(() => connection.onInvalidate(() => { setSnapshot(null); setError(null); current.current = ''; setEpoch(n => n + 1); }), [connection]);
  useEffect(() => {
    let mounted = true, timer: number | null = null;
    setError(null);
    kick.current = () => {
      if (!mounted || !enabled || stats.activeId === null || busy.current) return;
      busy.current = true;
      void read(connection, new Operation_ModelUsage(), result => result instanceof Result_ModelUsage ? validateModelUsage(result.result) : null).then(data => { if (mounted && current.current === key) { setSnapshot({ key, data }); setError(null); } }).catch((cause: unknown) => { if (mounted && current.current === key) { setSnapshot(null); setError(cause instanceof Error ? cause.message : 'Usage unavailable'); } }).finally(() => {
        busy.current = false;
        if (mounted) timer = window.setTimeout(() => kick.current(), USAGE_POLL_MS); else kick.current();
      });
    };
    kick.current();
    return () => { mounted = false; if (timer !== null) window.clearTimeout(timer); };
  }, [connection, key, enabled]);
  return { data: snapshot !== null && snapshot.key === key && stats.activeId !== null ? snapshot.data : null, error };
}

function Rate({ value }: { value: TokenRateWindow | undefined }) {
  if (value === undefined) return <span className="muted">n/a</span>;
  if (value.reportedCalls === 0n && value.unknownCalls === 0n) return <><span className="usage-main muted">—</span><span className="when-rel">No reports in this window</span></>;
  return <><span className="usage-main">{value.tokensPerSecond === undefined ? 'Unknown' : `${value.tokensPerSecond.toLocaleString(undefined, { maximumFractionDigits: RATE_DIGITS })} TPS`}</span>
    <span className="when-rel">{value.knownTokens.toString()} tokens{value.unknownCalls > 0n && ` · ${value.unknownCalls.toString()} unknown`}</span></>;
}
function Clock({ value }: { value: string }) { return <time dateTime={value} title={value}>{clockTime(value)}</time>; }
// The purpose's sub-line: reports behind its input rate and the age of the last one (it may be older than the window).
function reports(value: TokenRateWindow): string {
  return `${value.reportedCalls.toString()} reported calls · last sample ${value.sampleAgeMillis === undefined ? 'age unavailable' : `${value.sampleAgeMillis.toString()} ms ago`}`;
}
/** The Model usage sub-view (spec §3.1): the measures per purpose as a table, the explanation in a popover, the settings as a list. */
export function ModelUsageView({ usage, connected }: { usage: ModelUsageState; connected: boolean }) {
  const data = usage.data;
  return <div className="stack-lg">
    <div className="page-head"><div><h1 className="page-title">Model usage</h1><p className="page-sub">{data === null ? 'Completed model calls reported by providers.' : <>Observed <Clock value={data.observedAt}/> · window <Clock value={data.windowStartAt}/> – <Clock value={data.windowEndAt}/> · covered {data.coveredMillis} ms · basis {data.basis} · process started <Clock value={data.processStartedAt}/></>}</p></div>
      <Anchored className="usage-about" buttonClassName="btn" buttonState={undefined} label={<><Glyph name="info"/>About usage measurements</>} ariaLabel={undefined} describedBy={undefined} panel="dialog" panelClassName="popover usage-about-panel" panelLabel="About usage measurements">
        <p>In flight counts local requests now. Tokens and rates use provider reports from completed attempts in the displayed window, not live throughput or billing totals. Token counts are the known (provider-reported) tokens; calls reported without usage are counted as unknown and make the rate Unknown. Reasoning is included in output.</p>
        <p>Finished includes failed and cancelled calls. Invalid usage means malformed provider usage, not annotation validation. Unknown is unavailable, not zero; N/A is not applicable. No reports means no usage samples in the window. Last reported samples may be older than the window.</p>
      </Anchored></div>
    {usage.error !== null && <div className="notice notice-danger" role="alert"><Glyph name="alert"/><div>{usage.error}</div></div>}
    {data === null && usage.error === null && <p className="muted" role="status">{connected ? 'Reading completed-call usage…' : 'Usage cleared; reconnect to reauthorize.'}</p>}
    {data !== null && <>
      <section className="card"><table className="table table-static table-inset usage-table" aria-label="Completed model call usage"><colgroup><col className="col-purpose"/><col/><col/><col/><col/><col/><col/><col/><col/></colgroup>
        <thead><tr><th scope="col">Purpose</th><th scope="col" className="col-num">In flight</th><th scope="col" className="col-num">Input</th><th scope="col" className="col-num">Output</th><th scope="col" className="col-num">Reasoning</th><th scope="col" className="col-num">Finished</th><th scope="col" className="col-num">Failed</th><th scope="col" className="col-num">Cancelled</th><th scope="col" className="col-num">Invalid usage</th></tr></thead>
        <tbody>{purposes.map(purpose => { const sample = data.samples.find(item => item.purpose === purpose)!; return <tr key={purpose} data-purpose={purpose}><th scope="row"><span className="cell-title">{PURPOSE_LABELS[purpose]}</span><span className="when-rel">{reports(sample.input)}</span></th><td className="col-num">{sample.inFlight}</td><td className="col-num"><Rate value={sample.input}/></td><td className="col-num"><Rate value={sample.output}/></td><td className="col-num"><Rate value={sample.reasoningSubset}/></td><td className="col-num">{sample.finishedCalls.toString()}</td><td className="col-num">{sample.failedCalls > 0n ? <span className="status-danger">{sample.failedCalls.toString()}</span> : sample.failedCalls.toString()}</td><td className="col-num">{sample.cancelledCalls.toString()}</td><td className="col-num">{sample.invalidUsageCalls.toString()}</td></tr>; })}</tbody>
      </table></section>
      <section className="card" aria-labelledby="usage-settings-heading"><div className="card-head"><h2 id="usage-settings-heading">Indexing settings</h2><span className="xs muted">read-only · operator configuration</span></div>
        <div className="card-body"><dl className="dl usage-settings"><dt>Annotation sessions</dt><dd>{data.settings.annotationSessions}</dd><dt>Embedding requests</dt><dd>{data.settings.embeddingRequests}</dd><dt>Embedding batch size</dt><dd>{data.settings.embeddingBatchSize}</dd></dl></div></section>
    </>}
  </div>;
}
