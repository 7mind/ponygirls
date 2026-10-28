import { Popover } from './Popover.tsx';
import { useEffect, useState } from 'react';
import type { ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
export function connectionLabel(stats: ManagerStats): string {
  if (stats.terminal !== null) return stats.terminal;
  if (stats.frozen) return 'frozen';
  if (stats.deferred) return 'deferred';
  if (stats.activeId !== null) return 'live';
  if (stats.sockets.some(c => c.state === 'STALE')) return 'stale';
  if (stats.retryAt !== null) return 'retrying';
  if (stats.sockets.some(c => c.state === 'NEW')) return 'connecting';
  return 'offline';
}
function duration(ms: number) { return `${(Math.max(0, ms) / 1000).toFixed(1)}s`; }
function rttWindow(stats: ManagerStats, now: number, seconds: number): string {
  const values = stats.rtt.filter(s => s.at >= now - seconds * 1000).map(s => s.ms).sort((a, b) => a - b);
  if (values.length === 0) return 'no samples';
  return `${values[0]} / ${values[Math.floor(values.length / 2)]} / ${values.at(-1)} ms · n=${values.length}`;
}
export function ConnectionHealth({ connection, stats }: { connection: ChronicleConnection; stats: ManagerStats }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let frame = 0, previous = 0;
    const animate = (at: number) => { if (at - previous >= 100) { previous = at; setNow(Date.now()); } frame = requestAnimationFrame(animate); };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, []);
  const label = connectionLabel(stats), live = stats.sockets.filter(c => c.state !== 'DEAD');
  useEffect(() => { document.title = `Chronicle · ${label} (${stats.activeId === null ? 0 : 1}/${live.length})`; }, [label, stats.activeId, live.length]);
  const channel = stats.sockets.find(c => c.active) ?? stats.sockets.find(c => c.state === 'STALE') ?? stats.sockets.find(c => c.state === 'NEW');
  const end = stats.retryAt ?? channel?.deadline ?? now;
  const start = stats.retryStartedAt ?? channel?.deadlineStartedAt ?? now;
  const fraction = end > start ? Math.max(0, Math.min(1, (end - now) / (end - start))) : 0;
  const loss = stats.sentPings === 0 ? '—' : `${Math.round(100 * stats.lostPings / stats.sentPings)}%`;
  return <Popover className="connection-widget" dataState={label} ariaLabel={`Connection: ${label}`} panelClassName="health-panel" label={<><svg viewBox="0 0 24 24" aria-hidden="true"><circle className="ring-track" cx="12" cy="12" r="9"/><circle className="ring-budget" cx="12" cy="12" r="9" pathLength="1" strokeDasharray={`${fraction} 1`}/><text x="12" y="16" textAnchor="middle">{label === 'live' ? '✓' : stats.terminal ? '×' : '·'}</text></svg><span>{label}</span><span className="health-hint">Connection details</span></>}>
    <div className="section-heading"><h2>Channel health</h2><span className="eyebrow">{label}</span></div>
      <dl className="health-grid"><div><dt>Active socket</dt><dd>{stats.activeId ?? 'none'}</dd></div><div><dt>Live pool</dt><dd>{live.length}</dd></div><div><dt>Attempt</dt><dd>{stats.attempts}/{stats.maxAttempts}</dd></div><div><dt>Next retry</dt><dd>{stats.deferred ? 'when visible' : stats.retryAt !== null ? duration(stats.retryAt - now) : 'not scheduled'}</dd></div><div><dt>Heartbeat loss</dt><dd>{loss}</dd></div><div><dt>Pending pings</dt><dd>{live.reduce((sum, s) => sum + s.pendingPings, 0)}</dd></div></dl>
      <p className="tiny">RTT min / median / max</p>{[30, 60, 300].map(seconds => <div className="rtt" key={seconds}><span>{seconds}s</span><code>{rttWindow(stats, now, seconds)}</code></div>)}
      <div className="pool">{stats.sockets.map(s => <div key={s.id} className={s.active ? 'socket active-socket' : 'socket'}><strong>#{s.id} {s.active ? 'ACTIVE' : ''}</strong><span>{s.state}</span><span>{duration(now - s.createdAt)} uptime</span></div>)}</div>
      {stats.lastClose && <p className="tiny">Last close: {stats.lastClose.code} · {stats.lastClose.reason}</p>}
      {stats.terminal !== null && <button onClick={() => connection.retry()}>Try again manually</button>}
      <details className="event-log"><summary>Recent events ({stats.events.length})</summary><ol>{[...stats.events].reverse().map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}</li>)}</ol></details>
      <p className="tiny">Hidden tabs may pause timers. Returning verifies liveness and reloads authorized snapshots; writes are never replayed.</p>
  </Popover>;
}
