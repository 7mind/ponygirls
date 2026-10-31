import { useEffect, useRef, useState } from 'react';
import { Operation_Search, Result_Search, SearchFilter, SearchMode, SearchQuery, SearchCountScope, Operation_ReadMessageContext, Result_MessageContext, Span, type SearchHit, type Chunk, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import type { ManagerStats } from './transport/types.ts';
import { useResource } from './hooks.ts';
import { Blank, ErrorNotice, SessionMeta, Tags } from './App.tsx';
import { Dialog } from './Dialog.tsx';
import { Conversation, type SourceLanding } from './Conversation.tsx';
import type { SessionFindReadGate } from './session-find.ts';
import { contentViewKey, sameContentView } from './source-view.ts';
import { CONTEXT_BYTES, SEARCH_PAGE_SIZE, SNIPPET_BYTES, searchPageEnd, snippetAnchor, validateContext, validateSearchPage, contextParts } from './search-source.ts';
import './search.css';
interface SearchInputs { query: string; mode: SearchMode; project: string; tag: string; after: string; before: string }
interface Selection { hit: SearchHit; landing: SourceLanding }
interface SearchScope { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo }
interface ContextPage { anchor: Span; before: number; after: number }
function SourceContext({ connection, stats, user, hit, span, open, fail }: SearchScope & { hit: SearchHit; span: Span; open: (landing: SourceLanding) => void; fail: (error: string) => void }) {
  const [page, setPage] = useState<ContextPage>(() => ({ anchor: snippetAnchor(span), before: 0, after: SNIPPET_BYTES }));
  const view = hit.session.view;
  const context = useResource(connection, stats, JSON.stringify([user.id, hit.session.id, contentViewKey(view), page.anchor.toJSON(), page.before, page.after]), '', true, async () => {
    const result = validateContext(await read(connection, new Operation_ReadMessageContext(hit.session.id, view, page.anchor, page.before, page.after), reply => reply instanceof Result_MessageContext ? reply.result : null), hit.session.id, view, page.anchor, page.before, page.after);
    return { result, excerpts: result.excerpts.map(excerpt => ({ source: excerpt.source, role: excerpt.role, parts: contextParts(excerpt, span) })) };
  });
  useEffect(() => { if (context.error !== null) fail(context.error); }, [context.error, fail]);
  return <section className="search-source" aria-label="Original source excerpts" aria-busy={context.loading}>
    {context.loading && <p role="status">Reading bounded source excerpts…</p>}
    {context.error !== null && <ErrorNotice>{context.error}. Source excerpts cleared; no fallback used.</ErrorNotice>}
    {context.data !== null && <><div className="search-excerpts">{context.data.excerpts.map(excerpt => {
      const source = excerpt.source, parts = excerpt.parts;
      return <article className="search-excerpt" key={`${source.messageId}:${source.start}`}><header><strong>{excerpt.role}</strong><button type="button" className="text-button" onClick={() => open({ view, span: new Span(source.messageId, source.start, source.end), position: source.messagePosition })}>Open {source.messageId} · UTF-8 bytes [{source.start}, {source.end})</button></header><pre>{parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</pre></article>;
    })}</div><div className="button-row"><button type="button" className="small-button" disabled={context.data.result.previous === undefined} onClick={() => { if (context.data !== null && context.data.result.previous !== undefined) setPage({ anchor: context.data.result.previous, before: CONTEXT_BYTES, after: 0 }); }}>Earlier context</button><button type="button" className="small-button" disabled={context.data.result.next === undefined} onClick={() => { if (context.data !== null && context.data.result.next !== undefined) setPage({ anchor: context.data.result.next, before: 0, after: CONTEXT_BYTES }); }}>Later context</button><button type="button" className="small-button" onClick={() => setPage({ anchor: snippetAnchor(span), before: 0, after: SNIPPET_BYTES })}>Matched source</button></div></>}
  </section>;
}
function ChunkSource({ chunk, ...props }: SearchScope & { hit: SearchHit; chunk: Chunk; open: (landing: SourceLanding) => void; fail: (error: string) => void }) {
  const [index, setIndex] = useState(0), span = chunk.spans[index];
  return <section className="search-match"><p className="tiny">{chunk.summary && <>Generated annotation: {chunk.summary}<br/></>}Source span {index + 1} of {chunk.spans.length} · separate messages are never joined into a quote. Highlighted bytes are matched source; unhighlighted text is nearby context.{span !== undefined && span.end - span.start > CONTEXT_BYTES && <> Partial preview of a historical span larger than {CONTEXT_BYTES} bytes; not the full match.</>}</p>{span === undefined ? <p>No verified source spans available.</p> : <SourceContext key={`${index}:${span.messageId}:${span.start}:${span.end}`} {...props} span={span}/>}{chunk.spans.length > 1 && <div className="button-row"><button className="small-button" disabled={index === 0} onClick={() => setIndex(n => n - 1)}>Previous source span</button><button className="small-button" disabled={index + 1 === chunk.spans.length} onClick={() => setIndex(n => n + 1)}>Next source span</button></div>}</section>;
}
function SearchCard({ hit, open, sourceUnavailable, ...scope }: SearchScope & { hit: SearchHit; open: (landing: SourceLanding) => void; sourceUnavailable: (hit: SearchHit, message: string) => void }) {
  const [unavailable, setUnavailable] = useState<string | null>(null), span = hit.chunks[0]?.spans[0];
  function fail(message: string) { setUnavailable(message); sourceUnavailable(hit, message); }
  return <article className="search-card"><SessionMeta session={hit.session}/><h2><button type="button" className="search-title" disabled={span === undefined || unavailable !== null} onClick={() => { if (span !== undefined) open({ view: hit.session.view, span, position: null }); }}>{hit.session.metadata.title || 'Untitled conversation'}</button></h2><Tags tags={hit.session.metadata.tags}/><p className="tiny">Source r{hit.session.view.revision} · generation {hit.session.view.generationId ?? 'archive-only'}</p>
    {unavailable !== null ? <ErrorNotice>{unavailable}. This result's source excerpts have been cleared. Submit a new search to recheck access; no HEAD fallback is used.</ErrorNotice> : hit.chunks.length === 0 ? <p>No source spans returned.</p> : <>{hit.chunks.slice(0, 2).map(chunk => <ChunkSource key={chunk.id} {...scope} hit={hit} chunk={chunk} open={open} fail={fail}/>)}{hit.chunks.length > 2 && <p className="tiny">Showing source for 2 of {hit.chunks.length} matching retrieval pieces. Open the pinned conversation for further reading.</p>}</>}
  </article>;
}
export function Search({ connection, stats, user, findReads }: SearchScope & { findReads: SessionFindReadGate }) {
  const [inputs, setInputs] = useState<SearchInputs>({ query: '', mode: SearchMode.Hybrid, project: '', tag: '', after: '', before: '' });
  const [submitted, setSubmitted] = useState<SearchInputs | null>(null), [offset, setOffset] = useState(0), [epoch, setEpoch] = useState(0), [selection, setSelection] = useState<Selection | null>(null), [related, setRelated] = useState<string | null>(null);
  const [sourceFailure, setSourceFailure] = useState<string | null>(null);
  const composing = useRef(false), input = useRef<HTMLInputElement>(null);
  useEffect(() => connection.onInvalidate(() => { setSubmitted(null); setSelection(null); setRelated(null); setOffset(0); setSourceFailure(null); }), [connection]);
  useEffect(() => { function focus(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && selection === null) { event.preventDefault(); input.current?.focus(); } } window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus); }, [selection]);
  function change<K extends keyof SearchInputs>(key: K, value: SearchInputs[K]) { setInputs(previous => ({ ...previous, [key]: value })); setSubmitted(null); setOffset(0); setSelection(null); setRelated(null); }
  const results = useResource(connection, stats, JSON.stringify([user.id, submitted, offset, epoch]), '', submitted !== null, async () => {
    if (submitted === null) throw new Error('Search has no submitted query.');
    const filter = new SearchFilter(submitted.project || undefined, undefined, submitted.after ? `${submitted.after}T00:00:00.000Z` : undefined, submitted.before ? `${submitted.before}T23:59:59.999Z` : undefined, submitted.tag ? [submitted.tag] : []);
    const result = await read(connection, new Operation_Search(new SearchQuery(submitted.query, submitted.mode, filter, SEARCH_PAGE_SIZE, offset)), reply => reply instanceof Result_Search ? reply.result : null);
    return validateSearchPage(result, offset);
  });
  const end = results.data === null ? 0 : searchPageEnd(results.data);
  function close() { setSelection(null); setRelated(null); }
  function clearSource(message: string) { setSourceFailure(message); setSubmitted(null); setOffset(0); close(); }
  function sourceUnavailable(hit: SearchHit, message: string) { if (selection !== null && related === null && selection.hit.session.id === hit.session.id && sameContentView(selection.hit.session.view, hit.session.view)) clearSource(message); }
  return <main className="search-page"><header className="page-heading"><h1>Search</h1><p>Search published conversations. Read original source, separately from generated annotations.</p></header>
    <form className="search-form" onSubmit={event => { event.preventDefault(); if (composing.current || stats.activeId === null) return; setOffset(0); setSelection(null); setRelated(null); setSourceFailure(null); setSubmitted({ ...inputs }); setEpoch(n => n + 1); }} onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing)) event.preventDefault(); }}>
      <label className="search-query">Query<input ref={input} name="query" maxLength={2048} value={inputs.query} onChange={event => change('query', event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}/></label>
      <label>Search mode<select value={inputs.mode} onChange={event => change('mode', event.target.value as SearchMode)}>{Object.values(SearchMode).map(mode => <option key={mode}>{mode}</option>)}</select></label>
      <label>Project<input value={inputs.project} maxLength={256} onChange={event => change('project', event.target.value)}/></label><label>Tag<input value={inputs.tag} maxLength={128} onChange={event => change('tag', event.target.value)}/></label>
      <label>From date (UTC)<input type="date" value={inputs.after} onChange={event => change('after', event.target.value)}/></label><label>Through date (UTC)<input type="date" min={inputs.after} value={inputs.before} onChange={event => change('before', event.target.value)}/></label><button className="primary" disabled={stats.activeId === null}>Search published conversations</button>
    </form><p className="tiny">Filters are exact structured metadata, not Archive expressions. Lexical uses websearch terms; semantic and hybrid use bounded candidate retrieval. Edits clear results; submit to execute. Dates include the selected UTC days.</p>
    {sourceFailure !== null && <ErrorNotice>{sourceFailure}. Search source cleared after a denied or unavailable pinned source. Submit to recheck; no fallback was used.</ErrorNotice>}
    {submitted === null && <Blank title="Search published source">Enter a query or filters, choose a mode and submit. To browse all source HEADs, use Archive.</Blank>}
    {results.loading && <p className="loading-line" role="status">Searching published conversations…</p>}{results.error !== null && <ErrorNotice>{results.error}. Search results cleared. No fallback search was used.</ErrorNotice>}
    {results.data !== null && <><p className="search-count" role="status">{results.data.countScope === SearchCountScope.ExactMatches ? `${results.data.total} exact matching conversations` : `${results.data.total} conversations in the retrieved candidate window · not a corpus count · ranking limit ${results.data.rankingLimit} candidate chunks`}{results.data.hits.length > 0 ? ` · showing ${offset + 1}–${offset + results.data.hits.length}` : ' · no results on this page'}</p><div className="search-results">{results.data.hits.map(hit => <SearchCard key={JSON.stringify([epoch, offset, hit.session.id, contentViewKey(hit.session.view)])} connection={connection} stats={stats} user={user} hit={hit} sourceUnavailable={sourceUnavailable} open={landing => { setRelated(null); setSelection({ hit, landing }); }}/>)}</div><div className="button-row search-paging"><button disabled={offset === 0} onClick={() => { close(); setOffset(n => Math.max(0, n - SEARCH_PAGE_SIZE)); }}>Previous results</button><button disabled={results.data.hits.length === 0 || offset + results.data.hits.length >= end} onClick={() => { close(); setOffset(n => n + results.data!.hits.length); }}>Next results</button></div></>}
    {selection !== null && <Dialog title="Source conversation" close={close}><Conversation key={related ?? `${selection.hit.session.id}:${selection.landing.span.messageId}:${selection.landing.span.start}`} connection={connection} stats={stats} user={user} sessionId={related ?? selection.hit.session.id} initialView={related === null ? selection.hit.session.view : undefined} initialLanding={related === null ? selection.landing : undefined} onSourceUnavailable={clearSource} archiveHead={null} select={setRelated} refresh={epoch} findReads={findReads}/></Dialog>}
  </main>;
}
