import { useEffect, useRef, useState } from 'react';
import type { ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
export function useConnection(connection: ChronicleConnection): ManagerStats {
  const [stats, setStats] = useState(() => connection.stats());
  useEffect(() => connection.onUpdate(() => setStats(connection.stats())), [connection]);
  return stats;
}
export interface Resource<T> { data: T | null; loading: boolean; refreshing: boolean; error: string | null }
export interface ResourceConnection { onInvalidate(callback: () => void): () => void }
interface ResourceState<T> extends Resource<T> { connection: ResourceConnection; generation: number; activeId: number | null; key: string }
export function useResource<T>(connection: ResourceConnection, stats: ManagerStats, key: string, refresh: string, enabled: boolean, load: () => Promise<T>): Resource<T> {
  const ready = enabled && stats.activeId !== null;
  const [state, setState] = useState<ResourceState<T>>({ connection, generation: stats.generation, activeId: stats.activeId, key, data: null, loading: ready, refreshing: false, error: null });
  const sequence = useRef(0), loader = useRef(load); loader.current = load;
  useEffect(() => connection.onInvalidate(() => {
    sequence.current++;
    setState(current => ({ ...current, data: null, loading: false, refreshing: false, error: null }));
  }), [connection]);
  useEffect(() => {
    const current = ++sequence.current; let mounted = true;
    const scope = { connection, generation: stats.generation, activeId: stats.activeId, key };
    setState(previous => {
      const retain = ready && previous.connection === connection && previous.generation === stats.generation && previous.activeId === stats.activeId && previous.key === key;
      const data = retain ? previous.data : null;
      return { ...scope, data, loading: ready && data === null, refreshing: ready && data !== null, error: null };
    });
    if (ready) {
      void loader.current().then(data => {
        if (mounted && sequence.current === current) setState({ ...scope, data, loading: false, refreshing: false, error: null });
      }).catch((error: unknown) => {
        if (mounted && sequence.current === current) setState({ ...scope, data: null, loading: false, refreshing: false, error: error instanceof Error ? error.message : 'Request failed' });
      });
    }
    return () => { mounted = false; sequence.current++; };
  }, [connection, stats.generation, stats.activeId, key, refresh, enabled]);
  if (!enabled || state.connection !== connection || state.generation !== stats.generation || state.activeId !== stats.activeId || state.key !== key) return { data: null, loading: ready, refreshing: false, error: null };
  return state;
}
