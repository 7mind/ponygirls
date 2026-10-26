import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useResource } from '../src/hooks.ts';
import type { ManagerStats } from '../src/transport/types.ts';

interface PendingRead { id: number; resolve: (value: string) => void; reject: (error: Error) => void }
class ResourceFixture {
  private listeners = new Set<() => void>();
  onInvalidate(callback: () => void) { this.listeners.add(callback); return () => { this.listeners.delete(callback); }; }
  invalidate() { for (const listener of this.listeners) listener(); }
}
const stats: ManagerStats = { sockets: [], activeId: 1, generation: 1, attempts: 0, maxAttempts: 3, retryAt: null, retryStartedAt: null, deferred: false, frozen: false, terminal: null, lastClose: null, sentPings: 0, lostPings: 0, rtt: [], events: [] };
function Resources() {
  const [connection] = useState(() => new ResourceFixture());
  const [key, setKey] = useState('alice'), [refresh, setRefresh] = useState(0), [requests, setRequests] = useState<PendingRead[]>([]);
  const resource = useResource(connection, stats, key, `${refresh}`, true, () => new Promise<string>((resolve, reject) => {
    setRequests(current => [...current, { id: current.length, resolve, reject }]);
  }));
  return <><button onClick={() => setRefresh(value => value + 1)}>Refresh</button><button onClick={() => setKey('bob')}>Change identity</button><button onClick={() => connection.invalidate()}>Invalidate</button>
    <output aria-label="Resource data">{resource.data ?? 'empty'}</output><output aria-label="Resource error">{resource.error ?? 'none'}</output><output aria-label="Resource loading">{String(resource.loading)}</output><output aria-label="Resource refreshing">{String(resource.refreshing)}</output>
    {requests.map(request => <section aria-label={`Request ${request.id}`} key={request.id}><button onClick={() => request.resolve(`response-${request.id}`)}>Resolve</button><button onClick={() => request.reject(new Error(`failure-${request.id}`))}>Reject</button></section>)}</>;
}
const root = document.getElementById('root');
if (root === null) throw new Error('Fixture root missing');
createRoot(root).render(<Resources/>);
