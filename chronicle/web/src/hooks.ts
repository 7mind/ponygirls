import { useEffect, useRef, useState } from 'react';
import type { ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
export function useConnection(connection: ChronicleConnection): ManagerStats {
  const [stats, setStats] = useState(() => connection.stats());
  useEffect(() => connection.onUpdate(() => setStats(connection.stats())), [connection]);
  return stats;
}
export interface Resource<T> { data: T | null; loading: boolean; error: string | null }
export function useResource<T>(connection: ChronicleConnection, stats: ManagerStats, key: string, enabled: boolean, load: () => Promise<T>): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, loading: enabled && stats.activeId !== null, error: null });
  const sequence = useRef(0), loader = useRef(load); loader.current = load;
  useEffect(() => connection.onInvalidate(() => {
    sequence.current++; setState({ data: null, loading: false, error: null });
  }), [connection]);
  useEffect(() => {
    const current = ++sequence.current; let mounted = true;
    setState({ data: null, loading: enabled && stats.activeId !== null, error: null });
    if (enabled && stats.activeId !== null) {
      void loader.current().then(data => {
        if (mounted && sequence.current === current) setState({ data, loading: false, error: null });
      }).catch((error: unknown) => {
        if (mounted) setState({ data: null, loading: false, error: error instanceof Error ? error.message : 'Request failed' });
      });
    }
    return () => { mounted = false; sequence.current++; };
  }, [connection, stats.generation, stats.activeId, key, enabled]);
  return state;
}
