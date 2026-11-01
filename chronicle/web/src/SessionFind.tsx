import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { Operation_SearchSessionMessages, Result_SessionMessageSearch, type ContentView, type MessageSearchHit, type SessionMessageSearchResult } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
import { contentViewKey } from './source-view.ts';
import { FIND_PAGE_SIZE, validateFindLiteral, validateFindPage, type SessionFindReadGate } from './session-find.ts';
import './session-find.css';
const FIND_DISCARDED_MESSAGE = 'Find result discarded after source navigation; Find again';
interface FindPage { result: SessionMessageSearchResult; number: number; ids: ReadonlySet<string>; cursors: ReadonlySet<string> }
interface Props { connection: ChronicleConnection; stats: ManagerStats; ownerId: string; sessionId: string; view: ContentView; navigation: RefObject<number>; reads: SessionFindReadGate; sourceUnavailable(cause: RequestFailure): void; supersedeSourceNavigation(): void; select(hit: MessageSearchHit): void }
export function SessionFind({ connection, stats, ownerId, sessionId, view, navigation, reads, sourceUnavailable, supersedeSourceNavigation, select }: Props) {
  const [draft, setDraft] = useState(''), [page, setPage] = useState<FindPage | null>(null), [error, setError] = useState<string | null>(null), [selected, setSelected] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const busy = useSyncExternalStore(reads.subscribe, reads.getSnapshot, reads.getSnapshot);
  const id = useId(), sequence = useRef(0), composing = useRef(false), mounted = useRef(true);
  const scope = JSON.stringify([ownerId, stats.generation, stats.activeId, sessionId, contentViewKey(view)]), currentScope = useRef(scope); currentScope.current = scope;
  function clearResults() { supersedeSourceNavigation(); sequence.current++; setPage(null); setError(null); setSelected(null); setNotice(null); }
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = connection.onInvalidate(() => { sequence.current++; setDraft(''); setPage(null); setError(null); setSelected(null); setNotice(null); composing.current = false; });
    return () => { mounted.current = false; sequence.current++; unsubscribe(); };
  }, [connection]);
  async function run(cursor: string | undefined) {
    // Editing/reset invalidates authority, not the unsettled RPC or its permit.
    // Explicit Enter presses while busy never enqueue or fan out another read.
    if (reads.getSnapshot() || composing.current || stats.activeId === null) return;
    clearResults();
    try { validateFindLiteral(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid Find literal.'); return; }
    const token = sequence.current, atScope = scope, atNavigation = navigation.current, literal = draft;
    const previous = cursor === undefined ? null : page;
    const seenIds = previous === null ? new Set<string>() : previous.ids, seenCursors = previous === null ? new Set<string>() : previous.cursors;
    const after = previous === null ? -1 : previous.result.hits[previous.result.hits.length - 1]!.position;
    const sameIntent = () => mounted.current && sequence.current === token && currentScope.current === atScope;
    const authoritative = () => sameIntent() && navigation.current === atNavigation;
    const release = reads.acquire(); if (release === null) return;
    try {
      const result = await read(connection, new Operation_SearchSessionMessages(sessionId, view, literal, cursor, FIND_PAGE_SIZE), reply => reply instanceof Result_SessionMessageSearch ? reply.result : null);
      if (!authoritative()) { if (sameIntent()) setNotice(FIND_DISCARDED_MESSAGE); return; }
      validateFindPage(result, view, cursor, after, seenIds, seenCursors);
      const ids = new Set(seenIds), cursors = new Set(seenCursors);
      for (const hit of result.hits) ids.add(hit.messageId);
      if (cursor !== undefined) cursors.add(cursor);
      if (result.nextCursor !== undefined) cursors.add(result.nextCursor);
      setPage({ result, number: previous === null ? 1 : previous.number + 1, ids, cursors });
    } catch (cause) {
      if (cause instanceof RequestFailure && cause.code === 'indexed-view-retired' && mounted.current && currentScope.current === atScope) { sequence.current++; setDraft(''); setPage(null); setSelected(null); setNotice(null); sourceUnavailable(cause); return; }
      if (!authoritative()) return;
      setPage(null); setSelected(null);
      if (cause instanceof RequestFailure && ['forbidden', 'not-found', 'unauthorized'].includes(cause.code)) { setDraft(''); sourceUnavailable(cause); }
      setError(cause instanceof Error ? cause.message : 'Find failed; restart the search.');
    } finally { release(); }
  }
  const status = busy ? 'Searching…' : notice !== null ? notice : page === null ? '' : `${page.result.hits.length} matching messages · page ${page.number} · ${page.result.nextCursor === undefined ? 'end of matches' : 'more available'}`;
  return <section className="session-find" role="region" aria-label="Find in selected history" aria-busy={busy}>
    <form onSubmit={event => { event.preventDefault(); void run(undefined); }}><label htmlFor={id} hidden>Literal message text</label><div className="find-input-row"><input id={id} type="text" placeholder="Find in source…" title={`Literal, case-insensitive. All messages in source r${view.revision}; spaces preserved.`} autoComplete="off" spellCheck={false} value={draft} onChange={event => { clearResults(); setDraft(event.target.value); }} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing)) event.preventDefault(); }}/><button type="submit" className="find-icon" aria-label="Find messages" title="Find literal text" aria-disabled={busy || stats.activeId === null}>⌕</button><button type="button" className="find-icon" aria-label="Reset find" title="Clear Find" onClick={() => { clearResults(); setDraft(''); composing.current = false; }}>×</button><button type="button" className="find-icon" aria-label="Next matches" title="Next matching messages" aria-disabled={busy || page === null || page.result.nextCursor === undefined} onClick={() => { if (!busy && page !== null && page.result.nextCursor !== undefined) void run(page.result.nextCursor); }}>↓</button><button type="button" className="find-icon" aria-label="Restart find" title="Search again from the start" aria-disabled={busy || draft.length === 0} onClick={() => { if (draft.length > 0) void run(undefined); }}>↻</button></div></form>
    <p className="tiny" role="status" aria-label="Find status" aria-live="polite" aria-atomic="true" title={busy ? 'One request at a time. Editing or reset discards its reply, not the request.' : 'Matching-message page count, not occurrences or a global total.'}>{status}</p>
    {error !== null && <p className="notice error" role="alert">{error} No matching-message results retained.</p>}
    {page !== null && <ol className="find-hits">{page.result.hits.map(hit => <li key={hit.messageId}><button type="button" className="text-button" aria-pressed={selected === hit.messageId} onClick={() => { setSelected(hit.messageId); select(hit); }}>Message {hit.position + 1} · {hit.messageId}</button></li>)}</ol>}
  </section>;
}
