export type ConnectionState = "NEW" | "ALIVE" | "STALE" | "DEAD";
interface Ping { sent: number; missed: boolean }
interface RttSample { at: number; value: number }
export interface LiveSocketEvents { open: Event; message: MessageEvent; close: CloseEvent; error: Event }
export interface LiveSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code: number, reason: string): void;
  addEventListener<K extends keyof LiveSocketEvents>(type: K, listener: (event: LiveSocketEvents[K]) => void): void;
}
export interface ConnectionRuntime {
  now(): number; random(): number; nonce(): string; open(url: string): LiveSocket;
  interval(callback: () => void, ms: number): number; cancelInterval(id: number): void;
  page: EventTarget & { readonly visibilityState: DocumentVisibilityState };
  window: EventTarget; network: EventTarget | null;
}
interface Connection {
  id: number; socket: LiveSocket; state: ConnectionState; created: number; staleAt: number | null;
  deadAt: number | null; lastPing: number; pings: Map<string, Ping>; verified: number | null;
  samples: RttSample[]; sent: number; missed: number;
}
export interface Phase { kind: "Connect" | "Pong" | "Grace" | "Backoff"; started: number; duration: number }
export interface RttWindow { seconds: number; count: number; min: number | null; median: number | null; max: number | null }
export interface PoolEntry {
  id: number; state: ConnectionState; active: boolean; created: number; pending: number;
  sent: number; missed: number; rtt: RttWindow[];
}
export interface ConnectionStats {
  state: ConnectionState | "STOPPED" | "DEFERRED" | "SUSPENDED"; active: number | null;
  attempts: number; maxAttempts: number; phase: Phase | null;
  pool: PoolEntry[]; lastClose: { code: number; reason: string } | null;
  events: Array<{ at: number; message: string }>;
}
export interface ConnectionListener {
  status(stats: ConnectionStats): void;
  resync(): void;
  changed(key: string, revision: number): void;
  authLost(): void;
}

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const HEARTBEAT_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 10_000;
const STALE_GRACE_MS = 15_000;
const MAX_ATTEMPTS = 12;
const MAX_CONNECTIONS = 3;
const TICK_MS = 250;
const JUMP_THRESHOLD_MS = 1_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;
const DEAD_RETENTION_MS = 3_000;
const MAX_EVENTS = 100;
const MAX_SAMPLES = 512;
const RTT_WINDOWS = [30, 60, 300];
const PERMANENT_CODES = new Set([1002, 1003, 1007, 1008, 1009, 1010, 1015, 4401]);

// Heartbeat/failover design follows cq4 and the resilient-ws-ui reference.
export class ConnectionManager {
  private readonly connections = new Map<number, Connection>();
  private readonly lifecycle = new AbortController();
  private readonly timer: number;
  private readonly events: ConnectionStats["events"] = [];
  private nextId = 0;
  private activeId: number | null = null;
  private attempts = 0;
  private backoff: Phase | null = null;
  private lastClose: ConnectionStats["lastClose"] = null;
  private terminal = false;
  private destroyed = false;
  private deferred = false;
  private suspended = false;
  private frozen = false;
  private lastTick: number;
  private readonly url: string;
  private readonly listener: ConnectionListener;
  private readonly runtime: ConnectionRuntime;

  constructor(url: string, listener: ConnectionListener, runtime: ConnectionRuntime) {
    this.url = url; this.listener = listener; this.runtime = runtime;
    this.lastTick = runtime.now();
    const signal = this.lifecycle.signal;
    this.runtime.page.addEventListener("visibilitychange", () => {
      if (this.runtime.page.visibilityState === "visible") this.resume(this.deferred);
    }, { signal });
    this.runtime.page.addEventListener("freeze", () => { this.frozen = true; this.log("Page frozen"); this.publish(); }, { signal });
    this.runtime.page.addEventListener("resume", () => { this.frozen = false; this.resume(true); }, { signal });
    this.runtime.window.addEventListener("online", () => this.resume(true), { signal });
    this.runtime.window.addEventListener("offline", () => { this.log("Network offline"); this.publish(); }, { signal });
    this.runtime.window.addEventListener("pagehide", () => {
      this.suspended = true; this.backoff = null;
      for (const connection of this.connections.values()) this.close(connection, "Page navigation");
      this.publish();
    }, { signal });
    this.runtime.window.addEventListener("pageshow", () => {
      if (this.suspended) { this.suspended = false; this.resume(true); }
    }, { signal });
    if (runtime.network !== null) {
      runtime.network.addEventListener("change", () => this.resume(true), { signal });
    }
    this.timer = runtime.interval(() => this.tick(), TICK_MS);
    this.connect();
  }

