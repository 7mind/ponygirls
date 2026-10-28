import { useEffect, useRef, useState } from 'react';
import { ModelPurpose, Operation_ModelUsage, Result_ModelUsage, type ModelUsageResult, type TokenRateWindow, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
import { validateModelUsage } from './model-usage.ts';
import { ErrorNotice } from './App.tsx';
const USAGE_POLL_MS = 4_000;
const purposes = [ModelPurpose.Annotation, ModelPurpose.DocumentEmbedding, ModelPurpose.QueryEmbedding, ModelPurpose.McpTest] as const;

function Rate({ value }: { value: TokenRateWindow | undefined }) {
  if (value === undefined) return <>N/A</>;
  const noReports = value.reportedCalls === 0n && value.unknownCalls === 0n;
  return <><strong>{noReports ? 'No reports in this window' : value.tokensPerSecond === undefined ? 'Unknown' : `${value.tokensPerSecond.toLocaleString(undefined, { maximumFractionDigits: 3 })} TPS`}</strong><small>{value.knownTokens.toString()} known tokens · {value.reportedCalls.toString()} reported / {value.unknownCalls.toString()} unknown calls</small><small>Last reported sample age {value.sampleAgeMillis === undefined ? 'unavailable' : `${value.sampleAgeMillis.toString()} ms`}</small></>;
}
export function ModelUsage({ connection, stats, user }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo }) {
  const [open, setOpen] = useState(false), [epoch, setEpoch] = useState(0), [snapshot, setSnapshot] = useState<{ key: string; data: ModelUsageResult } | null>(null), [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([user.id, stats.generation, stats.activeId, epoch]), current = useRef(key); current.current = key;
  const busy = useRef(false), kick = useRef<() => void>(() => {});
  useEffect(() => connection.onInvalidate(() => { setSnapshot(null); setError(null); current.current = ''; setEpoch(n => n + 1); }), [connection]);
  useEffect(() => {
    let mounted = true, timer: number | null = null;
    setSnapshot(null); setError(null);
    kick.current = () => {
      if (!mounted || !open || stats.activeId === null || busy.current) return;
      busy.current = true;
      void read(connection, new Operation_ModelUsage(), result => result instanceof Result_ModelUsage ? validateModelUsage(result.result) : null).then(data => { if (mounted && current.current === key) { setSnapshot({ key, data }); setError(null); } }).catch((cause: unknown) => { if (mounted && current.current === key) { setSnapshot(null); setError(cause instanceof Error ? cause.message : 'Usage unavailable'); } }).finally(() => {
        busy.current = false;
        if (mounted) timer = window.setTimeout(() => kick.current(), USAGE_POLL_MS); else kick.current();
      });
    };
    kick.current();
    return () => { mounted = false; if (timer !== null) window.clearTimeout(timer); };
  }, [connection, key, open]);
  const data = snapshot !== null && snapshot.key === key && stats.activeId !== null ? snapshot.data : null;
  return <details className="model-usage management-section" open={open} onToggle={event => setOpen(event.currentTarget.open)}><summary>Model usage and indexing settings</summary>
    {open && <><p className="tiny">In flight now is an instantaneous count of local requests, not proof of provider activity. Tokens are provider-reported after completion, not live streaming, GPU speed or billing totals. Reasoning is a subset of output; never add it to output.</p><p className="tiny">All other counts and rates cover the recent completed-attempt window, approximately 9.9–10 seconds at steady state; the actual server window and coverage below are authoritative. Finished includes failed and cancelled calls; these are subsets, not additional calls. Invalid usage means malformed provider-reported usage, not annotation validation.</p><p className="tiny">No reports in this window means no completed calls reported or lacked usage in the window. Unknown means usage or a rate is unavailable, not zero; 0 TPS with reported calls is known zero; N/A is not applicable. Last reported sample age may exceed the window after older reports roll out.</p>
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}{data === null && error === null && <p role="status">{stats.activeId === null ? 'Usage cleared; reconnect to reauthorize.' : 'Reading completed-call usage…'}</p>}
      {data !== null && <><p className="tiny">Observed {data.observedAt} · process started {data.processStartedAt}<br/>Window {data.windowStartAt} – {data.windowEndAt} · covered {data.coveredMillis} ms · basis {data.basis}</p><div className="goal50-table-scroll"><table className="usage-table" aria-label="Completed model call usage"><thead><tr><th>Purpose</th><th>In flight now</th><th>Input</th><th>Output</th><th>Reasoning subset of output</th><th>Window finished / failed / cancelled / invalid usage</th></tr></thead><tbody>{purposes.map(purpose => { const sample = data.samples.find(item => item.purpose === purpose)!; return <tr key={purpose}><th scope="row">{purpose}</th><td>{sample.inFlight}</td><td><Rate value={sample.input}/></td><td><Rate value={sample.output}/></td><td><Rate value={sample.reasoningSubset}/></td><td>{sample.finishedCalls.toString()} / {sample.failedCalls.toString()} / {sample.cancelledCalls.toString()} / {sample.invalidUsageCalls.toString()}</td></tr>; })}</tbody></table></div><h3>Indexing settings · read-only operator configuration</h3><dl className="goal50-settings"><div><dt>Annotation sessions</dt><dd>{data.settings.annotationSessions}</dd></div><div><dt>Embedding requests</dt><dd>{data.settings.embeddingRequests}</dd></div><div><dt>Embedding batch size</dt><dd>{data.settings.embeddingBatchSize}</dd></div></dl></>}
    </>}
  </details>;
}
