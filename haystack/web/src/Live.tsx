import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionManager, type ConnectionStats } from "./connection";
import { uuidv7 } from "./api";

interface Invalidation { version: number; key: string | null; revision: number | null }
const LiveContext = createContext<Invalidation>({ version: 0, key: null, revision: null });
export function useLiveUpdates(): Invalidation { return useContext(LiveContext); }

export function LiveProvider({ children, onAuthLost }: { children: ReactNode; onAuthLost: () => void }) {
  const manager = useRef<ConnectionManager | null>(null);
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const [invalidation, setInvalidation] = useState<Invalidation>({ version: 0, key: null, revision: null });
  useEffect(() => {
    const url = new URL("/api/v1/live", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const connection = new ConnectionManager(url.href, {
      status: setStats,
      resync: () => setInvalidation((v) => ({ version: v.version + 1, key: null, revision: null })),
      changed: (key, revision) => setInvalidation((v) => ({ version: v.version + 1, key, revision })),
      authLost: onAuthLost,
    }, {
      now: () => Date.now(), random: () => Math.random(), nonce: uuidv7,
      open: (address) => new WebSocket(address),
      interval: (callback, ms) => window.setInterval(callback, ms), cancelInterval: (id) => window.clearInterval(id),
      page: document, window, network: "connection" in navigator && navigator.connection instanceof EventTarget ? navigator.connection : null,
    });
    manager.current = connection;
    return () => { manager.current = null; connection.destroy(); document.title = "Haystack"; };
  }, [onAuthLost]);
  return <LiveContext.Provider value={invalidation}>
    {children}
    <ConnectionIndicator stats={stats} retry={() => { if (manager.current !== null) manager.current.retry(); }} />
  </LiveContext.Provider>;
}

const LABELS: Record<ConnectionStats["state"], string> = {
  NEW: "Connecting", ALIVE: "Live", STALE: "Connection stale", DEAD: "Disconnected",
  STOPPED: "Connection stopped", DEFERRED: "Reconnect deferred", SUSPENDED: "Connection paused",
};

function ConnectionIndicator({ stats, retry }: { stats: ConnectionStats | null; retry: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const ring = useRef<SVGCircleElement | null>(null);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const render = (now: number) => {
      if (now - last >= 100) {
        last = now;
        const phase = stats === null ? null : stats.phase;
        const remaining = phase === null ? 1 : Math.max(0, Math.min(1, 1 - (Date.now() - phase.started) / phase.duration));
        if (ring.current !== null) ring.current.style.strokeDasharray = `${remaining * 100} 100`;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [stats]);
  const state = stats === null ? "NEW" : stats.state;
  const label = LABELS[state];
  useEffect(() => { document.title = `Haystack · ${label}`; }, [label]);
  return <aside className="connection-widget" data-state={state} aria-label="Connection health">
    <button type="button" className="connection-button" aria-label={`Connection: ${label}`} aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}>
      <svg viewBox="0 0 32 32" aria-hidden="true"><circle className="ring-track" cx="16" cy="16" r="12" />
        <circle ref={ring} className="ring-progress" cx="16" cy="16" r="12" pathLength="100" />
        <circle className="connection-dot" cx="16" cy="16" r="4" /></svg>
      <span>{label}</span>
    </button>
    {expanded && <div className="connection-panel">
      <div className="panel-heading"><h3>Connection health</h3><button type="button" aria-label="Close connection details" onClick={() => setExpanded(false)}>×</button></div>
      <p>{state === "ALIVE" ? "Changes arrive automatically." : state === "DEFERRED" ? "Reconnect waits until this tab is visible." :
        state === "STOPPED" ? "Automatic reconnection has stopped. Try again when the service is available." : "Displayed records may be out of date."}</p>
      {stats !== null && <>
        <p className="muted">Attempt {stats.attempts}/{stats.maxAttempts} · {stats.phase === null ? label : `${stats.phase.kind} deadline`}</p>
        <div className="connection-pool">{stats.pool.map((c) => <div key={c.id} className={`pool-entry ${c.active ? "active" : ""}`}>
          <strong>#{c.id} · {c.state}{c.active && " · active"}</strong>
          <small>Uptime {Math.floor((Date.now() - c.created) / 1000)}s · {c.pending} pending · {c.sent === 0 ? 0 : Math.round(c.missed / c.sent * 100)}% missed</small>
          {c.rtt.map((w) => <small key={w.seconds}>{w.seconds}s RTT · {w.count === 0 ? "No samples" : `${w.min}/${w.median}/${w.max} ms min/median/max · ${w.count} samples`}</small>)}
        </div>)}</div>
        {stats.lastClose !== null && <p>Last close: {stats.lastClose.code} · {stats.lastClose.reason || "No reason given"}</p>}
        <details><summary>Event log</summary><ol className="connection-log">{stats.events.slice().reverse().map((event, i) =>
          <li key={i}><time>{new Date(event.at).toLocaleTimeString()}</time> {event.message}</li>)}</ol></details>
      </>}
      <button type="button" onClick={retry}>Try again</button>
    </div>}
  </aside>;
}
