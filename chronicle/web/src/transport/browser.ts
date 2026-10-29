import { ConnectionManager } from './manager.ts';
import { randomUUID } from '../uuid.ts';
import { baboonProtocol } from './baboon.ts';
import { connectionConfig } from './types.ts';
import type { Lifecycle, LifecycleEvent, Socket, ConnectionConfig } from './types.ts';
import type { Operation } from '../../../generated/typescript/chronicle/api/Operation.ts';
import type { Result } from '../../../generated/typescript/chronicle/api/Result.ts';
export function browserLifecycle(win: Window, doc: Document): Lifecycle {
  return {
    hidden: () => doc.visibilityState === 'hidden',
    subscribe(callback) {
      const cleanups: (() => void)[] = [];
      function on(target: EventTarget, name: string, handler: (event: Event) => void) {
        target.addEventListener(name, handler); cleanups.push(() => target.removeEventListener(name, handler));
      }
      on(doc, 'visibilitychange', () => callback(doc.visibilityState === 'hidden' ? 'hidden' : 'visible'));
      for (const name of ['freeze', 'resume']) on(doc, name, () => callback(name as LifecycleEvent));
      for (const name of ['online', 'offline']) on(win, name, () => callback(name as LifecycleEvent));
      on(win, 'focus', () => callback('focus'));
      on(win, 'pagehide', () => callback('pagehide'));
      on(win, 'pageshow', event => { if ((event as PageTransitionEvent).persisted) callback('pageshow'); });
      const network: unknown = Reflect.get(win.navigator, 'connection');
      if (network instanceof EventTarget) on(network, 'change', () => callback('network-change'));
      return () => { for (const cleanup of cleanups) cleanup(); };
    },
  };
}
export function nativeSocket(url: string): Socket {
  const ws = new WebSocket(url);
  const socket: Socket = {
    get readyState() { return ws.readyState; }, onopen: null, onmessage: null, onclose: null, onerror: null,
    send: data => ws.send(data), close: (code, reason) => ws.close(code, reason),
  };
  ws.onopen = () => { if (socket.onopen) socket.onopen(); };
  ws.onmessage = event => {
    if (typeof event.data !== 'string') { ws.close(1003, 'Only text messages are supported'); return; }
    if (socket.onmessage) socket.onmessage(event.data);
  };
  ws.onclose = event => { if (socket.onclose) socket.onclose(event.code, event.reason); };
  ws.onerror = () => { if (socket.onerror) socket.onerror(); };
  return socket;
}
export function createBrowserManager(win: Window, doc: Document, config: ConnectionConfig): ConnectionManager<Operation, Result> {
  const url = new URL('/api/ws', win.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new ConnectionManager({
    scheduler: { now: () => Date.now(), setTimeout: (fn, delay) => win.setTimeout(fn, delay), clearTimeout: id => win.clearTimeout(id) },
    lifecycle: browserLifecycle(win, doc), socket: () => nativeSocket(url.href),
    random: () => { const bytes = new Uint32Array(1); win.crypto.getRandomValues(bytes); return bytes[0]! / 2 ** 32; },
    nonce: () => randomUUID(win.crypto), protocol: () => baboonProtocol(() => randomUUID(win.crypto)), config,
  });
}
export { connectionConfig };
