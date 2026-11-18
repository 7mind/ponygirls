import { Anchored } from './Popover.tsx';
import { useEffect, useState } from 'react';
import type { ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
export type ConnectionLabel = 'live' | 'frozen' | 'deferred' | 'stale' | 'retrying' | 'connecting' | 'offline' | NonNullable<ManagerStats['terminal']>;
// Tones of the shared `.conn` indicator (components.css): live is the default; the others colour the dot.
type ConnectionTone = 'live' | 'connecting' | 'reconnecting' | 'stale' | 'offline';
const TONES: Readonly<Record<ConnectionLabel, ConnectionTone>> = {
  live: 'live', connecting: 'connecting', retrying: 'reconnecting', stale: 'stale', deferred: 'stale', frozen: 'stale',
  offline: 'offline', stopped: 'offline', unauthorized: 'offline', 'update-required': 'offline', 'protocol-error': 'offline',
};
const STATUS_CLASS: Readonly<Record<ConnectionTone, string>> = { live: 'status status-ok', connecting: 'status status-warn', reconnecting: 'status status-warn', stale: 'status status-warn', offline: 'status status-danger' };
const CLOCK_TICK_MS = 100, RTT_WINDOWS_SECONDS = [30, 60, 300] as const;
export function connectionLabel(stats: ManagerStats): ConnectionLabel {
  if (stats.terminal !== null) return stats.terminal;
  if (stats.frozen) return 'frozen';
  if (stats.deferred) return 'deferred';
  if (stats.activeId !== null) return 'live';
  if (stats.sockets.some(c => c.state === 'STALE')) return 'stale';
  if (stats.retryAt !== null) return 'retrying';
  if (stats.sockets.some(c => c.state === 'NEW')) return 'connecting';
  return 'offline';
}
function shownLabel(label: ConnectionLabel, stats: ManagerStats): string {
  const text = label.charAt(0).toUpperCase() + label.slice(1).replace('-', ' ');
  return label === 'retrying' ? `${text} · ${stats.attempts}/${stats.maxAttempts}` : label === 'connecting' ? `${text}…` : text;
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
    const animate = (at: number) => { if (at - previous >= CLOCK_TICK_MS) { previous = at; setNow(Date.now()); } frame = requestAnimationFrame(animate); };
    frame = requestAnimationFrame(animate); return () => cancelAnimationFrame(frame);
  }, []);
  const label = connectionLabel(stats), live = stats.sockets.filter(c => c.state !== 'DEAD'), tone = TONES[label], shown = shownLabel(label, stats);
  useEffect(() => { document.title = `Chronicle · ${label} (${stats.activeId === null ? 0 : 1}/${live.length})`; }, [label, stats.activeId, live.length]);
  const loss = stats.sentPings === 0 ? '—' : `${Math.round(100 * stats.lostPings / stats.sentPings)}%`;
  return <div className="connection-widget" data-state={label}><Anchored className="connection-control" buttonClassName="conn" buttonState={tone} ariaLabel={`Connection: ${shown}`} describedBy={undefined} panel="dialog" panelClassName="popover health-panel" panelLabel="Connection details"
    label={<span className="conn-label">{shown}</span>}>
    <div className="health-heading"><strong>Connection</strong><span className={STATUS_CLASS[tone]}>{shown}</span></div>
    <p className="health-note">Hidden tabs may pause timers. Returning verifies liveness and reloads authorized snapshots; writes are never replayed.</p>
    <dl className="dl health-grid"><dt>Active socket</dt><dd>{stats.activeId ?? 'none'}</dd><dt>Live pool</dt><dd>{live.length}</dd><dt>Attempt</dt><dd>{stats.attempts}/{stats.maxAttempts}</dd><dt>Next retry</dt><dd>{stats.deferred ? 'when visible' : stats.retryAt !== null ? duration(stats.retryAt - now) : 'not scheduled'}</dd><dt>Heartbeat loss</dt><dd>{loss}</dd><dt>Pending pings</dt><dd>{live.reduce((sum, s) => sum + s.pendingPings, 0)}</dd>
      {RTT_WINDOWS_SECONDS.flatMap(seconds => [<dt key={`t${seconds}`}>Round trip {seconds}s</dt>, <dd key={`d${seconds}`}><code>{rttWindow(stats, now, seconds)}</code></dd>])}</dl>
    <p className="health-note">Round trips: min / median / max.</p>
    <ul className="health-pool" aria-label="Socket pool">{stats.sockets.map(s => <li key={s.id} className={s.active ? 'chip chip-ok' : 'chip'}>#{s.id}{s.active ? ' active' : ''} · {s.state} · {duration(now - s.createdAt)}</li>)}</ul>
    {stats.lastClose && <p className="health-note">Last close: {stats.lastClose.code} · {stats.lastClose.reason}</p>}
    {stats.terminal !== null && <button type="button" className="btn btn-sm" onClick={() => connection.retry()}>Try again manually</button>}
    <details className="event-log"><summary>Recent events ({stats.events.length})</summary><ol>{[...stats.events].reverse().map((event, index) => <li key={`${event.at}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}</li>)}</ol></details>
  </Anchored></div>;
}
