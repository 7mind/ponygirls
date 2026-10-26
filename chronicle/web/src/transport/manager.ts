import { RequestFailure } from './types.ts';
import type { Dependencies, ManagerStats, RequestOptions, Socket, SocketState, Protocol, StopReason, LifecycleEvent, RttSample, TransportEvent } from './types.ts';
interface Channel<Operation, Result> {
  id: number; socket: Socket; protocol: Protocol<Operation, Result>; state: SocketState;
  negotiated: boolean; staleEpoch: number; createdAt: number; deadline: number; deadlineStartedAt: number;
  heartbeatTimer: number | null; timers: Set<number>; pings: Map<string, number>;
}
interface Pending<Result> {
  socketId: number; generation: number; timer: number; options: RequestOptions;
  resolve: (result: Result) => void; reject: (failure: RequestFailure) => void;
}
const PERMANENT_CLOSE = new Set([1002, 1003, 1007, 1008, 1009, 1010, 1015]);
export class ConnectionManager<Operation, Result> {
  private readonly deps: Dependencies<Operation, Result>;
  private channels: Channel<Operation, Result>[] = [];
  private active: Channel<Operation, Result> | null = null;
  private pending = new Map<string, Pending<Result>>();
  private listeners = new Set<() => void>();
  private invalidations = new Set<() => void>();
  private timers = new Set<number>();
  private unsubscribe: (() => void) | null = null;
  private nextId = 0;
  private attempts = 0;
  private generation = 0;
  private started = false;
  private destroyed = false;
  private suspended = false;
  private frozen = false;
  private deferred = false;
  private retryTimer: number | null = null;
  private retryAt: number | null = null;
  private retryStartedAt: number | null = null;
  private terminal: StopReason | null = null;
  private lastClose: { code: number; reason: string } | null = null;
  private sentPings = 0;
  private lostPings = 0;
  private rtt: RttSample[] = [];
  private events: TransportEvent[] = [];
  private lastTick = 0;
  constructor(dependencies: Dependencies<Operation, Result>) {
    if (dependencies.config.maxPool < 2 || dependencies.config.maxAttempts < 1) throw new Error('Invalid connection limits');
    this.deps = dependencies;
  }
  start(): void {
    if (this.destroyed || this.started) return;
    this.started = true;
    this.unsubscribe = this.deps.lifecycle.subscribe(event => this.lifecycle(event));
    this.lastTick = this.now(); this.tick(); this.open(false);
  }
  onUpdate(callback: () => void): () => void { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  onInvalidate(callback: () => void): () => void { this.invalidations.add(callback); return () => { this.invalidations.delete(callback); }; }
  stats(): ManagerStats {
    return {
      sockets: this.channels.map(c => ({ id: c.id, state: c.state, active: this.active === c, createdAt: c.createdAt,
        deadline: c.deadline, deadlineStartedAt: c.deadlineStartedAt, pendingPings: c.pings.size })),
      activeId: this.active === null ? null : this.active.id, attempts: this.attempts,
      maxAttempts: this.deps.config.maxAttempts, retryAt: this.retryAt, retryStartedAt: this.retryStartedAt,
      deferred: this.deferred, frozen: this.frozen, terminal: this.terminal, lastClose: this.lastClose,
      sentPings: this.sentPings, lostPings: this.lostPings, rtt: [...this.rtt], events: [...this.events], generation: this.generation,
    };
  }
  request(operation: Operation, options: RequestOptions): Promise<Result> {
    if (options.mutation && options.receiptId === null) throw new Error('Mutation requires a durable receipt ID');
    const channel = this.active;
    if (this.destroyed || channel === null || channel.state !== 'ALIVE') {
      return Promise.reject(new RequestFailure('No verified live connection', 'not-live', 'failed', options.receiptId));
    }
    const id = options.mutation ? options.receiptId! : this.deps.nonce();
    if (this.pending.has(id)) throw new Error('Request ID is already in flight');
    return new Promise<Result>((resolve, reject) => {
      const timer = this.schedule(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(this.failure('delivery' in options && options.delivery === 'once' ? 'Request deadline exceeded; one-shot delivery is unknown and must not be automatically repeated' : 'Request deadline exceeded; reload reads or look up the mutation receipt', 'timeout', options));
        this.stale(channel, 'request timeout');
      }, this.deps.config.requestTimeout);
      this.pending.set(id, { socketId: channel.id, generation: this.generation, timer, options, resolve, reject });
      try { channel.socket.send(channel.protocol.request(id, operation)); }
      catch { this.failChannel(channel, 'Send failed'); this.dead(channel, 1006, 'Send failed', false); }
    });
  }
  retry(): void {
    if (this.destroyed) return;
    this.terminal = null; this.attempts = 0; this.suspended = false;
    this.cancelRetry(); this.invalidate(); this.closeAll('manual retry'); this.open(false);
  }
  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.invalidate(); this.closeAll('disposed');
    for (const id of this.timers) this.deps.scheduler.clearTimeout(id);
    this.timers.clear(); this.listeners.clear(); this.invalidations.clear();
  }
  private now(): number { return this.deps.scheduler.now(); }
  private schedule(callback: () => void, delay: number, channel: Channel<Operation, Result> | null = null): number {
    const id = this.deps.scheduler.setTimeout(() => {
      this.timers.delete(id); if (channel) channel.timers.delete(id);
      if (!this.destroyed) callback();
    }, delay);
    this.timers.add(id); if (channel) channel.timers.add(id); return id;
  }
  private cancel(id: number): void { this.deps.scheduler.clearTimeout(id); this.timers.delete(id); }
  private emit(): void { if (!this.destroyed) for (const callback of this.listeners) callback(); }
  private log(message: string): void {
    this.events = [...this.events.slice(-(this.deps.config.eventLimit - 1)), { at: this.now(), message }]; this.emit();
  }
  private invalidate(): void { for (const callback of this.invalidations) callback(); }
  private open(retry: boolean): void {
    if (this.destroyed || this.suspended || this.terminal !== null) return;
    if (this.deps.lifecycle.hidden()) { this.deferred = true; this.log('Reconnect deferred: tab hidden'); return; }
    this.deferred = false;
    if (retry && this.attempts >= this.deps.config.maxAttempts) { this.stop('stopped', 'Retry budget exhausted'); return; }
    if (this.channels.filter(c => c.state !== 'DEAD').length >= this.deps.config.maxPool) return;
    if (retry) this.attempts++;
    this.channels = this.channels.filter(c => c.state !== 'DEAD');
    let socket: Socket;
    try { socket = this.deps.socket(); }
    catch { this.log('Socket construction failed'); this.scheduleRetry(); return; }
    const channel: Channel<Operation, Result> = {
      id: ++this.nextId, socket, protocol: this.deps.protocol(), state: 'NEW', negotiated: false, staleEpoch: 0,
      createdAt: this.now(), deadlineStartedAt: this.now(), deadline: this.now() + this.deps.config.connectTimeout,
      heartbeatTimer: null, timers: new Set(), pings: new Map(),
    };
    this.channels.push(channel);
    socket.onopen = () => {
      if (this.destroyed || channel.state === 'DEAD') return;
      try { socket.send(channel.protocol.hello()); }
      catch { this.dead(channel, 1006, 'Hello send failed', true); }
    };
    socket.onmessage = data => this.message(channel, data);
    socket.onclose = (code, reason) => this.dead(channel, code, reason, true);
    socket.onerror = () => this.log(`Socket ${channel.id}: transport error (awaiting deadline or close)`);
    this.schedule(() => {
      if (channel.state !== 'NEW') return;
      if (socket.readyState === 0) this.dead(channel, 1006, 'Connect timeout', true);
      else if (!channel.negotiated) {
        channel.deadlineStartedAt = this.now(); channel.deadline = this.now() + this.deps.config.connectTimeout;
        this.schedule(() => { if (!channel.negotiated) this.dead(channel, 1006, 'Negotiation timeout', true); }, this.deps.config.connectTimeout, channel);
      }
    }, this.deps.config.connectTimeout, channel);
    this.log(`Socket ${channel.id}: NEW${retry ? `, attempt ${this.attempts}/${this.deps.config.maxAttempts}` : ''}`);
  }
  private message(channel: Channel<Operation, Result>, data: string): void {
    if (this.destroyed || channel.state === 'DEAD') return;
    try {
      const message = channel.protocol.decode(data);
      if (message.kind === 'stop') { this.stop(message.reason, message.message); return; }
      if (message.kind === 'negotiated') {
        if (channel.negotiated) throw new Error('Duplicate negotiation');
        channel.negotiated = true; this.ping(channel); return;
      }
      if (!channel.negotiated) throw new Error('Message before negotiation');
      if (message.kind === 'ping') { channel.socket.send(channel.protocol.pong(message.id, message.nonce, message.at)); return; }
      if (message.kind === 'pong') {
        const sentAt = channel.pings.get(message.nonce);
        if (sentAt === undefined || sentAt !== message.at) { this.log(`Socket ${channel.id}: unmatched pong ignored`); return; }
        channel.pings.delete(message.nonce);
        this.rtt = [...this.rtt.filter(s => s.at >= this.now() - 300_000), { at: this.now(), ms: this.now() - sentAt }].slice(-1000);
        if (channel.state !== 'ALIVE') this.alive(channel);
        channel.deadlineStartedAt = this.now(); channel.deadline = this.now() + this.deps.config.heartbeatInterval;
        if (channel.heartbeatTimer !== null) this.cancel(channel.heartbeatTimer);
        channel.heartbeatTimer = this.schedule(() => this.ping(channel), this.deps.config.heartbeatInterval, channel);
        this.emit(); return;
      }
      if (message.kind === 'reply' || message.kind === 'failure') {
        const pending = this.pending.get(message.id);
        if (!pending || pending.socketId !== channel.id || pending.generation !== this.generation || this.active !== channel) return;
        this.pending.delete(message.id); this.cancel(pending.timer);
        if (message.kind === 'reply') pending.resolve(message.result);
        else {
          if (message.invalidates) this.invalidate();
          pending.reject(new RequestFailure(message.message, message.code, 'failed', pending.options.receiptId));
        }
      }
    } catch { this.stop('protocol-error', 'Invalid or unexpected protocol message'); }
  }
  private ping(channel: Channel<Operation, Result>): void {
    if (this.destroyed || !channel.negotiated || channel.state === 'DEAD' || channel.socket.readyState !== 1) return;
    if (channel.heartbeatTimer !== null) { this.cancel(channel.heartbeatTimer); channel.heartbeatTimer = null; }
    if (channel.pings.size > 0) return;
    const nonce = this.deps.nonce(), at = this.now(); channel.pings.set(nonce, at); this.sentPings++;
    if (channel.state !== 'STALE') { channel.deadlineStartedAt = at; channel.deadline = at + this.deps.config.pongTimeout; }
    try { channel.socket.send(channel.protocol.ping(nonce, at)); }
    catch { this.dead(channel, 1006, 'Heartbeat send failed', true); return; }
    this.schedule(() => {
      if (channel.pings.has(nonce) && channel.state !== 'DEAD') { this.lostPings++; this.stale(channel, 'matching pong deadline'); }
    }, this.deps.config.pongTimeout, channel);
    this.emit();
  }
  private alive(channel: Channel<Operation, Result>): void {
    if (this.destroyed || this.terminal !== null) return;
    channel.state = 'ALIVE'; this.active = channel; this.attempts = 0; this.cancelRetry();
    this.generation++; this.invalidate();
    for (const other of this.channels) if (other !== channel && other.state !== 'DEAD') this.dead(other, 1000, 'superseded', false);
    this.log(`Socket ${channel.id}: ALIVE, snapshot generation ${this.generation}`);
  }
  private stale(channel: Channel<Operation, Result>, reason: string): void {
    if (this.destroyed || channel.state === 'DEAD' || channel.state === 'STALE') return;
    channel.state = 'STALE'; channel.deadlineStartedAt = this.now(); channel.deadline = this.now() + this.deps.config.staleGrace;
    if (this.active === channel) { this.active = null; this.invalidate(); }
    this.failChannel(channel, reason);
    const staleEpoch = ++channel.staleEpoch;
    this.schedule(() => { if (channel.state === 'STALE' && channel.staleEpoch === staleEpoch) this.dead(channel, 1006, 'Stale grace expired', true); }, this.deps.config.staleGrace, channel);
    this.log(`Socket ${channel.id}: STALE (${reason})`); this.ensureReplacement();
  }
  private ensureReplacement(): void {
    if (this.channels.some(c => c.state === 'NEW' || c.state === 'ALIVE')) return;
    this.cancelRetry(); this.open(true);
  }
  private dead(channel: Channel<Operation, Result>, code: number, reason: string, reconnect: boolean): void {
    if (channel.state === 'DEAD') return;
    channel.state = 'DEAD'; channel.pings.clear();
    for (const id of channel.timers) this.cancel(id); channel.timers.clear();
    if (this.active === channel) { this.active = null; this.invalidate(); }
    this.failChannel(channel, reason);
    if (channel.socket.readyState < 2) channel.socket.close(1000, 'channel closed');
    if (this.destroyed) return;
    this.lastClose = { code, reason }; this.log(`Socket ${channel.id}: DEAD (${code}, ${reason})`);
    if (reconnect && !this.suspended && this.terminal === null) {
      if (code === 4401 || code === 4403) this.stop('unauthorized', reason);
      else if (code === 4406) this.stop('update-required', reason);
      else if (PERMANENT_CLOSE.has(code) || code === 1000 || code === 4400) this.stop('protocol-error', reason);
      else if (!this.channels.some(c => c.state === 'NEW' || c.state === 'ALIVE')) this.scheduleRetry();
    }
  }
  private failure(message: string, code: string, options: RequestOptions): RequestFailure {
    return new RequestFailure(message, code, options.mutation || ('delivery' in options && options.delivery === 'once') ? 'uncertain' : 'failed', options.receiptId);
  }
  private failChannel(channel: Channel<Operation, Result>, message: string): void {
    for (const [id, pending] of this.pending) if (pending.socketId === channel.id) {
      this.pending.delete(id); this.cancel(pending.timer);
      pending.reject(this.failure(message, 'disconnected', pending.options));
    }
  }
  private scheduleRetry(): void {
    if (this.destroyed || this.suspended || this.terminal !== null || this.retryTimer !== null) return;
    if (this.deps.lifecycle.hidden()) { this.deferred = true; this.log('Reconnect deferred: tab hidden'); return; }
    if (this.attempts >= this.deps.config.maxAttempts) { this.stop('stopped', 'Retry budget exhausted'); return; }
    const ceiling = Math.min(this.deps.config.retryCap, this.deps.config.retryBase * 2 ** this.attempts);
    const delay = Math.floor(ceiling * this.deps.random());
    this.retryStartedAt = this.now(); this.retryAt = this.now() + delay;
    this.retryTimer = this.schedule(() => { this.retryTimer = null; this.retryAt = null; this.retryStartedAt = null; this.open(true); }, delay);
    this.log(`Retry scheduled in ${delay}ms`);
  }
  private cancelRetry(): void {
    if (this.retryTimer !== null) this.cancel(this.retryTimer);
    this.retryTimer = null; this.retryAt = null; this.retryStartedAt = null; this.deferred = false;
  }
  private closeAll(reason: string): void { for (const channel of this.channels) this.dead(channel, 1000, reason, false); }
  private stop(reason: StopReason, message: string): void {
    if (this.destroyed) return;
    this.terminal = reason; this.cancelRetry(); this.invalidate(); this.closeAll(message); this.log(`${reason}: ${message}`);
  }
  private lifecycle(event: LifecycleEvent): void {
    if (this.destroyed) return;
    this.log(`Lifecycle: ${event}`);
    if (event === 'freeze') { this.frozen = true; this.emit(); }
    if (event === 'pagehide') { this.suspended = true; this.cancelRetry(); this.invalidate(); this.closeAll('BFCache pagehide'); }
    if (event === 'pageshow') { this.suspended = false; this.frozen = false; this.open(true); }
    if (event === 'resume') { this.frozen = false; this.resume(true); }
    if (event === 'visible' || event === 'online' || event === 'network-change') {
      const deferred = this.deferred;
      if (deferred) { this.cancelRetry(); this.open(true); }
      else this.resume(this.now() - this.lastTick >= this.deps.config.pongTimeout);
    }
  }
  private resume(long: boolean): void {
    if (this.destroyed || this.suspended || this.terminal !== null) return;
    if (long) {
      for (const channel of [...this.channels]) if (channel.state === 'ALIVE') this.stale(channel, 'long resume');
      this.ensureReplacement();
    } else for (const channel of this.channels) this.ping(channel);
  }
  private tick(): void {
    if (this.destroyed) return;
    this.schedule(() => {
      const gap = this.now() - this.lastTick;
      this.lastTick = this.now();
      if (gap > this.deps.config.tickInterval + this.deps.config.pauseThreshold) { this.log(`Timer pause: ${gap}ms`); this.resume(gap >= this.deps.config.pongTimeout); }
      this.tick();
    }, this.deps.config.tickInterval);
  }
}
