import { useEffect, useRef, useState } from 'react';
import type { ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
import { SessionRenewal } from './session-renewal.ts';
import { browserLifecycle } from './transport/browser.ts';

export function useSessionRenewal(connection: ChronicleConnection, stats: ManagerStats, accountId: string | null) {
  const controller = useRef<SessionRenewal | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const renewal = new SessionRenewal({
      fetch: window.fetch.bind(window),
      scheduler: { now: () => Date.now(), setTimeout: (fn, delay) => window.setTimeout(fn, delay), clearTimeout: id => window.clearTimeout(id) },
      lifecycle: browserLifecycle(window, document), error: setError,
      unauthorized: () => connection.sessionExpired(), accountChanged: () => connection.retry(),
    });
    controller.current = renewal;
    const unsubscribe = connection.onInvalidate(() => renewal.setScope(null));
    return () => { unsubscribe(); renewal.dispose(); controller.current = null; };
  }, [connection]);
  useEffect(() => {
    controller.current?.setScope(accountId === null || stats.activeId === null || stats.terminal !== null ? null : { accountId, activeId: stats.activeId, generation: stats.generation });
  }, [connection, accountId, stats.activeId, stats.generation, stats.terminal]);
  return { error, retry: () => controller.current?.retry(), suspend: () => controller.current?.setScope(null) };
}
