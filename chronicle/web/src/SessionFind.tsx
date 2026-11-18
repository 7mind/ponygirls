import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Operation_SearchSessionMessages, Result_SessionMessageSearch, type ContentView, type MessageSearchHit } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
import { contentViewKey } from './source-view.ts';
import { FIND_PAGE_SIZE, validateFindLiteral, validateFindPage, type SessionFindReadGate } from './session-find.ts';
import { Icon } from './Icon.tsx';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import './session-find.css';
const FIND_DISCARDED_MESSAGE = 'Find result discarded after source navigation; Find again';
/** The matching-message locators loaded so far: every validated page of one Find, in order. */
interface FindHits { literal: string; hits: readonly MessageSearchHit[]; nextCursor: string | undefined; ids: ReadonlySet<string>; cursors: ReadonlySet<string> }
/** How a hit was chosen: from the hit list (focus moves to the landed message) or from the bar (focus stays in the bar). */
export type FindChoice = 'list' | 'bar';
interface Props {
  connection: ChronicleConnection; stats: ManagerStats; ownerId: string; sessionId: string; view: ContentView; navigation: RefObject<number>; reads: SessionFindReadGate;
  /** Find literal to run once on mount (a `find=` deep link), or null. */
  initialLiteral: string | null;
  /** Where the docked bar and the hit list render (null while the side pane or the bar is closed). */
  bar: HTMLElement | null; list: HTMLElement | null;
  open(): void; close(): void;
  sourceUnavailable(cause: RequestFailure): void; supersedeSourceNavigation(): void; select(hit: MessageSearchHit, choice: FindChoice): void;
}
export function SessionFind({ connection, stats, ownerId, sessionId, view, navigation, reads, initialLiteral, bar, list, open, close, sourceUnavailable, supersedeSourceNavigation, select }: Props) {
  const [draft, setDraft] = useState(initialLiteral ?? ''), [found, setFound] = useState<FindHits | null>(null), [error, setError] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const busy = useSyncExternalStore(reads.subscribe, reads.getSnapshot, reads.getSnapshot);
  const id = useId(), sequence = useRef(0), composing = useRef(false), mounted = useRef(true), advance = useRef(false), input = useRef<HTMLInputElement>(null);
  const scope = JSON.stringify([ownerId, stats.generation, stats.activeId, sessionId, contentViewKey(view)]), currentScope = useRef(scope); currentScope.current = scope;
  function clearResults() { supersedeSourceNavigation(); sequence.current++; advance.current = false; setFound(null); setError(null); setSelected(null); setNotice(null); }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = connection.onInvalidate(() => { sequence.current++; advance.current = false; setDraft(''); setFound(null); setError(null); setSelected(null); setNotice(null); composing.current = false; });
    return () => { mounted.current = false; sequence.current++; unsubscribe(); };
  }, [connection]);
  // The bar is mounted when Find opens: its input takes the focus.
  useEffect(() => { if (bar !== null && input.current !== null) input.current.focus({ preventScroll: true }); }, [bar]);
  const initialRun = useRef(initialLiteral !== null);
  useEffect(() => { if (initialRun.current && stats.activeId !== null) { initialRun.current = false; void run(undefined); } }, [stats.activeId]);
  /** A Find from the start (`cursor` undefined) replaces the hits; a later page is appended to them. */
  async function run(cursor: string | undefined) {
    // Editing/reset invalidates authority, not the unsettled RPC or its permit.
    // Explicit Enter presses while busy never enqueue or fan out another read.
    if (reads.getSnapshot() || composing.current || stats.activeId === null) return;
    const previous = cursor === undefined ? null : found;
    if (previous === null) clearResults(); else { sequence.current++; setError(null); setNotice(null); }
    try { validateFindLiteral(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid Find literal.'); return; }
    const token = sequence.current, atScope = scope, atNavigation = navigation.current, literal = draft;
    const seenIds = previous === null ? new Set<string>() : previous.ids, seenCursors = previous === null ? new Set<string>() : previous.cursors;
    const after = previous === null ? -1 : previous.hits[previous.hits.length - 1]!.position;
    const sameIntent = () => mounted.current && sequence.current === token && currentScope.current === atScope;
    const authoritative = () => sameIntent() && navigation.current === atNavigation;
    const release = reads.acquire(); if (release === null) return;
    try {
      const result = await read(connection, new Operation_SearchSessionMessages(sessionId, view, literal, cursor, FIND_PAGE_SIZE), reply => reply instanceof Result_SessionMessageSearch ? reply.result : null);
      if (!authoritative()) { if (sameIntent()) { advance.current = false; setNotice(FIND_DISCARDED_MESSAGE); } return; }
      validateFindPage(result, view, cursor, after, seenIds, seenCursors);
      const ids = new Set(seenIds), cursors = new Set(seenCursors);
      for (const hit of result.hits) ids.add(hit.messageId);
      if (cursor !== undefined) cursors.add(cursor);
      if (result.nextCursor !== undefined) cursors.add(result.nextCursor);
      setFound({ literal, hits: previous === null ? result.hits : [...previous.hits, ...result.hits], nextCursor: result.nextCursor, ids, cursors });
      const first = result.hits[0];
      if (advance.current && first !== undefined) { advance.current = false; choose(first, 'bar'); }
    } catch (cause) {
      advance.current = false;
      const current = mounted.current && currentScope.current === atScope;
      if (cause instanceof RequestFailure && cause.code === 'indexed-view-retired' && current) { sequence.current++; setDraft(''); setFound(null); setSelected(null); setNotice(null); sourceUnavailable(cause); return; }
      const denied = cause instanceof RequestFailure && ['forbidden', 'not-found', 'unauthorized'].includes(cause.code);
      // A denial concerns the source, not this Find: it is reported while the source scope holds, also after a navigation
      // superseded the Find (a Search link's `at` and `find` run together).
      if (!authoritative()) { if (denied && current) sourceUnavailable(cause); return; }
      setFound(null); setSelected(null);
      if (denied) { setDraft(''); sourceUnavailable(cause); }
      setError(cause instanceof Error ? cause.message : 'Find failed; restart the search.');
    } finally { release(); }
  }
  function choose(hit: MessageSearchHit, choice: FindChoice) { setSelected(hit.messageId); select(hit, choice); }
  const hits = found === null ? [] : found.hits, at = hits.findIndex(hit => hit.messageId === selected), more = found !== null && found.nextCursor !== undefined;
  function step(forward: boolean) {
    if (busy || found === null || hits.length === 0) return;
    const target = forward ? at + 1 : at < 0 ? hits.length - 1 : at - 1;
    const hit = hits[target];
    if (hit !== undefined) { choose(hit, 'bar'); return; }
    if (forward && found.nextCursor !== undefined) { advance.current = true; void run(found.nextCursor); }
  }
  function reset() { clearResults(); setDraft(''); composing.current = false; }
  const status = busy ? 'Searching…' : notice !== null ? notice : found === null ? '' : `${at < 0 ? `${hits.length} matching messages` : `Message ${at + 1} of ${hits.length} matching messages`} · ${more ? 'more available' : 'end of matches'}`;
  const findBar = <section className="findbar" role="search" aria-label="Find in selected history" aria-busy={busy}>
    <form className="querybar" onSubmit={event => { event.preventDefault(); void run(undefined); }}>
      <button type="submit" className="btn btn-ghost btn-icon btn-sm" aria-label="Find messages" title="Find literal text from the start" aria-disabled={busy || stats.activeId === null}><Icon name="search" small={true}/></button>
      <label htmlFor={id} className="sr-only">Literal message text</label>
      <input id={id} ref={input} type="text" placeholder="Find in this session…" title={`Literal, case-insensitive. All messages in source r${view.revision}; spaces preserved.`} autoComplete="off" spellCheck={false} value={draft}
        onChange={event => { clearResults(); setDraft(event.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); reset(); close(); return; }
          if (event.key !== 'Enter') return;
          if (composing.current || event.nativeEvent.isComposing) { event.preventDefault(); return; }
          if (found !== null) { event.preventDefault(); step(!event.shiftKey); }
        }}/>
      <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Reset find" title="Clear Find" onClick={reset}><Icon name="x" small={true}/></button>
    </form>
    <button type="button" className="btn btn-icon" aria-label="Previous match" title="Previous matching message (Shift+Enter)" aria-disabled={busy || hits.length === 0} onClick={() => step(false)}><Icon name="chevron-up" small={false}/></button>
    <button type="button" className="btn btn-icon" aria-label="Next match" title="Next matching message (Enter); loads more matches at the end" aria-disabled={busy || hits.length === 0 || (at === hits.length - 1 && !more)} onClick={() => step(true)}><Icon name="chevron-down" small={false}/></button>
    <span className="small nowrap find-status" role="status" aria-label="Find status" aria-live="polite" aria-atomic="true" title={busy ? 'One request at a time. Editing or reset discards its reply, not the request.' : 'Matching messages, not occurrences or a global total.'}>{status}</span>
    {error !== null && <span className="find-error" role="alert">{error} No matching-message results retained.</span>}
    <button type="button" className="btn btn-ghost push" onClick={() => { reset(); close(); }}>Done<span className="kbd" aria-hidden="true">Esc</span></button>
  </section>;
  const hitList = <div className="find-results">
    <div className="rail-search"><span className="grow">{found === null ? 'Matching messages appear here.' : <><strong>{hits.length}</strong> matching messages for “{found.literal}”{more ? ' · more available' : ''}</>}</span>{found === null && <button type="button" className="btn btn-sm" onClick={open}>Find…</button>}</div>
    {found !== null && <ol className="find-hits" aria-label="Matching messages">{hits.map((hit, index) => <li key={hit.messageId}><button type="button" className="outline-item" aria-current={selected === hit.messageId ? 'true' : undefined} onClick={() => choose(hit, 'list')}><span className="outline-n" aria-hidden="true">{index + 1}</span><span className="outline-title"><span className="sr-only">Message {hit.position + 1} · {hit.messageId}</span><span aria-hidden="true">Message {hit.position + 1}</span></span><span className="outline-sub mono" aria-hidden="true">{hit.messageId}</span></button></li>)}</ol>}
    {found !== null && <InfiniteTrigger enabled={more && error === null && !busy} loading={busy} load={() => { if (found.nextCursor !== undefined) void run(found.nextCursor); }} label="Loading more matching messages…"/>}
    {found !== null && !more && <p className="list-end">End of matches · {hits.length} matching messages</p>}
  </div>;
  return <>{bar !== null && createPortal(findBar, bar)}{list !== null && createPortal(hitList, list)}</>;
}
