import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Operation_ArchiveSearch, Result_ArchiveSearch, ArchiveQuery, ArchiveSort, ContentView, type ArchiveResult, ArchiveTextScope, ExpressionHintTarget_Archive, SortDirection, ArchiveMatchKind, Operation_ReadMessageContext, Result_MessageContext, Span, type ArchiveRow, type ArchiveSourceMatch, type MessageContextResult, type PassageSourceSpan, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
import type { TextPart } from './highlight.ts';
import { useResource } from './hooks.ts';
import { Anchored } from './Popover.tsx';
import { formatRoute, sessionPlaceRoute, viewRoute, type SessionPlace } from './router.ts';
import { listenSourceUnavailable, reportSourceUnavailable, sourcePin } from './source-authority.ts';
import { contentViewKey, sameContentView } from './source-view.ts';
import { CONTEXT_BYTES, SEARCH_PAGE_SIZE, SNIPPET_BYTES, snippetAnchor, sourceDenialAffectsResults, validateContext, validateArchiveSearchPage, contextParts, type SearchResultRow, type SearchSourceFailure } from './search-source.ts';
import { useSearchChain } from './search-chain.ts';
import { ExpressionEditor, archiveFields } from './ExpressionEditor.tsx';
import './search.css';
interface SearchScope { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo }
interface ContextPage { anchor: Span; before: number; after: number }
interface SourceExcerpt { source: PassageSourceSpan; role: string; parts: TextPart[] }
interface MessageRange { first: number; last: number }
type ContextRead = { kind: 'source'; result: MessageContextResult; excerpts: SourceExcerpt[] } | { kind: 'failure'; failure: SearchSourceFailure };
type IconName = 'search' | 'info' | 'chevron-down' | 'chevron-up' | 'arrow-right' | 'arrow-up' | 'arrow-down' | 'alert';
const ICON_SPRITE = '/ui/icons.svg';
const SKELETON_RESULTS = 4;
const LOAD_AHEAD_MARGIN = '0px 0px 400px 0px';
const VISIBLE_TAGS = 3;
const EXAMPLE_QUERIES: readonly string[] = ['migration retry', '"lock timeout" project:chronicle', 'tag:flaky after:2026-11-01', 'producer:pi AND NOT branch:main'];
function Icon({ name, small }: { name: IconName; small: boolean }) {
  return <svg className={small ? 'icon icon-sm' : 'icon'} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href={`${ICON_SPRITE}#${name}`}/></svg>;
}
function Notice({ title, children, actions }: { title: string; children: ReactNode; actions: ReactNode }) {
  return <div className="notice notice-danger" role="alert"><Icon name="alert" small={false}/><div><div className="notice-title">{title}</div>{children}{actions !== null && <div className="notice-actions">{actions}</div>}</div></div>;
}
function sentence(text: string): string { return `${text.replace(/[.\s]+$/, '')}.`; }
function timestamp(value: string): string { return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
// Links to the session route (spec §5) carry the complete pin of the view they read (router sessionPlaceRoute) and the match to land on.
function sessionLink(sessionId: string, view: ContentView, landing: Pick<SessionPlace, 'at' | 'find'>): string {
  return formatRoute(sessionPlaceRoute(sessionId, { pin: { revision: view.revision, generationId: view.generationId ?? null }, ...landing, pane: null, passage: null }));
}
function matchLink(sessionId: string, match: ArchiveSourceMatch): string { return sessionLink(sessionId, match.view, { at: match.span.messageId, find: match.operand }); }
function titleLink(sessionId: string, view: ContentView, landing: ArchiveSourceMatch | undefined): string {
  return landing === undefined ? sessionLink(sessionId, view, { at: null, find: null }) : matchLink(sessionId, landing);
}
function matchTitle(match: ArchiveSourceMatch): string { return `${match.kind === ArchiveMatchKind.Literal ? 'Literal' : 'Semantic'} match for ${match.operand}`; }
function Highlighted({ parts }: { parts: readonly TextPart[] }) {
  return <>{parts.map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}
function SearchHit({ connection, stats, user, sessionId, match, ordinal, expanded, positions, fail }: SearchScope & { sessionId: string; match: ArchiveSourceMatch; ordinal: number; expanded: boolean; positions: (range: MessageRange | null) => void; fail: (failure: SearchSourceFailure) => void }) {
  const { span, view } = match;
  const [moved, setMoved] = useState<ContextPage | null>(null), page = moved ?? { anchor: snippetAnchor(span), before: 0, after: SNIPPET_BYTES };
  useEffect(() => { if (!expanded) setMoved(null); }, [expanded]);
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
  const failure = useRef(fail); failure.current = fail;
  useEffect(() => {
    if (message === null) return;
    failure.current({ code, message });
    reportSourceUnavailable(document, { origin: 'search', sessionId, view: sourcePin(view), code, message });
  }, [code, message, sessionId, view]);
  const first = source === null ? undefined : source.excerpts[0]?.source, last = source === null ? undefined : source.excerpts.at(-1)?.source;
  const firstPosition = first === undefined ? null : first.messagePosition, lastPosition = last === undefined ? null : last.messagePosition;
  useEffect(() => { positions(firstPosition === null || lastPosition === null ? null : { first: firstPosition, last: lastPosition }); }, [firstPosition, lastPosition, positions]);
  const href = matchLink(sessionId, match), matched = (excerpt: SourceExcerpt) => excerpt.source.messageId === span.messageId && excerpt.parts.some(part => part.highlighted || moved === null);
  const shown = source === null ? [] : expanded ? source.excerpts : source.excerpts.filter(matched).slice(0, 1);
  return <div className="hit-group" data-match-kind={match.kind} aria-busy={context.loading}>
    {context.loading && <p className="hit hit-loading" role="status"><span className="skeleton"/><span className="sr-only">Loading source excerpts…</span></p>}
    {shown.map(excerpt => {
      const range = excerpt.source, content = <><span className="hit-role" data-role={excerpt.role}>{excerpt.role}</span><span className="hit-text" data-hit-text=""><Highlighted parts={excerpt.parts}/></span><span className="hit-at">message {range.messagePosition + 1}</span></>;
      return matched(excerpt) ? <a className="hit" data-hit="match" data-focus-key={`hit:${sessionId}:${ordinal}`} key={`${range.messageId}:${range.start}`} href={href} title={matchTitle(match)}>{content}</a> : <div className="hit hit-context" data-hit="context" key={`${range.messageId}:${range.start}`}>{content}</div>;
    })}
    {span.end - span.start > CONTEXT_BYTES && <p className="hit-note">Partial preview · source span exceeds {CONTEXT_BYTES} bytes.</p>}
    {expanded && source !== null && <div className="hit-nav">
      <button type="button" className="btn btn-sm" disabled={source.result.previous === undefined} onClick={() => { if (source.result.previous !== undefined) setMoved({ anchor: source.result.previous, before: CONTEXT_BYTES, after: 0 }); }}><Icon name="arrow-up" small={true}/>Earlier context</button>
      <button type="button" className="btn btn-sm" disabled={source.result.next === undefined} onClick={() => { if (source.result.next !== undefined) setMoved({ anchor: source.result.next, before: 0, after: CONTEXT_BYTES }); }}><Icon name="arrow-down" small={true}/>Later context</button>
    </div>}
  </div>;
}
function Crumb({ row }: { row: ArchiveRow }) {
  const metadata = row.head.metadata, tags = row.tags.slice(0, VISIBLE_TAGS), more = row.tags.length - tags.length;
  return <div className="result-crumb"><span>{metadata.producer}</span><span className="sep">{metadata.project ?? 'No project'}</span>{metadata.gitBranch !== undefined && <span className="sep branch">{metadata.gitBranch}</span>}<span className="sep">{row.messageCount.toLocaleString()} messages</span>
    {row.publishedView === undefined && <span className="chip" title="Not indexed yet: matched by exact text only">exact text only · not indexed</span>}
    {tags.map(tag => <span className="chip chip-outline" key={tag}>{tag}</span>)}{more > 0 && <span className="chip chip-outline">+{more}</span>}</div>;
}
function SearchResult({ item: { row, matches }, ...scope }: SearchScope & { item: SearchResultRow }) {
  const [unavailable, setUnavailable] = useState<string | null>(null), [expanded, setExpanded] = useState(false), [ranges, setRanges] = useState<(MessageRange | null)[]>([]);
  const view = row.matchedView ?? row.publishedView ?? row.head.view, landing = matches.find(match => sameContentView(match.view, view)), firstMatch = matches[0];
  const title = row.head.metadata.title || 'Untitled conversation', summaries = [...new Set(matches.flatMap(match => match.summary === undefined ? [] : [match.summary]))];
  const gap = ranges[0] !== undefined && ranges[0] !== null && ranges[1] !== undefined && ranges[1] !== null ? ranges[1].first - ranges[0].last - 1 : 0;
  function fail(failure: SearchSourceFailure) { setUnavailable(failure.message); }
  const reports = useRef(matches.map((_, index) => (range: MessageRange | null) => setRanges(value => { const next = [...value]; next[index] = range; return next; })));
  return <article className="result" data-row-id={row.head.id} data-open={expanded}>
    <div className="result-head"><h2 className="result-title">{unavailable === null ? <a href={titleLink(row.head.id, view, landing)} data-focus-key={`title:${row.head.id}`}>{title}</a> : <span aria-disabled="true">{title}</span>}</h2>{row.lastTimestamp !== undefined && <time className="result-time" dateTime={row.lastTimestamp} title={row.lastTimestamp}>{timestamp(row.lastTimestamp)}</time>}</div>
    <Crumb row={row}/>
    {unavailable !== null ? <Notice title="Source unavailable" actions={null}>{sentence(unavailable)} This result's source excerpts have been cleared. Submit a new search to recheck access; no HEAD fallback is used.</Notice>
      : matches.length === 0 ? <p className="result-note">No positive source spans. Open the conversation to read its source.</p>
      : <>
        <div className="hits">{matches.map((match, index) => <div key={index}>
          {index > 0 && expanded && gap > 0 && <div className="hit-gap">⋯ {gap} {gap === 1 ? 'message' : 'messages'} between</div>}
          <SearchHit {...scope} sessionId={row.head.id} match={match} ordinal={index} expanded={expanded} positions={reports.current[index]!} fail={fail}/></div>)}</div>
        {summaries.map(summary => <p className="result-note" key={summary}><b>Generated annotation</b> · {summary}</p>)}
        <div className="result-foot">
          <button type="button" className="btn btn-sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)} data-focus-key={`expand:${row.head.id}`}><Icon name={expanded ? 'chevron-up' : 'chevron-down'} small={true}/>{expanded ? 'Collapse' : 'Context'}</button>
          {firstMatch !== undefined && <a className="btn btn-sm btn-ghost" href={matchLink(row.head.id, firstMatch)} data-focus-key={`open:${row.head.id}`}>Open at first match<Icon name="arrow-right" small={true}/></a>}
          {expanded && <span className="push xs muted">{matches.length} representative {matches.length === 1 ? 'match' : 'matches'} shown</span>}
        </div></>}
  </article>;
}
function ResultsInfo({ meta }: { meta: ArchiveResult }) {
  const bounded = meta.textScope === ArchiveTextScope.BoundedCandidateSets;
  return <Anchored className="search-info" buttonClassName="btn btn-ghost btn-icon" buttonState={undefined} ariaLabel="How these results were found" describedBy={undefined} panel="dialog" panelClassName="popover" panelLabel="How these results were found" label={<Icon name="info" small={false}/>}>
    <div className="stack-sm"><strong>How these results were found</strong>
      <dl className="dl xs"><dt>Order</dt><dd>{meta.relevanceOrdered ? 'relevance' : 'last activity'}</dd><dt>Retrieval</dt><dd>{bounded ? 'semantic candidates' : 'exact lexical and metadata'}</dd>
        {bounded && <><dt>Candidates</dt><dd>bounded, {meta.annChunkLimitPerOperand} published chunks per text operand</dd></>}<dt>Evidence</dt><dd>up to two representative source spans per conversation</dd></dl>
      <p className="xs muted">{bounded ? `Up to ${meta.annChunkLimitPerOperand} published chunks per text operand, not a row cap. Hybrid also includes exact lexical HEAD matches. ` : ''}Counts are exact for the retrieved candidates. Highlights mark matched bytes; the spans are not proof of every Boolean operand.</p></div>
  </Anchored>;
}
function ResultsFoot({ enabled, settled, end, loading, load, children }: { enabled: boolean; settled: number; end: boolean; loading: boolean; load: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null), loader = useRef(load); loader.current = load;
  useEffect(() => {
    const element = ref.current;
    if (element === null || !enabled) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) loader.current(); }, { rootMargin: LOAD_AHEAD_MARGIN });
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, settled]);
  return <div className={end ? 'list-foot list-end' : 'list-foot'} ref={ref} data-list-foot={end ? 'end' : 'more'} role="status" aria-live="polite">{loading ? <><span className="spinner" aria-hidden="true"/>Loading more conversations…</> : children}</div>;
}
// A retained (hidden) view loses focus; when it is shown again the control that was last used gets it back.
function useReturnFocus(root: React.RefObject<HTMLElement | null>): (event: React.FocusEvent) => void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    const element = root.current;
    if (element === null) return;
    let hidden = element.getClientRects().length === 0;
    const observer = new ResizeObserver(() => {
      const shown = element.getClientRects().length > 0;
      if (shown && hidden && last.current !== null && (document.activeElement === null || document.activeElement === document.body)) {
        element.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(last.current)}"]`)?.focus({ preventScroll: true });
      }
      hidden = !shown;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return event => { const key = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey : undefined; if (key !== undefined) last.current = key; };
}
// The draft and the submitted expression are owned by the shell (per-route state, the submitted one in the URL).
export interface SearchQueryState { draft: string; setDraft: (draft: string) => void; submitted: string | null; setSubmitted: (submitted: string | null) => void }
export function Search({ connection, stats, user, query }: SearchScope & { query: SearchQueryState }) {
  const { draft, setDraft, submitted, setSubmitted } = query, [composing, setComposing] = useState(false), [epoch, setEpoch] = useState(0), [cleared, setCleared] = useState<string | null>(null);
  useEffect(() => connection.onInvalidate(() => setSubmitted(null)), [connection]);
  function submit(expression: string) { if (composing || stats.activeId === null) return; setCleared(null); setSubmitted(expression); setEpoch(value => value + 1); }
  const chain = useSearchChain(connection, stats, submitted === null ? null : JSON.stringify([user.id, submitted, epoch]), async cursor => {
    if (submitted === null) throw new Error('Search has no submitted expression.');
    const request = new ArchiveQuery(submitted, ArchiveSort.LastTimestamp, SortDirection.Desc, cursor, SEARCH_PAGE_SIZE, true);
    return validateArchiveSearchPage(await read(connection, new Operation_ArchiveSearch(request), reply => reply instanceof Result_ArchiveSearch ? reply.result : null), cursor);
  });
  const loaded = useRef(chain.rows); loaded.current = chain.rows;
  // The opened session reports a denied or retired pinned source: results that retain data of it are cleared, as an authority fence.
  useEffect(() => listenSourceUnavailable(document, detail => {
    if (detail.origin !== 'session' || !sourceDenialAffectsResults(detail.sessionId, detail.view === null ? null : new ContentView(detail.view.revision, detail.view.generationId ?? undefined), detail.code, loaded.current)) return;
    setCleared(`${sentence(detail.message)} Search results cleared after a denied or unavailable pinned source. Submit to recheck; no fallback was used.`); setSubmitted(null);
  }), [setSubmitted]);
  const root = useRef<HTMLElement>(null), returnFocus = useReturnFocus(root);
  const edited = submitted !== null && draft !== submitted, meta = chain.meta;
  const counter = edited ? <span className="stale-hint">Query edited · Enter to update</span>
    : chain.loading ? 'Searching…' : chain.error !== null ? 'Not loaded' : meta === null ? '' : chain.rows.length === 0 ? 'No matches' : <><strong>{meta.total.toString()}</strong> conversations · {chain.rows.length} loaded</>;
  return <main className="search-page" aria-label="Search" data-view="search" ref={root} onFocus={returnFocus}>
    <div className="search-editor"><ExpressionEditor submission="explicit" completion={{ connection, stats, owner: user.id, target: new ExpressionHintTarget_Archive() }} value={draft} applied={submitted ?? ''} change={setDraft} submit={submit} compositionChange={setComposing} composing={composing} disabled={stats.activeId === null} fields={archiveFields} help={null}/></div>
    {submitted !== null && <div className="search-bar" data-view-bar><div className="viewbar-meta" role="status" aria-live="polite">{counter}</div>{meta !== null && <ResultsInfo meta={meta}/>}</div>}
    {cleared !== null && submitted === null && <div className="search-notice"><Notice title="Search results cleared" actions={null}>{cleared}</Notice></div>}
    {submitted === null ? <section className="empty" data-state="intro"><Icon name="search" small={false}/><h2>Search every conversation you can read</h2><p>Plain words find passages by meaning and by exact text. Fields narrow the set. Results load as you scroll — no pages.</p>
      <div className="row row-wrap search-examples">{EXAMPLE_QUERIES.map(example => <button type="button" className="filter filter-field" key={example} onClick={() => { setDraft(example); submit(example); }}>{example}</button>)}</div></section>
      : chain.error !== null ? <div className="search-notice"><Notice title="Search failed" actions={<button type="button" className="btn btn-sm" onClick={() => submit(submitted)}>Retry</button>}>{sentence(chain.error)} Search results cleared; your query is kept. No fallback search was used.</Notice></div>
      : chain.loading ? <div className="results" data-state="loading" aria-busy="true">{Array.from({ length: SKELETON_RESULTS }, (_, index) => <div className="result" key={index}><span className="skeleton sk-30"/><span className="skeleton sk-60"/><span className="skeleton"/><span className="skeleton sk-60"/></div>)}</div>
      : meta !== null && chain.rows.length === 0 ? <section className="empty" data-state="empty"><Icon name="search" small={false}/><h2>No conversations match</h2><p>Nothing matches <code>{submitted}</code>. Try fewer words, remove a filter, or search the text without quotes.</p><div className="row"><a className="btn btn-ghost" href={formatRoute(viewRoute('archive'))}>Browse the Archive</a></div></section>
      : <><div className="results" data-list="results" data-state={edited ? 'stale' : 'current'}>{chain.rows.map(item => <SearchResult key={`${item.row.head.id}:${contentViewKey(item.row.head.view)}`} {...{ connection, stats, user }} item={item}/>)}</div>
        <ResultsFoot enabled={chain.hasMore && chain.appendError === null} settled={chain.settled} end={!chain.hasMore && meta !== null} loading={chain.loadingMore} load={chain.loadMore}>
          {chain.appendError !== null ? <Notice title="Could not load more results" actions={<button type="button" className="btn btn-sm" onClick={chain.loadMore}>Retry</button>}>{sentence(chain.appendError)}</Notice>
            : !chain.hasMore && meta !== null ? `End of results · ${meta.total.toString()} conversations` : null}
        </ResultsFoot></>}
  </main>;
}
