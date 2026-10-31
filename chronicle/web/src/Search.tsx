import { useEffect, useState } from 'react';
import { Operation_ArchiveSearch, Result_ArchiveSearch, ArchiveQuery, ArchiveSort, ArchiveTextScope, ExpressionHintTarget_Archive, SortDirection, ArchiveMatchKind, Operation_ReadMessageContext, Result_MessageContext, Span, type ArchiveRow, type ArchiveSourceMatch, type ContentView, type MessageContextResult, type PassageSourceSpan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
import type { TextPart } from './highlight.ts';
import { useResource } from './hooks.ts';
import { Blank, ErrorNotice, SessionMeta, Tags } from './App.tsx';
import { Dialog } from './Dialog.tsx';
import { Conversation, type SourceLanding } from './Conversation.tsx';
import type { SessionFindReadGate } from './session-find.ts';
import { contentViewKey, sameContentView } from './source-view.ts';
import { CONTEXT_BYTES, SEARCH_PAGE_SIZE, SNIPPET_BYTES, snippetAnchor, validateContext, validateArchiveSearchPage, contextParts, sourceFailureAffectsView, type SearchSourceFailure } from './search-source.ts';
import { ExpressionEditor, archiveFields } from './ExpressionEditor.tsx';
import './search.css';
interface Selection { row: ArchiveRow; view: ContentView; landing: SourceLanding | undefined }
interface SearchScope { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo }
interface ContextPage { anchor: Span; before: number; after: number }
interface SourceExcerpt { source: PassageSourceSpan; role: string; parts: TextPart[] }
type ContextRead = { kind: 'source'; result: MessageContextResult; excerpts: SourceExcerpt[] } | { kind: 'failure'; failure: SearchSourceFailure };
function SourceContext({ connection, stats, user, sessionId, view, span, open, fail }: SearchScope & { sessionId: string; view: ContentView; span: Span; open: (landing: SourceLanding) => void; fail: (failure: SearchSourceFailure) => void }) {
  const [page, setPage] = useState<ContextPage>(() => ({ anchor: snippetAnchor(span), before: 0, after: SNIPPET_BYTES }));
  const context = useResource<ContextRead>(connection, stats, JSON.stringify([user.id, sessionId, contentViewKey(view), page.anchor.toJSON(), page.before, page.after]), '', true, async () => {
    try {
      const result = validateContext(await read(connection, new Operation_ReadMessageContext(sessionId, view, page.anchor, page.before, page.after), reply => reply instanceof Result_MessageContext ? reply.result : null), sessionId, view, page.anchor, page.before, page.after);
      return { kind: 'source', result, excerpts: result.excerpts.map(excerpt => ({ source: excerpt.source, role: excerpt.role, parts: contextParts(excerpt, span) })) };
    } catch (cause) {
      if (cause instanceof RequestFailure) return { kind: 'failure', failure: { code: cause.code, message: cause.message } };
      throw cause;
    }
  });
  const source = context.data !== null && context.data.kind === 'source' ? context.data : null;
  const code = context.data !== null && context.data.kind === 'failure' ? context.data.failure.code : null;
  const message = context.error ?? (context.data !== null && context.data.kind === 'failure' ? context.data.failure.message : null);
  useEffect(() => { if (message !== null) fail({ code, message }); }, [code, message, fail]);
  return <section className="search-source" aria-label="Original source excerpts" aria-busy={context.loading}>
    {context.loading && <p role="status">Reading bounded source excerpts…</p>}
    {message !== null && <ErrorNotice>{message}. Source excerpts cleared; no fallback used.</ErrorNotice>}
    {source !== null && <><div className="search-excerpts">{source.excerpts.map(excerpt => {
      const range = excerpt.source, parts = excerpt.parts;
      return <article className="search-excerpt" key={`${range.messageId}:${range.start}`}><header><strong>{excerpt.role}</strong><button type="button" className="text-button" onClick={() => open({ view, span: new Span(range.messageId, range.start, range.end), position: range.messagePosition })}>Open {range.messageId} · UTF-8 bytes [{range.start}, {range.end})</button></header><pre>{parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</pre></article>;
    })}</div><div className="button-row"><button type="button" className="small-button" disabled={source.result.previous === undefined} onClick={() => { if (source.result.previous !== undefined) setPage({ anchor: source.result.previous, before: CONTEXT_BYTES, after: 0 }); }}>Earlier context</button><button type="button" className="small-button" disabled={source.result.next === undefined} onClick={() => { if (source.result.next !== undefined) setPage({ anchor: source.result.next, before: 0, after: CONTEXT_BYTES }); }}>Later context</button><button type="button" className="small-button" onClick={() => setPage({ anchor: snippetAnchor(span), before: 0, after: SNIPPET_BYTES })}>Matched source</button></div></>}
  </section>;
}
function SourceMatches({ matches, fail, ...props }: SearchScope & { sessionId: string; matches: readonly ArchiveSourceMatch[]; open: (landing: SourceLanding) => void; fail: (view: ContentView, failure: SearchSourceFailure) => void }) {
  const [index, setIndex] = useState(0), match = matches[index];
  if (match === undefined) throw new Error('Search representative source is missing.');
  const { span, view } = match;
  return <section className="search-match"><p className="tiny">{match.summary !== undefined && <>Generated annotation: {match.summary}<br/></>}{match.kind === ArchiveMatchKind.Literal ? 'Literal source' : 'Semantic retrieval source'} for <code>{match.operand}</code> · representative {index + 1} of {matches.length} · source r{view.revision} · generation {view.generationId ?? 'archive-only'}. Separate messages are never joined into a quote. Highlighted bytes are the returned source span; unhighlighted text is nearby context.{span.end - span.start > CONTEXT_BYTES && <> Partial preview of a source span larger than {CONTEXT_BYTES} bytes; not the full match.</>}</p><SourceContext key={JSON.stringify([index, contentViewKey(view), span.messageId, span.start, span.end])} {...props} view={view} span={span} fail={error => fail(view, error)}/>{matches.length > 1 && <div className="button-row"><button className="small-button" disabled={index === 0} onClick={() => setIndex(n => n - 1)}>Previous source span</button><button className="small-button" disabled={index + 1 === matches.length} onClick={() => setIndex(n => n + 1)}>Next source span</button></div>}</section>;
}
function SearchCard({ row, matches, open, sourceUnavailable, ...scope }: SearchScope & { row: ArchiveRow; matches: readonly ArchiveSourceMatch[]; open: (view: ContentView, landing: SourceLanding | undefined) => void; sourceUnavailable: (sessionId: string, view: ContentView, failure: SearchSourceFailure) => void }) {
  const [unavailable, setUnavailable] = useState<string | null>(null), view = row.matchedView ?? row.publishedView ?? row.head.view;
  const first = matches.find(match => sameContentView(match.view, view));
  function fail(failedView: ContentView, failure: SearchSourceFailure) { setUnavailable(failure.message); sourceUnavailable(row.head.id, failedView, failure); }
  return <article className="search-card"><SessionMeta session={row.head}/><h2><button type="button" className="search-title" disabled={unavailable !== null} onClick={() => open(view, first === undefined ? undefined : { view, span: first.span, position: null })}>{row.head.metadata.title || 'Untitled conversation'}</button></h2><Tags tags={row.tags}/><p className="tiny">HEAD r{row.head.revision} · {row.publishedView === undefined ? 'not indexed' : `published r${row.publishedView.revision}`} · representative source is not proof of every Boolean operand.</p>
    {unavailable !== null ? <ErrorNotice>{unavailable}. This result's source excerpts have been cleared. Submit a new search to recheck access; no HEAD fallback is used.</ErrorNotice> : matches.length === 0 ? <p>No positive message spans returned. Metadata and negative criteria can match without a textual excerpt; open the pinned conversation to read it.</p> : <SourceMatches {...scope} sessionId={row.head.id} matches={matches} open={landing => open(landing.view, landing)} fail={fail}/>}
  </article>;
}
export function Search({ connection, stats, user, findReads }: SearchScope & { findReads: SessionFindReadGate }) {
  const [draft, setDraft] = useState(''), [submitted, setSubmitted] = useState<string | null>(null), [composing, setComposing] = useState(false);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), [pageIndex, setPageIndex] = useState(0), [epoch, setEpoch] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null), [related, setRelated] = useState<string | null>(null), [sourceFailure, setSourceFailure] = useState<string | null>(null);
  useEffect(() => connection.onInvalidate(() => { setSubmitted(null); close(); setPageIndex(0); setCursors([undefined]); setSourceFailure(null); }), [connection]);
  function close() { setSelection(null); setRelated(null); }
  function change(value: string) { setDraft(value); setSubmitted(null); setPageIndex(0); setCursors([undefined]); close(); }
  function submit(expression: string) { if (composing || stats.activeId === null) return; setSubmitted(expression); setPageIndex(0); setCursors([undefined]); close(); setSourceFailure(null); setEpoch(n => n + 1); }
  const cursor = cursors[pageIndex];
  const results = useResource(connection, stats, JSON.stringify([user.id, submitted, cursor, pageIndex, epoch]), '', submitted !== null, async () => {
    if (submitted === null) throw new Error('Search has no submitted expression.');
    const query = new ArchiveQuery(submitted, ArchiveSort.LastTimestamp, SortDirection.Desc, cursor, SEARCH_PAGE_SIZE, true);
    const result = await read(connection, new Operation_ArchiveSearch(query), reply => reply instanceof Result_ArchiveSearch ? reply.result : null);
    return validateArchiveSearchPage(result, cursor);
  });
  function clearSource(message: string) { setSourceFailure(message); setSubmitted(null); setPageIndex(0); setCursors([undefined]); close(); }
  // A related dialog selects its own pin internally; invalidate its matching session conservatively.
  function sourceUnavailable(sessionId: string, view: ContentView, failure: SearchSourceFailure) { if (selection !== null && (related ?? selection.row.head.id) === sessionId && (related !== null || sourceFailureAffectsView(view, selection.view, failure.code))) clearSource(failure.message); }
  function next() { if (results.data === null || results.data.page.nextCursor === undefined) return; close(); setCursors(previous => [...previous.slice(0, pageIndex + 1), results.data!.page.nextCursor]); setPageIndex(n => n + 1); }
  return <main className="search-page"><header className="page-heading"><h1>Search</h1><p>The same conversation expression language as Archive, with original-source result cards. Unindexed archive HEADs remain searchable.</p></header>
    <ExpressionEditor submission="explicit" completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_Archive() }} value={draft} applied={submitted ?? ''} change={change} submit={submit} compositionChange={setComposing} composing={composing} disabled={stats.activeId === null} fields={archiveFields} help={results.data !== null && results.data.page.textScope === ArchiveTextScope.BoundedCandidateSets ? <p>Up to {results.data.page.annChunkLimitPerOperand} authorized published chunks per distinct text operand. This is not a row cap; Hybrid also includes unbounded exact lexical HEAD matches.</p> : null}/>
    {sourceFailure !== null && <ErrorNotice>{sourceFailure}. Search source cleared after a denied or unavailable pinned source. Submit to recheck; no fallback was used.</ErrorNotice>}
    {submitted === null && <Blank title="Search source">Enter an Archive expression and submit. Use mode:lexical, mode:semantic or mode:hybrid; the default is Hybrid.</Blank>}
    {results.loading && <p className="loading-line" role="status">Searching conversations…</p>}{results.error !== null && <ErrorNotice>{results.error}. Search results cleared. No fallback search was used.</ErrorNotice>}
    {results.data !== null && <><p className="search-count" role="status">{results.data.page.total.toString()} matching conversations · {results.data.page.textScope === ArchiveTextScope.ExactLexical ? 'exact lexical/metadata membership' : `membership under bounded semantic candidate sets · ${results.data.page.annChunkLimitPerOperand} candidate chunks per operand, not a row cap`}{results.data.page.relevanceOrdered ? ' · ordered by relevance' : ' · ordered by last activity'} · page {pageIndex + 1} · {results.data.page.rows.length} shown</p><p className="tiny">Up to two representative positive source spans per conversation, not an exhaustive explanation of a Boolean match. Each excerpt retains its own revision/generation. Pages are live, not a frozen snapshot.</p><div className="search-results">{results.data.page.rows.map((row, index) => <SearchCard key={JSON.stringify([epoch, pageIndex, row.head.id, contentViewKey(row.head.view)])} connection={connection} stats={stats} user={user} row={row} matches={results.data!.evidence[index]!.matches} sourceUnavailable={sourceUnavailable} open={(view, landing) => { setRelated(null); setSelection({ row, view, landing }); }}/>)}</div><div className="button-row search-paging"><button disabled={pageIndex === 0 || results.loading} onClick={() => { close(); setPageIndex(n => n - 1); }}>Previous results</button><button disabled={results.data.page.nextCursor === undefined || results.loading} onClick={next}>Next results</button></div></>}
    {selection !== null && <Dialog title="Source conversation" close={close}><Conversation key={related ?? JSON.stringify([selection.row.head.id, contentViewKey(selection.view), selection.landing])} connection={connection} stats={stats} user={user} sessionId={related ?? selection.row.head.id} initialView={related === null ? selection.view : undefined} initialLanding={related === null ? selection.landing : undefined} onSourceUnavailable={clearSource} archiveHead={related === null ? selection.row : null} select={setRelated} refresh={epoch} findReads={findReads}/></Dialog>}
  </main>;
}
