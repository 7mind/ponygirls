import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useResource } from '../src/hooks.ts';
import type { ManagerStats } from '../src/transport/types.ts';
import { Dialog } from '../src/Dialog.tsx';
import { useInfiniteResource } from '../src/infinite.ts';
import type { InfinitePage } from '../src/infinite.ts';
import { ScrollAnchor } from '../src/ScrollAnchor.tsx';
import '../src/styles.css';

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
function DialogFixture() {
  const [open, setOpen] = useState(false);
  return <><div style={{ height: 1100 }}><button>Outside focus</button></div><button onClick={() => setOpen(true)}>Open conversation</button><div style={{ height: 1100 }}/>{open && <Dialog title="Synthetic conversation" close={() => setOpen(false)}><div className="conversation-panes"><aside className="conversation-passages" aria-label="Passages">{Array.from({ length: 80 }, (_, index) => <button key={index} style={{ display: 'block', margin: 8 }}>Passage {index + 1}</button>)}</aside><section className="conversation-source" aria-label="Messages">{Array.from({ length: 80 }, (_, index) => <p key={index} style={{ padding: 14 }}>Synthetic message {index + 1}</p>)}<button>Last dialog action</button><details><summary>Last dialog details</summary><p>Keyboard-accessible synthetic details.</p></details></section></div></Dialog>}</>;
}
interface PageItem { id: string; text: string }
interface PageRequest { id: number; cursor: string | undefined; mode: string; owner: string; resolve: (page: InfinitePage<PageItem, string, string>) => void; reject: (error: Error) => void }
function InfiniteFixture() {
  const [connection] = useState(() => new ResourceFixture());
  const [owner, setOwner] = useState('alice'), [mode, setMode] = useState('normal'), [refresh, setRefresh] = useState(0), [requests, setRequests] = useState<PageRequest[]>([]);
  const resource = useInfiniteResource<PageItem, string, string>(connection, stats, owner, `${refresh}`, true, undefined, cursor => new Promise((resolve, reject) => {
    setRequests(current => [...current, { id: current.length, cursor, mode, owner, resolve, reject }]);
  }), item => item.id);
  function resolve(request: PageRequest) {
    const ids = request.mode === 'arrivals' ? request.cursor === undefined ? ['x', 'a'] : ['b', 'c'] : request.mode === 'shrink' ? request.cursor === undefined ? ['a', 'c'] : ['e'] : request.cursor === undefined ? ['a', 'b'] : ['c', 'd'];
    request.resolve({ items: ids.map(id => ({ id: `${request.owner}-${id}`, text: `${request.mode}-${id}` })), next: request.cursor === undefined ? '2' : undefined, previous: undefined, meta: request.mode });
  }
  return <><button onClick={resource.loadMore}>Load edge</button><button onClick={() => { setMode('arrivals'); setRefresh(value => value + 1); }}>Arrivals refresh</button><button onClick={() => { setMode('shrink'); setRefresh(value => value + 1); }}>Shrink refresh</button><button onClick={() => setOwner('bob')}>Change identity</button><button onClick={() => connection.invalidate()}>Invalidate</button><button onClick={resource.applyUpdates}>Apply updates</button><output aria-label="Pending updates">{String(resource.updateAvailable)}</output><output aria-label="Page error">{resource.error ?? 'none'}</output><output aria-label="Page refreshing">{String(resource.refreshing)}</output>
    <ScrollAnchor><div data-scroll-container className="fixture-pages" style={{ height: 100, overflowY: 'auto' }}>{resource.items.map(item => <article data-scroll-anchor={item.id} data-item-id={item.id} key={item.id} style={{ height: 100 }}><button>{item.id}</button><p>{item.text}</p></article>)}</div></ScrollAnchor>
    {requests.map(request => <section aria-label={`Page request ${request.id}`} key={request.id}><span>{request.cursor ?? 'first'}</span><button onClick={() => resolve(request)}>Resolve</button><button onClick={() => request.reject(new Error(`failure-${request.id}`))}>Reject</button></section>)}</>;
}
const root = document.getElementById('root');
if (root === null) throw new Error('Fixture root missing');
const scene = new URLSearchParams(window.location.search);
createRoot(root).render(scene.has('dialog') ? <DialogFixture/> : scene.has('infinite') ? <InfiniteFixture/> : <Resources/>);