  getStats(): ConnectionStats {
    const live = [...this.connections.values()].filter((c) => c.state !== "DEAD");
    const focus = live.find((c) => c.id === this.activeId) ?? live.find((c) => c.state === "STALE") ?? live[0];
    const state = this.terminal ? "STOPPED" : this.suspended || this.frozen ? "SUSPENDED" :
      focus !== undefined && focus.state === "ALIVE" ? "ALIVE" : this.deferred ? "DEFERRED" :
      focus !== undefined ? focus.state : this.backoff !== null ? "NEW" : "DEAD";
    let phase: Phase | null = this.backoff;
    if (focus !== undefined) {
      const ping = focus.pings.values().next().value;
      if (focus.staleAt !== null) phase = { kind: "Grace", started: focus.staleAt, duration: STALE_GRACE_MS };
      else if (focus.socket.readyState === SOCKET_CONNECTING) phase = { kind: "Connect", started: focus.created, duration: CONNECT_TIMEOUT_MS };
      else if (ping !== undefined) phase = { kind: "Pong", started: ping.sent, duration: PONG_TIMEOUT_MS };
    }
    const now = this.runtime.now();
    return {
      state, active: this.activeId, attempts: this.attempts, maxAttempts: MAX_ATTEMPTS,
      phase: this.terminal || this.suspended || this.frozen || this.deferred ? null : phase,
      pool: [...this.connections.values()].map((c) => ({
        id: c.id, state: c.state, active: c.id === this.activeId, created: c.created,
        pending: c.pings.size, sent: c.sent, missed: c.missed,
        rtt: RTT_WINDOWS.map((seconds) => {
          const values = c.samples.filter((s) => now - s.at <= seconds * 1000).map((s) => s.value).sort((a, b) => a - b);
          const middle = Math.floor(values.length / 2);
          return { seconds, count: values.length, min: values[0] ?? null, max: values[values.length - 1] ?? null,
            median: values.length === 0 ? null : values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]! };
        }),
      })), lastClose: this.lastClose, events: [...this.events],
    };
  }

  private publish(): void { if (!this.destroyed) this.listener.status(this.getStats()); }
  private log(message: string): void {
    this.events.push({ at: this.runtime.now(), message });
    if (this.events.length > MAX_EVENTS) this.events.shift();
  }
  private current(c: Connection): boolean { return !this.destroyed && c.state !== "DEAD"; }
  private live(): Connection[] { return [...this.connections.values()].filter((c) => c.state !== "DEAD"); }

  private connect(): void {
    if (this.destroyed || this.terminal || this.suspended || this.frozen || this.live().length >= MAX_CONNECTIONS) return;
    if (this.runtime.page.visibilityState === "hidden") {
      this.deferred = true; this.backoff = null;
      this.log("Reconnect deferred until tab is visible"); this.publish(); return;
    }
    if (this.attempts >= MAX_ATTEMPTS) { this.stop("Retry limit reached; try again manually"); return; }
    this.attempts++; this.backoff = null; this.deferred = false;
    let socket: LiveSocket;
    try { socket = this.runtime.open(this.url); }
    catch { this.log("Unable to create transport"); this.schedule(); return; }
    const c: Connection = { id: ++this.nextId, socket, state: "NEW", created: this.runtime.now(), staleAt: null,
      deadAt: null, lastPing: 0, pings: new Map(), verified: null, samples: [], sent: 0, missed: 0 };
    this.connections.set(c.id, c);
    this.log(`Opening connection ${c.id}`);
    socket.addEventListener("open", () => { if (this.current(c)) this.ping(c); });
    socket.addEventListener("message", (event) => this.message(c, event));
    socket.addEventListener("error", () => { if (this.current(c)) this.log(`Transport error on connection ${c.id}`); });
    socket.addEventListener("close", (event) => {
      if (!this.current(c)) return;
      this.lastClose = { code: event.code, reason: event.reason };
      this.close(c, `Closed ${event.code}: ${event.reason}`);
      if (PERMANENT_CODES.has(event.code)) {
        this.stop(`Connection stopped (${event.code})`);
        if (event.code === 4401) this.listener.authLost();
      } else this.schedule();
    });
    this.publish();
  }

  private message(c: Connection, event: MessageEvent): void {
    if (!this.current(c)) return;
    let frame: unknown;
    try { frame = JSON.parse(String(event.data)); }
    catch { this.stop("Invalid server JSON"); return; }
    if (typeof frame !== "object" || frame === null) { this.stop("Invalid server frame"); return; }
    const message = frame as { type?: unknown; nonce?: unknown; clientTs?: unknown; serverTs?: unknown; key?: unknown; revision?: unknown };
    if (message.type === "pong" && typeof message.nonce === "string" && typeof message.serverTs === "number") {
      const ping = c.pings.get(message.nonce);
      if (ping === undefined || ping.sent !== message.clientTs) return;
      c.pings.delete(message.nonce);
      c.samples.push({ at: this.runtime.now(), value: Math.max(0, this.runtime.now() - ping.sent) });
      if (c.samples.length > MAX_SAMPLES) c.samples.shift();
      // A matching pong resolves only its request; other expired pings remain failures.
      for (const [nonce, other] of c.pings) if (other.missed) c.pings.delete(nonce);
      this.promote(c);
    } else if (message.type === "changed" && typeof message.key === "string" &&
               typeof message.revision === "number" && Number.isSafeInteger(message.revision) && message.revision > 0) {
      if (c.id === this.activeId && c.state === "ALIVE") this.listener.changed(message.key, message.revision);
    } else this.stop("Invalid server frame");
  }

  private ping(c: Connection): void {
    if (!this.current(c) || c.socket.readyState !== SOCKET_OPEN || c.pings.size >= MAX_CONNECTIONS) return;
    const nonce = this.runtime.nonce();
    const now = this.runtime.now();
    c.pings.set(nonce, { sent: now, missed: false }); c.lastPing = now; c.sent++;
    c.socket.send(JSON.stringify({ type: "ping", nonce, clientTs: now }));
    this.publish();
  }

  private promote(c: Connection): void {
    const recovered = c.state !== "ALIVE" || this.activeId !== c.id;
    c.state = "ALIVE"; c.staleAt = null; c.verified = this.runtime.now();
    this.activeId = c.id; this.attempts = 0; this.backoff = null; this.deferred = false;
    if (recovered) {
      for (const other of this.live()) if (other !== c) this.close(other, "Superseded");
      this.log(`Connection ${c.id} verified by heartbeat`);
      this.listener.resync();
    }
    this.publish();
  }

  private close(c: Connection, reason: string): void {
    if (c.state === "DEAD") return;
    c.state = "DEAD"; c.deadAt = this.runtime.now(); c.pings.clear();
    if (this.activeId === c.id) this.activeId = null;
    this.log(`Connection ${c.id}: ${reason}`);
    c.socket.close(1000, reason.slice(0, 80));
    this.publish();
  }

  private schedule(): void {
    if (this.destroyed || this.terminal || this.suspended || this.backoff !== null ||
        this.live().some((c) => c.state === "ALIVE" || c.state === "NEW")) return;
    if (this.attempts >= MAX_ATTEMPTS) { this.stop("Retry limit reached; try again manually"); return; }
    if (this.runtime.page.visibilityState === "hidden") {
      this.deferred = true; this.log("Reconnect deferred until tab is visible"); this.publish(); return;
    }
    this.backoff = { kind: "Backoff", started: this.runtime.now(),
      duration: Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, this.attempts - 1)) * (0.5 + this.runtime.random() * 0.5) };
    this.log(`Reconnect attempt ${this.attempts + 1} scheduled`); this.publish();
  }

  private resume(replace: boolean): void {
    if (this.destroyed || this.terminal || this.suspended) return;
    this.frozen = false; this.lastTick = this.runtime.now(); this.deferred = false;
    this.log("Checking connection after resume");
    for (const c of this.live()) this.ping(c);
    if (replace || this.live().length === 0) {
      if (!this.live().some((c) => c.state === "NEW")) this.connect();
    }
    this.publish();
  }

  private tick(): void {
    if (this.destroyed || this.suspended || this.frozen) return;
    const now = this.runtime.now();
    const gap = now - this.lastTick - TICK_MS;
    if (gap > JUMP_THRESHOLD_MS) this.resume(gap >= PONG_TIMEOUT_MS);
    this.lastTick = now;
    for (const c of [...this.connections.values()]) {
      if (c.deadAt !== null) {
        if (now - c.deadAt >= DEAD_RETENTION_MS) this.connections.delete(c.id);
        continue;
      }
      if (c.state === "NEW" && now - c.created >= CONNECT_TIMEOUT_MS && c.socket.readyState === SOCKET_CONNECTING) {
        this.close(c, "Connect timeout"); this.schedule(); continue;
      }
      for (const ping of c.pings.values()) if (!ping.missed && now - ping.sent >= PONG_TIMEOUT_MS) { ping.missed = true; c.missed++; }
      if (c.state !== "STALE" && [...c.pings.values()].some((p) => p.missed)) {
        c.state = "STALE"; c.staleAt = now; this.log(`Heartbeat overdue on connection ${c.id}`);
        if (!this.live().some((other) => other.state === "NEW")) this.connect();
      }
      if (c.staleAt !== null && now - c.staleAt >= STALE_GRACE_MS) { this.close(c, "Stale grace expired"); this.schedule(); }
      else if (now - c.lastPing >= HEARTBEAT_MS) this.ping(c);
    }
    if (this.backoff !== null && now >= this.backoff.started + this.backoff.duration) this.connect();
    this.publish();
  }

  retry(): void {
    if (this.destroyed) return;
    this.terminal = false; this.attempts = 0; this.backoff = null; this.deferred = false;
    for (const c of this.live()) this.close(c, "Manual reconnect");
    this.connect();
  }
  private stop(reason: string): void {
    if (this.destroyed) return;
    this.terminal = true; this.backoff = null; this.deferred = false;
    for (const c of this.live()) this.close(c, reason);
    this.log(reason); this.publish();
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true; this.lifecycle.abort(); this.runtime.cancelInterval(this.timer); this.backoff = null;
    for (const c of this.live()) this.close(c, "Destroyed");
    this.connections.clear(); this.runtime.cancelInterval(this.timer);
  }
}
