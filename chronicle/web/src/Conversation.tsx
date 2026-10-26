import { useEffect, useRef, useState } from 'react';
import { ContentView, Scope, Operation_GetSession, Operation_GetChunks, Operation_GetMessages, Operation_GetRaw, Operation_Related, Operation_LocateMessage, Result_Session, Result_Chunks, Result_Messages, Result_Raw, Result_Related, Result_LocatedMessage, type UserInfo, type ArchiveRow, type Chunk, type ChunksResult, type Message, type MessagesResult, type Span } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { useInfiniteResource } from './infinite.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { ErrorNotice, SessionMeta, Tags, formatDate } from './App.tsx';
import { highlightUtf8 } from './highlight.ts';
import { contentViewKey, sameContentView, requireContentView } from './source-view.ts';
import type { ManagerStats } from './transport/types.ts';
const MESSAGE_PAGE_SIZE = 40;
const ANNOTATION_PAGE_SIZE = 40;
function OriginalMessage({ message, spans }: { message: Message; spans: readonly Span[] }) {
  let error: string | null = null;
  let parts;
  try { parts = highlightUtf8(message.text, spans.filter(span => span.messageId === message.id)); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid source span'; parts = [{ text: message.text, highlighted: false }]; }
  const text = <pre>{parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</pre>;
  return <article id={`message-${message.id}`} data-scroll-anchor={message.id} className={`original-message ${spans.some(span => span.messageId === message.id) ? 'highlighted-message' : ''}`}><header><strong>{message.role}</strong><span>{message.timestamp ? new Date(message.timestamp).toLocaleString() : 'time not recorded'}</span><code>#{message.recordIndex}</code></header>{error !== null && <ErrorNotice>{error}. Showing the unchanged source without highlighting.</ErrorNotice>}{message.text.length > 20_000 ? <details><summary>Read full message ({message.text.length.toLocaleString()} characters)</summary>{text}</details> : text}<footer><code>{message.id}</code>{message.parentId && <span>parent: {message.parentId}</span>}</footer></article>;
}
interface ConversationProps {
  connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; sessionId: string;
  initialView: ContentView | undefined; archiveHead: ArchiveRow | null; select: (id: string) => void; refresh: number;
}
export function Conversation(props: ConversationProps) {
  const [view, setView] = useState<ContentView | undefined>(props.initialView);
  return <ConversationSnapshot key={contentViewKey(view)} {...props} view={view} chooseView={setView}/>;
}
function ConversationSnapshot({ connection, stats, user, sessionId, archiveHead, select, refresh, view, chooseView }: ConversationProps & { view: ContentView | undefined; chooseView: (view: ContentView | undefined) => void }) {
  const [messageStart, setMessageStart] = useState(0), [raw, setRaw] = useState(false), [chunk, setChunk] = useState<Chunk | null>(null);
  const [seekError, setSeekError] = useState<string | null>(null), [seeking, setSeeking] = useState(false);
  const navigation = useRef(0), pendingScroll = useRef<{ messageId: string; operation: number } | null>(null), sourcePane = useRef<HTMLElement>(null);
  useEffect(() => connection.onInvalidate(() => { navigation.current++; pendingScroll.current = null; setChunk(null); setRaw(false); setSeeking(false); setSeekError(null); }), [connection]);
  useEffect(() => () => { navigation.current++; pendingScroll.current = null; }, []);
  const session = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}`, `${refresh}`, true, async () => {
    const result = await read(connection, new Operation_GetSession(sessionId, view), value => value instanceof Result_Session ? value.result : null);
    if (view !== undefined) requireContentView(view, result.session.view);
    return result;
  });
  useEffect(() => { if (view === undefined && session.data !== null) chooseView(session.data.session.view); }, [view, session.data, chooseView]);
  const snapshot = view === undefined ? null : session.data;
  const annotations = useInfiniteResource<Chunk, ChunksResult, number>(connection, stats, `${sessionId}:${contentViewKey(view)}`, `${refresh}`, snapshot !== null, undefined, async cursor => {
    const offset = cursor === undefined ? 0 : cursor;
    const result = await read(connection, new Operation_GetChunks(sessionId, offset, ANNOTATION_PAGE_SIZE, view), value => value instanceof Result_Chunks ? value.result : null);
    requireContentView(view!, result.view);
    return { items: result.chunks, next: result.offset + result.chunks.length < result.total ? result.offset + result.chunks.length : undefined, previous: undefined, meta: result };
  }, item => item.id);
  useEffect(() => {
    if (annotations.error !== null || (chunk !== null && annotations.meta !== null && !annotations.refreshing && !annotations.items.some(item => item.id === chunk.id))) { setChunk(null); pendingScroll.current = null; }
  }, [annotations.error, annotations.items, annotations.meta, annotations.refreshing, chunk]);
  const messages = useInfiniteResource<Message, MessagesResult, number>(connection, stats, `${sessionId}:${contentViewKey(view)}:${messageStart}`, `${refresh}`, !raw && snapshot !== null, messageStart, async cursor => {
    const offset = cursor === undefined ? messageStart : cursor;
    const result = await read(connection, new Operation_GetMessages(sessionId, offset, MESSAGE_PAGE_SIZE, view), value => value instanceof Result_Messages ? value.result : null);
    requireContentView(view!, result.view);
    return { items: result.messages, next: result.offset + result.messages.length < result.total ? result.offset + result.messages.length : undefined, previous: result.offset > 0 ? Math.max(0, result.offset - MESSAGE_PAGE_SIZE) : undefined, meta: result };
  }, item => item.id);
  const rawSource = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}`, `${refresh}`, raw && snapshot !== null && user.scopes.includes(Scope.Raw), async () => {
    const result = await read(connection, new Operation_GetRaw(sessionId, view!.revision), value => value instanceof Result_Raw ? value.result : null);
    if (result.revision !== view!.revision) throw new Error('Raw source revision changed unexpectedly; no raw records are retained.');
    return result;
  });
  const related = useResource(connection, stats, sessionId, `${refresh}`, snapshot !== null, () => read(connection, new Operation_Related(sessionId, 6), value => value instanceof Result_Related ? value.result : null));
  function scrollToMessage(messageId: string): boolean {
    const pane = sourcePane.current, target = document.getElementById(`message-${messageId}`);
    if (pane === null || target === null || !pane.contains(target)) return false;
    const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - 48;
    pane.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return true;
  }
  useEffect(() => {
    const pending = pendingScroll.current;
    if (pending !== null && pending.operation === navigation.current && messages.items.some(item => item.id === pending.messageId) && scrollToMessage(pending.messageId)) pendingScroll.current = null;
  }, [messages.items]);
  async function showChunk(selected: Chunk) {
    const operation = ++navigation.current; pendingScroll.current = null;
    setRaw(false); setChunk(selected); setSeekError(null); setSeeking(false);
    const target = selected.spans[0]?.messageId;
    if (target === undefined) { setSeekError('This passage has no source span.'); return; }
    if (messages.items.some(message => message.id === target) && scrollToMessage(target)) return;
    pendingScroll.current = { messageId: target, operation }; setSeeking(true);
    try {
      const location = await read(connection, new Operation_LocateMessage(sessionId, view!, target), value => value instanceof Result_LocatedMessage ? value.result : null);
      if (navigation.current !== operation) return;
      requireContentView(view!, location.view);
      if (!Number.isInteger(location.position) || location.position < 0 || location.position >= location.total) throw new Error('The source locator returned an invalid message position.');
      setMessageStart(Math.floor(location.position / MESSAGE_PAGE_SIZE) * MESSAGE_PAGE_SIZE);
    } catch (cause) { if (navigation.current === operation) { pendingScroll.current = null; setSeekError(cause instanceof Error ? cause.message : 'Source navigation failed'); } }
    finally { if (navigation.current === operation) setSeeking(false); }
  }
  const headRevision = snapshot === null ? archiveHead === null ? undefined : archiveHead.head.revision : snapshot.session.revision;
  const publishedView = archiveHead === null ? undefined : archiveHead.publishedView;
  return <>{(session.loading || (snapshot === null && session.error === null)) && <div className="loading-line" role="status">Rechecking source access…</div>}{session.error !== null && <ErrorNotice>{session.error}. Source content has been cleared.</ErrorNotice>}
    {snapshot !== null && <><div className="conversation-intro"><SessionMeta session={snapshot.session}/><h2>{snapshot.session.metadata.title || 'Untitled conversation'}</h2><div className="provenance"><span>Owner <strong>{snapshot.session.ownerId}</strong></span><span>Viewing source r{view!.revision}</span><span>HEAD r{headRevision} / index {snapshot.session.indexedRevision === undefined ? 'pending' : `r${snapshot.session.indexedRevision}`}</span>{headRevision !== undefined && snapshot.session.indexedRevision !== undefined && snapshot.session.indexedRevision < headRevision && <span>Indexing lag: {headRevision - snapshot.session.indexedRevision} source revisions</span>}{view!.generationId === undefined && <span>Archive-only view · no annotations</span>}<span>{snapshot.session.completion === 'Quiescent' ? 'Quiescent snapshot · may resume' : 'Closed source'}</span>{snapshot.session.redacted && <span>Redacted before upload</span>}</div>
      {archiveHead?.matchedView !== undefined && <p className="tiny">Representative matched view. Boolean text operands can match different revisions; this view does not explain every operand.</p>}
      <div className="button-row source-view-actions"><button className="small-button" onClick={() => chooseView(undefined)}>Reload source snapshot ↻</button>{headRevision !== undefined && (view!.revision !== headRevision || view!.generationId !== undefined) && <button className="small-button" onClick={() => chooseView(new ContentView(headRevision, undefined))}>View latest archived revision</button>}{publishedView !== undefined && !sameContentView(view!, publishedView) && <button className="small-button" onClick={() => chooseView(publishedView)}>View published annotations</button>}</div>
      <details className="provenance-details"><summary>Provenance & metadata</summary><Tags tags={snapshot.session.metadata.tags}/><dl><dt>Source identity</dt><dd>{snapshot.session.source.discoveryRootId} / {snapshot.session.source.collectorNamespace} / {snapshot.session.source.producerSessionId}</dd><dt>Producer / model</dt><dd>{snapshot.session.metadata.producer} / {snapshot.session.metadata.model ?? 'not recorded'}</dd><dt>Work directory</dt><dd>{snapshot.session.metadata.workdir ?? 'not recorded'}</dd><dt>Git remote</dt><dd>{snapshot.session.metadata.gitRemote ?? 'not recorded'}</dd><dt>Branch / commit</dt><dd>{snapshot.session.metadata.gitBranch ?? 'not recorded'} / {snapshot.session.metadata.gitCommit ?? 'not recorded'}</dd><dt>Source dates</dt><dd>{formatDate(snapshot.session.metadata.startedAt)} – {formatDate(snapshot.session.metadata.endedAt)}</dd><dt>Annotation generation</dt><dd><code>{view!.generationId ?? 'none · archive-only view'}</code></dd><dt>Archive identity</dt><dd><code>{sessionId}</code></dd></dl></details></div>
      <ScrollAnchor><div className="conversation-panes"><aside className="conversation-passages" aria-label="Annotated passages" data-scroll-container><div className="pane-heading"><h3>Annotated passages</h3><span>{annotations.meta?.total ?? (annotations.loading ? 'Loading…' : 'Unavailable')}</span></div>{annotations.error !== null && <ErrorNotice>{annotations.error}. Annotation content has been cleared.</ErrorNotice>}{annotations.loading && <p className="tiny" role="status">Loading annotations…</p>}{annotations.updateAvailable && <button className="text-button" onClick={annotations.applyUpdates}>Updated passages available</button>}
        <div className="passage-list">{annotations.items.map((item, index) => <button className={`passage ${chunk?.id === item.id ? 'selected-passage' : ''}`} data-scroll-anchor={item.id} key={item.id} onClick={() => void showChunk(item)}><span className="passage-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.summary || 'Source passage'}</strong><Tags tags={item.tags}/><span className="tiny">Read original messages →</span></span></button>)}</div>{annotations.meta?.total === 0 && <p className="tiny empty-passages">{view!.generationId === undefined ? 'This archive-only view has no annotations. Original messages and permitted raw records remain readable.' : 'No passages in this annotation generation.'}</p>}<InfiniteTrigger enabled={annotations.hasMore && annotations.error === null} loading={annotations.loadingMore || annotations.refreshing} load={annotations.loadMore} label="Loading more passages…"/>
      </aside><section className="conversation-source" aria-label="Original messages" data-scroll-container ref={sourcePane}><div className="transcript-toolbar"><h3>{raw ? 'Permitted raw records' : 'Original messages'}</h3><span className="tiny">{messages.meta === null ? '' : `${messages.items.length} shown / ${messages.meta.total}`}</span><button className={raw ? 'small-button toggled' : 'small-button'} disabled={!user.scopes.includes(Scope.Raw)} onClick={() => { navigation.current++; pendingScroll.current = null; setSeeking(false); setRaw(value => !value); }} aria-pressed={raw}>{raw ? 'Back to messages' : 'Request raw records'}</button></div>{!user.scopes.includes(Scope.Raw) && <p className="tiny raw-permission">Raw access requires the separate Raw permission.</p>}{seekError !== null && <ErrorNotice>{seekError}</ErrorNotice>}{seeking && <p className="tiny" role="status">Locating the original message…</p>}
        {raw ? <div className="raw-source"><p className="notice">Original records from source r{view!.revision} may contain sensitive fields. Raw authorization is rechecked by the server.</p>{rawSource.loading && <p role="status">Requesting raw permission…</p>}{rawSource.error !== null && <ErrorNotice>{rawSource.error}. No raw records are retained.</ErrorNotice>}{rawSource.data?.files.map(file => <details key={file.path}><summary>{file.path}</summary><p className="tiny">SHA-256 {file.sha256}</p><pre>{file.content}</pre></details>)}</div> : <div className="transcript" aria-busy={messages.loading || messages.refreshing}><InfiniteTrigger enabled={messages.hasPrevious && messages.error === null} loading={messages.loadingPrevious || messages.refreshing} load={messages.loadPrevious} label="Loading earlier messages…"/>{messages.error !== null && <ErrorNotice>{messages.error}. Message content has been cleared.</ErrorNotice>}{messages.loading && <div className="loading-line" role="status">Loading original messages…</div>}{messages.items.map(message => <OriginalMessage key={message.id} message={message} spans={chunk?.spans ?? []}/>)}{messages.meta?.total === 0 && <p className="tiny">No messages in this source revision.</p>}<InfiniteTrigger enabled={messages.hasMore && messages.error === null} loading={messages.loadingMore || messages.refreshing} load={messages.loadMore} label="Loading later messages…"/></div>}
        <section className="related"><h3>Related sessions</h3>{related.error !== null && <ErrorNotice>{related.error}</ErrorNotice>}{related.loading && <p className="tiny" role="status">Resolving related conversations…</p>}{related.data?.sessions.map(hit => <button className="related-link" key={hit.session.id} onClick={() => select(hit.session.id)}><span>{hit.session.metadata.title}</span><span aria-hidden="true">↗</span></button>)}{related.data?.sessions.length === 0 && <p className="tiny">No related conversations available.</p>}</section>
      </section></div></ScrollAnchor>
    </>}
  </>;
}
