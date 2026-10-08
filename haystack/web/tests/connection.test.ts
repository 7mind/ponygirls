// Behavioral-Active-Blackbox-Atomic: controlled clock and transport; the
// corresponding real transport/recovery paths run in tests-browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectionManager, type ConnectionRuntime, type LiveSocket, type LiveSocketEvents } from "../src/connection.ts";

class TestPage extends EventTarget { visibilityState: DocumentVisibilityState = "visible"; }
class TestSocket extends EventTarget implements LiveSocket {
  readyState = 0;
  readonly frames: string[] = [];
  send(data: string): void { assert.equal(this.readyState, 1); this.frames.push(data); }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event("open")); }
  close(code: number, reason: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event("close"), { code, reason }));
  }
  message(frame: unknown): void { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) })); }
  pong(): void {
    const ping = JSON.parse(this.frames[this.frames.length - 1]!);
    this.message({ type: "pong", nonce: ping.nonce, clientTs: ping.clientTs, serverTs: 123 });
  }
  override addEventListener<K extends keyof LiveSocketEvents>(type: K, listener: (event: LiveSocketEvents[K]) => void): void {
    super.addEventListener(type, listener as EventListener);
  }
}

interface Timer { callback: () => void; interval: number; next: number }
class TestRuntime implements ConnectionRuntime {
  readonly page = new TestPage();
  readonly window = new EventTarget();
  readonly network = new EventTarget();
  readonly sockets: TestSocket[] = [];
  private time = 1000;
  private counter = 0;
  private readonly timers = new Map<number, Timer>();
  now(): number { return this.time; }
  random(): number { return 0; }
  nonce(): string { return `nonce-${++this.counter}`; }
  open(_url: string): TestSocket { const socket = new TestSocket(); this.sockets.push(socket); return socket; }
  interval(callback: () => void, ms: number): number {
    const id = ++this.counter;
    this.timers.set(id, { callback, interval: ms, next: this.time + ms });
    return id;
  }
  cancelInterval(id: number): void { this.timers.delete(id); }
  advance(ms: number): void {
    const target = this.time + ms;
    while (true) {
      const timer = [...this.timers.values()].filter((t) => t.next <= target).sort((a, b) => a.next - b.next)[0];
      if (timer === undefined) break;
      this.time = timer.next; timer.next += timer.interval; timer.callback();
    }
    this.time = target;
  }
  jump(ms: number): void {
    this.time += ms;
    for (const timer of this.timers.values()) { timer.next = this.time + timer.interval; timer.callback(); }
  }
}

function fixture() {
  const runtime = new TestRuntime();
  let resyncs = 0;
  let authLost = 0;
  const manager = new ConnectionManager("ws://local.test/live", {
    status: () => {}, resync: () => { resyncs++; }, changed: () => {}, authLost: () => { authLost++; },
  }, runtime);
  const alive = () => { const socket = runtime.sockets[runtime.sockets.length - 1]!; socket.open(); socket.pong(); return socket; };
  return { runtime, manager, alive, resyncs: () => resyncs, authLost: () => authLost };
}

test("only a correlated pong establishes liveness", () => {
  const f = fixture();
  try {
    const socket = f.runtime.sockets[0]!; socket.open();
    assert.equal(f.manager.getStats().state, "NEW");
    socket.message({ type: "pong", nonce: "unsolicited", clientTs: 1, serverTs: 2 });
    assert.equal(f.manager.getStats().state, "NEW");
    const ping = JSON.parse(socket.frames[0]!);
    socket.message({ type: "pong", nonce: ping.nonce, clientTs: ping.clientTs + 1, serverTs: 2 });
    assert.equal(f.manager.getStats().state, "NEW");
    socket.pong(); assert.equal(f.manager.getStats().state, "ALIVE"); assert.equal(f.resyncs(), 1);
  } finally { f.manager.destroy(); }
});

test("silent heartbeat loss overlaps a replacement and preserves the old socket through grace", () => {
  const f = fixture();
  try {
    const old = f.alive(); f.runtime.advance(15_000);
    assert.equal(f.manager.getStats().state, "STALE");
    assert.equal(old.readyState, 1); assert.equal(f.runtime.sockets.length, 2);
    const replacement = f.alive();
    assert.equal(f.manager.getStats().state, "ALIVE"); assert.equal(old.readyState, 3);
    assert.equal(replacement.readyState, 1); assert.equal(f.resyncs(), 2);
  } finally { f.manager.destroy(); }
});

test("a late matching pong recovers the original and closes its pending replacement", () => {
  const f = fixture();
  try {
    const old = f.alive(); f.runtime.advance(15_000);
    old.pong();
    assert.equal(f.manager.getStats().state, "ALIVE");
    assert.equal(old.readyState, 1); assert.equal(f.runtime.sockets[1]!.readyState, 3);
  } finally { f.manager.destroy(); }
});

test("hanging handshakes time out and retries have a finite ceiling", () => {
  const f = fixture();
  try {
    f.runtime.advance(10_000);
    assert.equal(f.runtime.sockets[0]!.readyState, 3);
    assert.equal(f.manager.getStats().phase!.kind, "Backoff");
    f.runtime.advance(1_000_000);
    assert.equal(f.manager.getStats().state, "STOPPED");
    assert.equal(f.runtime.sockets.length, f.manager.getStats().maxAttempts);
    f.runtime.advance(1_000_000);
    assert.equal(f.runtime.sockets.length, f.manager.getStats().maxAttempts);
  } finally { f.manager.destroy(); }
});

test("permanent closure stops, retry resynchronizes, and destroy cannot reconnect", () => {
  const f = fixture();
  const old = f.alive(); old.close(1007, "invalid payload");
  assert.equal(f.manager.getStats().state, "STOPPED");
  f.runtime.advance(60_000); assert.equal(f.runtime.sockets.length, 1);
  f.manager.retry(); f.alive(); assert.equal(f.resyncs(), 2);
  f.manager.destroy(); f.runtime.advance(60_000); f.manager.retry();
  assert.equal(f.runtime.sockets.length, 2);
});

test("hidden reconnects are deferred without spending attempts and run immediately when visible", () => {
  const f = fixture();
  try {
    const old = f.alive(); f.runtime.page.visibilityState = "hidden"; old.close(1006, "network loss");
    assert.equal(f.manager.getStats().state, "DEFERRED");
    f.runtime.advance(60_000); assert.equal(f.runtime.sockets.length, 1);
    assert.equal(f.manager.getStats().attempts, 0);
    f.runtime.page.visibilityState = "visible"; f.runtime.page.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.runtime.sockets.length, 2); f.alive(); assert.equal(f.resyncs(), 2);
  } finally { f.manager.destroy(); }
});

test("a long event-loop pause opens a replacement proactively and keeps the pool bounded", () => {
  const f = fixture();
  try {
    f.alive(); f.runtime.jump(60_000);
    assert.ok(f.runtime.sockets.length >= 2);
    for (let i = 0; i < 20; i++) f.runtime.window.dispatchEvent(new Event("online"));
    assert.ok(f.manager.getStats().pool.filter((c) => c.state !== "DEAD").length <= 3);
  } finally { f.manager.destroy(); }
});
