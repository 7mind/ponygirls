import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ConnectionManager, connectionLabel, type ConnectionStats, type ConnectionTone } from "./connection";
import { useOverlay } from "./overlay";
import { uuidv7 } from "./api";

interface Invalidation { version: number; key: string | null; revision: number | null }
const LiveContext = createContext<Invalidation>({ version: 0, key: null, revision: null });
interface ConnectionView { stats: ConnectionStats | null; retry: () => void }
const ConnectionContext = createContext<ConnectionView | null>(null);
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
    <ConnectionContext.Provider value={{ stats, retry: () => { if (manager.current !== null) manager.current.retry(); } }}>
      {children}
    </ConnectionContext.Provider>
  </LiveContext.Provider>;
}

const EVENT_LOG_TAIL = 6;
const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" };
const RTT_WINDOW_S = 30;
const SECOND_MS = 1_000;
const MINUTE_S = 60;
const HOUR_MIN = 60;
const STATUS_CLASS: Record<ConnectionTone, string> = { live: "status-ok", connecting: "status-warn", reconnecting: "status-warn", stale: "status-warn", offline: "status-danger" };

function duration(ms: number): string {
  const minutes = Math.floor(ms / SECOND_MS / MINUTE_S);
  if (minutes < 1) return `${Math.max(0, Math.floor(ms / SECOND_MS))} s`;
  return minutes < HOUR_MIN ? `${minutes} min` : `${Math.floor(minutes / HOUR_MIN)} h ${minutes % HOUR_MIN} min`;
}

function figures(stats: ConnectionStats, tone: ConnectionTone, now: number): Array<[string, string]> {
  const pending = stats.pool.reduce((sum, entry) => sum + entry.pending, 0);
  const pendingText = `${pending} ${pending === 1 ? "request" : "requests"}`;
  const active = stats.pool.find((entry) => entry.active);
  if (tone === "live" && active !== undefined) {
    const window = active.rtt.find((entry) => entry.seconds === RTT_WINDOW_S);
    return [
      ["Round trip", window === undefined || window.median === null ? "No samples yet" : `${Math.round(window.median)} ms median (${RTT_WINDOW_S} s)`],
      ["Uptime", duration(now - active.created)],
      ["Pending", pendingText],
    ];
  }
  const lastClose: [string, string] = ["Last close", stats.lastClose === null ? "None" : `${stats.lastClose.code} · ${stats.lastClose.reason || "no reason given"}`];
  const last = stats.events.at(-1);
  if (tone === "offline") return [lastClose, ["Offline for", last === undefined ? "—" : duration(now - last.at)], ["Pending", pendingText]];
  return [
    ["Next attempt", stats.phase !== null && stats.phase.kind === "Backoff" ? `in ${duration(stats.phase.started + stats.phase.duration - now)} (backoff)` : "—"],
    lastClose,
    ["Pending", pendingText],
  ];
}

/** Masthead live-connection indicator: dot + label; diagnostics in a popover on demand. */
export function ConnectionIndicator() {
  const connection = useContext(ConnectionContext);
  if (connection === null) throw new Error("ConnectionIndicator requires LiveProvider");
  const { stats, retry } = connection;
  const overlay = useOverlay();
  const now = Date.now();
  const view = connectionLabel(stats, now);
  useEffect(() => { document.title = `Haystack · ${view.label}`; }, [view.label]);
  const events = stats === null ? [] : stats.events;
  const shown = events.slice(-EVENT_LOG_TAIL).reverse();
  return <div className="anchor" ref={overlay.anchor}>
    <button type="button" ref={overlay.trigger} className="conn" data-state={view.tone} aria-label={`Connection: ${view.name}`}
      aria-expanded={overlay.open} aria-controls="connection-details" onClick={overlay.toggle}><span className="conn-text">{view.label}</span></button>
    {overlay.open && <section className="popover conn-popover" id="connection-details" aria-label="Connection details">
      <div className="conn-head"><strong>Connection</strong><span className={`status ${STATUS_CLASS[view.tone]}`}>{view.label}</span></div>
      <p className="conn-sentence">{view.sentence}</p>
      {stats !== null && <dl className="dl conn-figures">{figures(stats, view.tone, now).map(([term, value]) =>
        <div key={term} className="conn-figure"><dt>{term}</dt><dd>{value}</dd></div>)}</dl>}
      <details className="disclosure">
        <summary><span>Event log</span> <span className="count">{events.length}</span></summary>
        <ol className="event-log">{shown.map((event, index) =>
          <li key={`${event.at}-${index}`}><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString([], CLOCK)}</time><span>{event.message}</span></li>)}</ol>
        {events.length > shown.length && <p className="conn-sentence">Last {shown.length} of {events.length} events</p>}
      </details>
      <div className="conn-actions"><button type="button" className={`btn btn-sm ${view.tone === "live" ? "" : "btn-primary"}`} onClick={retry}>Reconnect now</button></div>
    </section>}
  </div>;
}
