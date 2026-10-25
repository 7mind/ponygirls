import type { Scheduler, Lifecycle, LifecycleEvent, Socket, Protocol, ConnectionConfig } from '../src/transport/types.ts';
import { connectionConfig } from '../src/transport/types.ts';
export class Clock implements Scheduler {
  time = 0; nextId = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now() { return this.time; }
  setTimeout(callback: () => void, delay: number) {
    const id = ++this.nextId; this.timers.set(id, { at: this.time + delay, callback }); return id;
  }
  clearTimeout(id: number) { this.timers.delete(id); }
  advance(ms: number) {
    const target = this.time + ms;
    for (let count = 0; count < 10_000; count++) {
      const next = [...this.timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { this.time = target; return; }
      this.time = Math.max(this.time, next[1].at); this.timers.delete(next[0]); next[1].callback();
    }
    throw new Error('timer loop');
  }
  pause(ms: number) { this.time += ms; }
}
export class Page implements Lifecycle {
  isHidden = false; listeners = new Set<(e: LifecycleEvent) => void>();
  hidden() { return this.isHidden; }
  subscribe(callback: (e: LifecycleEvent) => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  emit(event: LifecycleEvent) {
    if (event === 'hidden') this.isHidden = true;
    if (event === 'visible') this.isHidden = false;
    for (const callback of this.listeners) callback(event);
  }
}
export class FakeSocket implements Socket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((data: string) => void) | null = null;
  onclose: ((code: number, reason: string) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  send(data: string) { if (this.readyState !== 1) throw new Error('not open'); this.sent.push(data); }
  open() { this.readyState = 1; if (this.onopen) this.onopen(); }
  receive(data: string) { if (this.onmessage) this.onmessage(data); }
  close(code: number, reason: string) { this.readyState = 3; if (this.onclose) this.onclose(code, reason); }
  ping() { const ping = this.sent.filter(s => s.startsWith('ping ')).at(-1); if (!ping) throw new Error('no ping'); return ping; }
  alive() { this.open(); this.receive('negotiated'); this.receive(this.ping().replace('ping ', 'pong ')); }
}
// A test-only semantic protocol. Production uses Baboon codecs, never this fixture grammar.
export const protocol: Protocol<string, string> = {
  hello: () => 'hello', ping: (n, at) => `ping ${n} ${at}`, pong: (_id, n, at) => `pong ${n} ${at}`,
  request: (id, op) => `request ${id} ${op}`,
  decode(data) {
    const [kind, a, b] = data.split(' ');
    if (kind === 'negotiated') return { kind };
    if (kind === 'pong') return { kind, nonce: a!, at: Number(b) };
    if (kind === 'ping') return { kind, id: 'server-id', nonce: a!, at: Number(b) };
    if (kind === 'reply') return { kind, id: a!, result: b! };
    if (kind === 'unauthorized' || kind === 'update-required') return { kind: 'stop', reason: kind, message: kind };
    if (kind === 'forbidden') return { kind: 'failure', id: a!, code: 'forbidden', message: 'denied', invalidates: true };
    throw new Error('invalid frame');
  },
};
export const config: ConnectionConfig = {
  ...connectionConfig, connectTimeout: 100, pongTimeout: 40, heartbeatInterval: 50,
  staleGrace: 100, requestTimeout: 80, retryBase: 20, retryCap: 80,
  maxAttempts: 3, maxPool: 2, tickInterval: 10, pauseThreshold: 20,
};
