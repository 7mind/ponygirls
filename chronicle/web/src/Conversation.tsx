import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SessionFind } from './SessionFind.tsx';
import { recordedYoloProfile } from './recorded-yolo-profile.ts';
import type { SessionFindReadGate } from './session-find.ts';
import { ContentView, Span, PassageFormat, Operation_GetPassages, Operation_GetPassageSpans, Result_Passages, Result_PassageSpans, type PassageInfo, type PassagesResult, Scope, Operation_GetSession, Operation_GetMessages, Operation_GetRaw, Operation_Related, Operation_LocateMessage, Result_Session, Result_Messages, Result_Raw, Result_Related, Result_LocatedMessage, type UserInfo, type ArchiveRow, type Message, type MessagesResult, type Operation, type Result } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { useInfiniteResource } from './infinite.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { ErrorNotice, SessionMeta, Tags, formatDate } from './App.tsx';
import { highlightUtf8 } from './highlight.ts';
import { contentViewKey, sameContentView, requireContentView } from './source-view.ts';
import { PASSAGE_PAGE_SIZE, validatePassages, validatePassageSpans } from './passages.ts';
import './passages.css';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
const MESSAGE_PAGE_SIZE = 40;
const SOURCE_SCROLL_GAP = 8;
type SourceNavigationOrigin = 'annotation' | 'find';
interface SourceNavigation { operation: number; origin: SourceNavigationOrigin }
interface PendingSourceScroll extends SourceNavigation { messageId: string; position: number }
class UnverifiedSourceLocator extends Error {}
function OriginalMessage({ message, spans, reveal, landedPosition }: { message: Message; spans: readonly Span[]; reveal: number; landedPosition: number | null }) {
  const fullText = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (reveal > 0 && fullText.current !== null) fullText.current.open = true; }, [reveal]);
  let error: string | null = null;
  let parts;
  try { parts = highlightUtf8(message.text, spans.filter(span => span.messageId === message.id)); }
  catch (cause) { error = cause instanceof Error ? cause.message : 'Invalid source span'; parts = [{ text: message.text, highlighted: false }]; }
  const text = <pre>{parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</pre>;
  return <article id={`message-${message.id}`} data-scroll-anchor={message.id} aria-current={landedPosition === null ? undefined : 'location'} className={`original-message ${spans.some(span => span.messageId === message.id) ? 'highlighted-message' : ''}`}><header><strong>{message.role}</strong><span>{message.timestamp ? new Date(message.timestamp).toLocaleString() : 'time not recorded'}</span><code>Raw record #{message.recordIndex}</code></header>{landedPosition !== null && <p className="find-landing" tabIndex={-1}>Find result · normalized message {landedPosition + 1} · {message.id}</p>}{error !== null && <ErrorNotice>{error}. Showing the unchanged source without highlighting.</ErrorNotice>}{message.text.length > 20_000 ? <details ref={fullText}><summary>Read full message ({message.text.length.toLocaleString()} characters)</summary>{text}</details> : text}<footer><code>{message.id}</code>{message.parentId && <span>parent: {message.parentId}</span>}</footer></article>;
}
interface ConversationProps {
  connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; sessionId: string;
  initialView: ContentView | undefined; archiveHead: ArchiveRow | null; select: (id: string) => void; refresh: number; findReads: SessionFindReadGate;
}
interface HeadScope { connection: ChronicleConnection; userId: string; sessionId: string; generation: number; activeId: number | null; invalidation: number }
interface KnownHead extends HeadScope { ownerId: string; revision: number }
function sameHeadScope(left: HeadScope, right: HeadScope): boolean {
  return left.connection === right.connection && left.userId === right.userId && left.sessionId === right.sessionId && left.generation === right.generation && left.activeId === right.activeId && left.invalidation === right.invalidation;
}
export function Conversation(props: ConversationProps) {
  const [view, setView] = useState<ContentView | undefined>(props.initialView), [knownHead, setKnownHead] = useState<KnownHead | null>(null);
  const invalidation = useRef(0);
  const scope: HeadScope = { connection: props.connection, userId: props.user.id, sessionId: props.sessionId, generation: props.stats.generation, activeId: props.stats.activeId, invalidation: invalidation.current };
  const liveScope = useRef(scope); liveScope.current = scope;
  useEffect(() => props.connection.onInvalidate(() => {
    if (liveScope.current.connection !== props.connection) return;
    invalidation.current++; liveScope.current = { ...liveScope.current, invalidation: invalidation.current }; setKnownHead(null);
  }), [props.connection]);
  function rememberHead(ownerId: string, revision: number) {
    if (scope.activeId === null || !sameHeadScope(scope, liveScope.current)) return;
    setKnownHead(previous => {
      if (!sameHeadScope(scope, liveScope.current)) return previous;
      if (previous !== null && sameHeadScope(previous, scope) && previous.ownerId === ownerId && previous.revision >= revision) return previous;
      return { ...scope, ownerId, revision };
    });
  }
  return <ConversationSnapshot key={contentViewKey(view)} {...props} view={view} chooseView={setView} knownHead={knownHead !== null && sameHeadScope(knownHead, scope) ? knownHead : null} rememberHead={rememberHead}/>;
}
function ConversationSnapshot({ connection, stats, user, sessionId, archiveHead, select, refresh, view, chooseView, knownHead, rememberHead, findReads }: ConversationProps & { view: ContentView | undefined; chooseView: (view: ContentView | undefined) => void; knownHead: KnownHead | null; rememberHead: (ownerId: string, revision: number) => void }) {
  const [messageStart, setMessageStart] = useState(0), [raw, setRaw] = useState(false), [retired, setRetired] = useState(false);
  const [passage, setPassage] = useState<PassageInfo | null>(null), [spanOffset, setSpanOffset] = useState(0);
  const [seekError, setSeekError] = useState<string | null>(null), [seeking, setSeeking] = useState(false), [revealedMessage, setRevealedMessage] = useState<string | null>(null);
  const [revealEpoch, setRevealEpoch] = useState(0), [findEpoch, setFindEpoch] = useState(0);
  const [landed, setLanded] = useState<PendingSourceScroll | null>(null);
  const navigation = useRef(0), currentSourceNavigation = useRef<SourceNavigation | null>(null), pendingScroll = useRef<PendingSourceScroll | null>(null), sourcePane = useRef<HTMLElement>(null);
  const retiredHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (retired && document.activeElement === document.body && retiredHeading.current !== null) retiredHeading.current.focus({ preventScroll: true });
  }, [retired]);
  const accessEpoch = useRef(0), accessScope = JSON.stringify([user.id, stats.activeId, stats.generation, contentViewKey(view)]), liveAccessScope = useRef(accessScope); liveAccessScope.current = accessScope;
  function retireIndexedView() { navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setPassage(null); setSpanOffset(0); setRaw(false); setSeeking(false); setSeekError(null); setRevealedMessage(null); setFindEpoch(epoch => epoch + 1); setRetired(true); }
  async function readPinned<T>(operation: Operation, extract: (reply: Result) => T | null): Promise<T> {
    const epoch = accessEpoch.current;
    try { return await read(connection, operation, extract); }
    catch (cause) { if (cause instanceof RequestFailure && cause.code === 'indexed-view-retired' && epoch === accessEpoch.current && liveAccessScope.current === accessScope) retireIndexedView(); throw cause; }
  }
  useEffect(() => connection.onInvalidate(() => { accessEpoch.current++; navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setPassage(null); setSpanOffset(0); setRetired(false); setRaw(false); setSeeking(false); setSeekError(null); setRevealedMessage(null); }), [connection]);
  useEffect(() => () => { accessEpoch.current++; navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; }, []);
  const session = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}`, `${refresh}`, true, async () => {
    const result = await readPinned(new Operation_GetSession(sessionId, view), value => value instanceof Result_Session ? value.result : null);
    if (view !== undefined) requireContentView(view, result.session.view);
    return result;
  });
  useEffect(() => { if (view === undefined && session.data !== null) chooseView(session.data.session.view); }, [view, session.data, chooseView]);
  const snapshot = view === undefined || retired ? null : session.data;
  const passages = useInfiniteResource<PassageInfo, PassagesResult, number>(connection, stats, `${sessionId}:${contentViewKey(view)}`, `${refresh}`, snapshot !== null, undefined, async cursor => {
    const offset = cursor === undefined ? 0 : cursor;
    const result = validatePassages(await readPinned(new Operation_GetPassages(sessionId, view!, offset, PASSAGE_PAGE_SIZE), reply => reply instanceof Result_Passages ? reply.result : null), view!, offset);
    return { items: result.passages, next: result.format === PassageFormat.ContextAwareProblems && BigInt(result.offset + result.passages.length) < result.total ? result.offset + result.passages.length : undefined, previous: undefined, meta: result };
  }, item => item.id);
  const sourceSpans = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}:${passage?.id ?? 'none'}:${spanOffset}`, `${refresh}`, snapshot !== null && passage !== null && passages.error === null, async () => validatePassageSpans(await readPinned(new Operation_GetPassageSpans(sessionId, view!, passage!.id, spanOffset, PASSAGE_PAGE_SIZE), reply => reply instanceof Result_PassageSpans ? reply.result : null), view!, passage!.id, spanOffset));
  useEffect(() => {
    if (passages.error !== null || (passage !== null && passages.meta !== null && !passages.refreshing && !passages.items.some(item => item.id === passage.id))) { setPassage(null); pendingScroll.current = null; }
  }, [passages.error, passages.items, passages.meta, passages.refreshing, passage]);
  const messages = useInfiniteResource<Message, MessagesResult, number>(connection, stats, `${sessionId}:${contentViewKey(view)}:${messageStart}`, `${refresh}`, !raw && snapshot !== null, messageStart, async cursor => {
    const offset = cursor === undefined ? messageStart : cursor;
    const result = await readPinned(new Operation_GetMessages(sessionId, offset, MESSAGE_PAGE_SIZE, view), value => value instanceof Result_Messages ? value.result : null);
    requireContentView(view!, result.view);
    return { items: result.messages, next: result.offset + result.messages.length < result.total ? result.offset + result.messages.length : undefined, previous: result.offset > 0 ? Math.max(0, result.offset - MESSAGE_PAGE_SIZE) : undefined, meta: result };
  }, item => item.id);
  const rawSource = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}`, `${refresh}`, raw && snapshot !== null && user.scopes.includes(Scope.Raw), async () => {
    const result = await readPinned(new Operation_GetRaw(sessionId, view!.revision), value => value instanceof Result_Raw ? value.result : null);
    if (result.revision !== view!.revision) throw new Error('Raw source revision changed unexpectedly; no raw records are retained.');
    return result;
  });
  const related = useResource(connection, stats, sessionId, `${refresh}`, snapshot !== null, () => read(connection, new Operation_Related(sessionId, 6), value => value instanceof Result_Related ? value.result : null));
  function scrollToMessage(messageId: string, instant: boolean): boolean {
    const pane = sourcePane.current, target = document.getElementById(`message-${messageId}`);
    if (pane === null || target === null || !pane.contains(target)) return false;
    const toolbar = pane.querySelector<HTMLElement>('.transcript-toolbar'), inset = toolbar === null ? 0 : toolbar.getBoundingClientRect().height;
    const top = target.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - inset - SOURCE_SCROLL_GAP;
    pane.scrollTo({ top: Math.max(0, top), behavior: instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return true;
  }
  function finishSourceScroll(pending: PendingSourceScroll) {
    if (pending.origin === 'find') setLanded(pending);
    else scrollToMessage(pending.messageId, false);
    pendingScroll.current = null;
  }
  useEffect(() => {
    const pending = pendingScroll.current;
    if (pending !== null && pending.operation === navigation.current && messages.items.some(item => item.id === pending.messageId)) finishSourceScroll(pending);
  }, [messages.items, revealedMessage]);
  useLayoutEffect(() => {
    if (landed !== null && landed.operation === navigation.current && scrollToMessage(landed.messageId, true)) {
      const target = document.getElementById(`message-${landed.messageId}`);
      if (target !== null) { const marker = target.querySelector<HTMLElement>('.find-landing'); if (marker !== null) marker.focus({ preventScroll: true }); }
    }
  }, [landed]);
  useEffect(() => { if (session.error !== null || messages.error !== null) setLanded(null); }, [session.error, messages.error]);
  function backToFind() {
    const pane = sourcePane.current; if (pane === null) return;
    const panel = pane.querySelector<HTMLElement>('.session-find'), control = pane.querySelector<HTMLElement>('.find-hits button[aria-pressed=true]') ?? pane.querySelector<HTMLElement>('.session-find input');
    if (panel === null || control === null) return;
    const toolbar = pane.querySelector<HTMLElement>('.transcript-toolbar'), inset = toolbar === null ? 0 : toolbar.getBoundingClientRect().height;
    pane.scrollTo({ top: Math.max(0, panel.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop - inset - SOURCE_SCROLL_GAP), behavior: 'instant' }); control.focus({ preventScroll: true });
  }
  function supersedeFindNavigation() {
    const current = currentSourceNavigation.current;
    if (current === null || current.origin !== 'find') return;
    navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setSeeking(false); setSeekError(null);
  }
  async function showSource(target: string | undefined, expectedPosition: number | null, origin: SourceNavigationOrigin) {
    const operation = ++navigation.current; currentSourceNavigation.current = { operation, origin }; pendingScroll.current = null;
    setRaw(false); setSeekError(null); setSeeking(false); setLanded(null);
    if (target === undefined) { setSeekError('This annotation has no verified source span; no logical extent is asserted.'); return; }
    if (origin === 'annotation' && expectedPosition === null && messages.items.some(message => message.id === target) && scrollToMessage(target, false)) return;
    setSeeking(true);
    try {
      const location = await readPinned(new Operation_LocateMessage(sessionId, view!, target), value => value instanceof Result_LocatedMessage ? value.result : null);
      if (navigation.current !== operation) return;
      try { requireContentView(view!, location.view); } catch (cause) { throw new UnverifiedSourceLocator(cause instanceof Error ? cause.message : 'Unverified source pin.'); }
      if (!Number.isInteger(location.position) || location.position < 0 || location.position >= location.total || (expectedPosition !== null && location.position !== expectedPosition)) throw new UnverifiedSourceLocator('The source locator returned an invalid message position.');
      const pending: PendingSourceScroll = { messageId: target, operation, origin, position: location.position };
      if (messages.items.some(message => message.id === target)) finishSourceScroll(pending);
      else { pendingScroll.current = pending; setMessageStart(Math.floor(location.position / MESSAGE_PAGE_SIZE) * MESSAGE_PAGE_SIZE); }
    } catch (cause) { if (navigation.current === operation) { pendingScroll.current = null; setSeekError(cause instanceof Error ? cause.message : 'Source navigation failed'); if ((origin === 'find' && cause instanceof UnverifiedSourceLocator) || (cause instanceof RequestFailure && ['forbidden', 'not-found', 'unauthorized'].includes(cause.code))) setFindEpoch(epoch => epoch + 1); } }
    finally { if (navigation.current === operation) setSeeking(false); }
  }
  function showPassage(selected: PassageInfo) { setPassage(selected); setSpanOffset(0); void showSource(selected.start.messageId, selected.start.messagePosition, 'annotation'); }
  const highlightSpans = sourceSpans.data !== null && passage !== null ? sourceSpans.data.spans.map(span => new Span(span.messageId, span.start, span.end)) : [];
  const headRevision = snapshot === null ? undefined : Math.max(snapshot.session.revision, archiveHead !== null && archiveHead.head.id === sessionId && archiveHead.head.ownerId === snapshot.session.ownerId ? archiveHead.head.revision : snapshot.session.revision, knownHead !== null && knownHead.ownerId === snapshot.session.ownerId ? knownHead.revision : snapshot.session.revision);
  useEffect(() => { if (snapshot !== null && headRevision !== undefined) rememberHead(snapshot.session.ownerId, headRevision); }, [snapshot, headRevision, rememberHead]);
  const publishedView = archiveHead === null ? undefined : archiveHead.publishedView;
  return <>{retired && <section className="notice" role="region" aria-label="Indexed view unavailable"><h3 ref={retiredHeading} tabIndex={-1}>Indexed view unavailable</h3><p>This indexed view is unavailable because its derived generation was retired.</p>{view !== undefined && <button type="button" className="small-button" onClick={() => chooseView(new ContentView(view.revision, undefined))}>View archived source r{view.revision}</button>}<p className="tiny">This explicitly requests the same source revision without a generation. No HEAD or published view is selected automatically.</p></section>}{!retired && (session.loading || (snapshot === null && session.error === null)) && <div className="loading-line" role="status">Rechecking source access…</div>}{!retired && session.error !== null && <ErrorNotice>{session.error}. Source content has been cleared.</ErrorNotice>}
    {snapshot !== null && <><div className="conversation-intro"><SessionMeta session={snapshot.session}/><h2>{snapshot.session.metadata.title || 'Untitled conversation'}</h2><div className="provenance"><span>Owner <strong>{snapshot.session.ownerId}</strong></span><span>Viewing source r{view!.revision}</span><span>HEAD r{headRevision} / index {snapshot.session.indexedRevision === undefined ? 'pending' : `r${snapshot.session.indexedRevision}`}</span>{headRevision !== undefined && snapshot.session.indexedRevision !== undefined && snapshot.session.indexedRevision < headRevision && <span>Indexing lag: {headRevision - snapshot.session.indexedRevision} source revisions</span>}{view!.generationId === undefined && <span>Archive-only view · no annotations</span>}<span>{snapshot.session.completion === 'Quiescent' ? 'Quiescent snapshot · may resume' : 'Closed source'}</span>{snapshot.session.redacted && <span>Redacted before upload</span>}</div>
      {archiveHead?.matchedView !== undefined && <p className="tiny">Representative matched view. Boolean text operands can match different revisions; this view does not explain every operand.</p>}
      <div className="button-row source-view-actions"><button className="small-button" onClick={() => chooseView(undefined)}>Reload source snapshot ↻</button>{headRevision !== undefined && (view!.revision !== headRevision || view!.generationId !== undefined) && <button className="small-button" onClick={() => chooseView(new ContentView(headRevision, undefined))}>View latest archived revision</button>}{publishedView !== undefined && !sameContentView(view!, publishedView) && <button className="small-button" onClick={() => chooseView(publishedView)}>View published annotations</button>}</div>
      <details className="provenance-details"><summary>Provenance & metadata</summary><Tags tags={snapshot.session.metadata.tags}/><dl><dt>Source identity</dt><dd>{snapshot.session.source.discoveryRootId} / {snapshot.session.source.collectorNamespace} / {snapshot.session.source.producerSessionId}</dd><dt>Producer</dt><dd>{snapshot.session.metadata.producer}</dd><dt>Source format</dt><dd>{snapshot.session.source.format}</dd><dt>Recorded source model</dt><dd>{snapshot.session.metadata.model ?? 'not recorded'}</dd><dt title="Recorded source-root claim, not host or launch attestation">Recorded yolo profile</dt><dd>{recordedYoloProfile(snapshot.session.source.discoveryRootId) ?? 'not recorded'}</dd><dt>Recorded agent</dt><dd className="recorded-agent">{snapshot.session.source.subagentId === undefined ? 'Main · no recorded subagent ID' : `Subagent · ${snapshot.session.source.subagentId}`}</dd><dt>Work directory</dt><dd>{snapshot.session.metadata.workdir ?? 'not recorded'}</dd><dt>Git remote</dt><dd>{snapshot.session.metadata.gitRemote ?? 'not recorded'}</dd><dt>Branch / commit</dt><dd>{snapshot.session.metadata.gitBranch ?? 'not recorded'} / {snapshot.session.metadata.gitCommit ?? 'not recorded'}</dd><dt>Source dates</dt><dd>{formatDate(snapshot.session.metadata.startedAt)} – {formatDate(snapshot.session.metadata.endedAt)}</dd><dt>Annotation generation</dt><dd><code>{view!.generationId ?? 'none · archive-only view'}</code></dd><dt>Archive identity</dt><dd><code>{sessionId}</code></dd></dl></details></div>
      <ScrollAnchor><div className="conversation-panes"><aside className="conversation-passages" aria-label="Annotated passages" data-scroll-container><div className="pane-heading"><h3>Context-aware problems</h3><span>{passages.meta?.total.toString() ?? (passages.loading ? 'Loading…' : 'Unavailable')}</span></div>
        {passages.loading && <p className="tiny" role="status">Loading passage metadata…</p>}
        {passages.error !== null && <div className="notice" role="status"><p>Problem metadata unavailable. Original source remains readable; no legacy annotation fallback is used.</p><ErrorNotice>{passages.error}</ErrorNotice></div>}
        {passages.meta?.format === PassageFormat.Unindexed && <p className="tiny empty-passages">Unindexed · this exact source view has no published passage metadata. Original messages and permitted raw records remain readable.</p>}
        {passages.updateAvailable && <button className="text-button" onClick={passages.applyUpdates}>Updated problem passages available</button>}
        {passages.meta?.format === PassageFormat.ContextAwareProblems && <><p className="tiny passage-format">Context-aware problems · source UTF-8 byte offsets, end exclusive. Source messages remain unchanged; boundaries can fall inside one message.</p>{passages.meta.total === 0n && <p className="tiny empty-passages">No problems classified in this published context-aware generation.</p>}<div className="passage-list">{passages.items.map(item => <button className={`passage ${passage?.id === item.id ? 'selected-passage' : ''}`} data-scroll-anchor={item.id} key={item.id} onClick={() => showPassage(item)}><span className="passage-number">{item.ordinal + 1}</span><span><strong>{item.summary || 'Problem passage'}</strong><Tags tags={item.tags}/><span className="passage-extent tiny">Start #{item.start.messagePosition} {item.start.messageId} byte {item.start.byteOffset}<br/>End #{item.end.messagePosition} {item.end.messageId} byte {item.end.byteOffset}<br/>{item.sourceBytes.toString()} source bytes · {item.spanCount.toString()} spans · {item.pieceCount.toString()} retrieval pieces</span></span></button>)}</div><InfiniteTrigger enabled={passages.hasMore && passages.error === null} loading={passages.loadingMore || passages.refreshing} load={passages.loadMore} label="Loading more problem passages…"/></>}
        {passage !== null && <section className="passage-span-details" aria-label="Selected passage source spans"><h4>Source spans · {passage.summary}</h4><p className="tiny">Bounded pages of {PASSAGE_PAGE_SIZE}; source messages are unchanged, never concatenated with invented separators. Selecting a range navigates the pinned source pane. Highlighting covers only this span page.</p>{sourceSpans.loading && <p role="status">Reading source span page…</p>}{sourceSpans.error !== null && <ErrorNotice>{sourceSpans.error}</ErrorNotice>}<ol start={spanOffset + 1}>{sourceSpans.data?.spans.map((span, index) => <li key={`${span.messageId}:${span.start}:${index}`}><button className="text-button" onClick={() => void showSource(span.messageId, span.messagePosition, 'annotation')}>#{span.messagePosition} {span.messageId} · UTF-8 bytes [{span.start}, {span.end})</button></li>)}</ol><div className="button-row"><button className="small-button" disabled={spanOffset === 0 || sourceSpans.loading} onClick={() => setSpanOffset(n => Math.max(0, n - PASSAGE_PAGE_SIZE))}>Previous span page</button><button className="small-button" disabled={sourceSpans.data === null || sourceSpans.loading || BigInt(spanOffset + sourceSpans.data.spans.length) >= sourceSpans.data.total} onClick={() => setSpanOffset(n => n + PASSAGE_PAGE_SIZE)}>Next span page</button></div><p className="tiny">{sourceSpans.data === null ? 'Span count unavailable' : `${spanOffset + 1}–${spanOffset + sourceSpans.data.spans.length} / ${sourceSpans.data.total.toString()} source spans`}</p></section>}

      </aside><section className="conversation-source" aria-label="Original messages" data-scroll-container ref={sourcePane}><div className="transcript-toolbar"><h3>{raw ? 'Permitted raw records' : 'Original messages'}</h3><span className="tiny">{messages.meta === null ? '' : `${messages.items.length} shown / ${messages.meta.total}`}</span><button className={raw ? 'small-button toggled' : 'small-button'} disabled={!user.scopes.includes(Scope.Raw)} onClick={() => { navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setSeeking(false); setRaw(value => !value); }} aria-pressed={raw}>{raw ? 'Back to messages' : 'Request raw records'}</button>{landed !== null && <button type="button" className="small-button" onClick={backToFind}>Back to Find results</button>}</div><p className="tiny source-navigation-status" role="status" aria-label="Source navigation status" aria-live="polite" aria-atomic="true">{landed === null ? '' : `Found matching message ${landed.position + 1} · ${landed.messageId} in selected source r${view!.revision}.`}</p>{!user.scopes.includes(Scope.Raw) && <p className="tiny raw-permission">Raw access requires the separate Raw permission.</p>}{seekError !== null && <ErrorNotice>{seekError}</ErrorNotice>}{seeking && <p className="tiny" role="status">Locating the original message…</p>}
        {messages.error === null && <SessionFind key={JSON.stringify([user.id, stats.generation, stats.activeId, sessionId, contentViewKey(view), findEpoch])} connection={connection} stats={stats} ownerId={user.id} sessionId={sessionId} view={view!} navigation={navigation} reads={findReads} retireIndexedView={retireIndexedView} supersedeSourceNavigation={supersedeFindNavigation} select={hit => { setRevealedMessage(hit.messageId); setRevealEpoch(epoch => epoch + 1); void showSource(hit.messageId, hit.position, 'find'); }}/>}<details className="related"><summary>Related sessions</summary>{related.error !== null && <ErrorNotice>{related.error}</ErrorNotice>}{related.loading && <p className="tiny" role="status">Resolving related conversations…</p>}{related.data?.sessions.map(hit => <button className="related-link" key={hit.session.id} onClick={() => select(hit.session.id)}><span>{hit.session.metadata.title}</span><span aria-hidden="true">↗</span></button>)}{related.data?.sessions.length === 0 && <p className="tiny">No related conversations available.</p>}</details>
        {raw ? <div className="raw-source"><p className="notice">Original records from source r{view!.revision} may contain sensitive fields. Raw authorization is rechecked by the server.</p>{rawSource.loading && <p role="status">Requesting raw permission…</p>}{rawSource.error !== null && <ErrorNotice>{rawSource.error}. No raw records are retained.</ErrorNotice>}{rawSource.data?.files.map(file => <details key={file.path}><summary>{file.path}</summary><p className="tiny">SHA-256 {file.sha256}</p><pre>{file.content}</pre></details>)}</div> : <div className="transcript" aria-busy={messages.loading || messages.refreshing}><InfiniteTrigger enabled={messages.hasPrevious && messages.error === null} loading={messages.loadingPrevious || messages.refreshing} load={messages.loadPrevious} label="Loading earlier messages…"/>{messages.error !== null && <ErrorNotice>{messages.error}. Message content has been cleared.</ErrorNotice>}{messages.loading && <div className="loading-line" role="status">Loading original messages…</div>}{messages.items.map(message => <OriginalMessage key={message.id} message={message} spans={highlightSpans} reveal={message.id === revealedMessage ? revealEpoch : 0} landedPosition={landed !== null && landed.messageId === message.id ? landed.position : null}/>)}{messages.meta?.total === 0 && <p className="tiny">No messages in this source revision.</p>}<InfiniteTrigger enabled={messages.hasMore && messages.error === null} loading={messages.loadingMore || messages.refreshing} load={messages.loadMore} label="Loading later messages…"/></div>}
      </section></div></ScrollAnchor>
    </>}
  </>;
}
