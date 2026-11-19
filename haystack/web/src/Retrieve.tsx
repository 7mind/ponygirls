import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { api, ApiError, AuthError, NetworkError, RetrievalUnavailable, type RetrievedHit, type RetrievedPage } from "./api";
import { useConnection } from "./Live";
import { UiIcon } from "./Masthead";
import { itemHash } from "./router";
import {
  afterUnavailable, MODES, nextOffset, pendingNotice, planSearch, retrieveHash, sameRetrieveState, SEARCH_LABEL,
  type Plan, type RetrievalModeName, type RetrieveState,
} from "./retrieve-state";

// Ranked search over title, description and tags (`POST /api/v1/retrieve`), next to the exact Boolean Browse.
// Scroll model A (spec §1): the document scrolls; the view bar sticks under the masthead; hits load as the document
// nears its end, up to the exact matches or the ranking window, and end with an explicit marker.

const PAGE_SIZE = 20;
/** The next page is requested when the end of the list comes this close to the viewport. */
const PREFETCH_MARGIN = "0px 0px 240px 0px";
/** The server's bound on retrieval query text (UTF-16 units). */
const QUERY_MAX = 2048;
const SNIPPET_MAX = 240;
const SCORE_DIGITS = 3;
const SKELETON_HITS = 4;
const SKELETON_TEXT_LINES = 3;
const MAX_KEPT_ROUTES = 6;
const MODE_HINTS: Readonly<Record<RetrievalModeName, string>> = {
  Lexical: "Words and phrases (web-search syntax), ranked by text relevance; exact counts",
  Semantic: "Related meaning through the embedding model; ranked within a candidate window",
  Hybrid: "Meaning and words combined; ranked within a candidate window",
};
const NOT_OFFERED = "Not configured on this server";
/** First-render examples in the server's web-search syntax (spec §3.1 Search: "four example queries"). */
const EXAMPLES: readonly string[] = ["token rotation", '"exact phrase"', "deploy or release", "migration -draft"];
const UNREACHABLE = "Server unreachable — the service may be down.";

type Capabilities = { status: "loading" } | { status: "loaded"; modes: readonly RetrievalModeName[] } | { status: "failed"; message: string; network: boolean };
/** A failed next page; `refusal`: an explicit mode's typed unavailability (its hits stay, the lexical search is offered). */
interface AppendFailure { message: string; refusal: string | null }
/** The plan actually served: a defaulted hybrid that fell back is a defaulted lexical plan with the fallback notice. */
interface Settled {
  kind: "settled"; plan: Plan; mode: RetrievalModeName; hits: RetrievedHit[]; countScope: string; total: number; rankingLimit: number | undefined;
  pending: number; next: number | null; appendFailure: AppendFailure | null;
}
/** idle: no query, nothing is requested (Browse is the listing). */
type Results =
  | { kind: "idle" }
  | { kind: "loading"; plan: Plan | null }
  | Settled
  | { kind: "unavailable"; plan: Plan; reason: string }
  /** `plan`: the plan attempted (null when the capability read failed); its mode and fallback notice stay shown. */
  | { kind: "failed"; plan: Plan | null; message: string; network: boolean };
/** A route this view showed before another search replaced it: only a settled answer is kept (spec §5 rule 2). */
interface Kept { results: Settled | Extract<Results, { kind: "unavailable" }>; pageTop: number; focus: Element | null }

const visible = (element: Element | null) => element !== null && element.getClientRects().length > 0;
const records = (count: number) => `${count} ${count === 1 ? "record" : "records"}`;
function failureText(error: unknown): string {
  if (error instanceof NetworkError) return UNREACHABLE;
  if (error instanceof RetrievalUnavailable) return `The server answered: ${error.reason}.`;
  return `Search failed: ${error instanceof ApiError || error instanceof Error ? error.message : "unknown"}.`;
}
/** Whitespace-collapsed evidence text, at most SNIPPET_MAX code points; React escapes it. */
function snippet(text: string): string {
  const points = Array.from(text.replace(/\s+/gu, " ").trim());
  return points.length <= SNIPPET_MAX ? points.join("") : `${points.slice(0, SNIPPET_MAX).join("")}…`;
}
/** How the server declared the count: exact matches, or the records found inside the ranking window. */
function countText(page: Pick<Settled, "countScope" | "total" | "rankingLimit">): string {
  if (page.countScope === "ExactMatches") return `${page.total} exact ${page.total === 1 ? "match" : "matches"}`;
  const window = page.rankingLimit === undefined ? "" : ` (ranking limit ${page.rankingLimit})`;
  return page.countScope === "CandidateWindow" ? `${records(page.total)} in the candidate window${window}` : `${page.total} · ${page.countScope}${window}`;
}

/** Opens the masthead indicator's connection details (as Browse's load failure does). */
function ConnectionDetailsButton() {
  const { details } = useConnection();
  return <button type="button" className="btn btn-sm btn-ghost" onClick={details.show}>Connection details</button>;
}

function HitRow({ hit, onOpen }: { hit: RetrievedHit; onOpen: (key: string) => void }) {
  // The link opens the record in this tab through the in-app history (Back returns here); modified clicks keep the browser's behaviour.
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpen(hit.key);
  };
  return <li className="hit-row" data-hit-key={hit.key}>
    <div className="hit-row-head">
      <a className="hit-row-key" href={itemHash(hit.key, false)} onClick={open}>{hit.key}</a>
      <span className="hit-row-score" title={`score ${hit.score}`}>score {hit.score.toPrecision(SCORE_DIGITS)}</span>
    </div>
    <div className="hit-row-meta">revision {hit.revision} · {hit.field} · <code title={hit.pointer}>{hit.pointer}</code></div>
    <p className="hit-row-text">{snippet(hit.text)}</p>
  </li>;
}

export function Retrieve({ initial, onOpen, onAuthLost }: { initial: RetrieveState; onOpen: (key: string) => void; onAuthLost: () => void }) {
  const [draft, setDraft] = useState<RetrieveState>(initial);
  const [applied, setApplied] = useState<RetrieveState>(initial);
  const [capabilities, setCapabilities] = useState<Capabilities>({ status: "loading" });
  const [results, setResults] = useState<Results>({ kind: "idle" });
  const [appending, setAppending] = useState(false);
  // An explicit Search of the route shown runs again; a counter, so that the same state can be searched anew.
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const section = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const kept = useRef(new Map<string, Kept>());
  const fresh = useRef(false);
  const restored = useRef<Kept | null>(null);
  const shownHash = useRef<string | null>(null);
  const pageTop = useRef(0);
  const formId = useId();
  const headingId = useId();
  const modeHintId = useId();

  useEffect(() => {
    const onScroll = () => { if (visible(section.current)) pageTop.current = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => () => { sequence.current++; }, []);

  const readCapabilities = useCallback(async () => {
    setCapabilities({ status: "loading" });
    try { setCapabilities({ status: "loaded", modes: await api.capabilities() }); }
    catch (error) {
      if (error instanceof AuthError) { onAuthLost(); return; }
      setCapabilities({ status: "failed", message: failureText(error), network: error instanceof NetworkError });
    }
  }, [onAuthLost]);
  useEffect(() => { void readCapabilities(); }, [readCapabilities]);

  // Ctrl K focuses the search text while this view is shown (as in Browse).
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.altKey) return;
      if (document.querySelector("dialog[open]") !== null || !visible(queryInput.current)) return;
      event.preventDefault(); queryInput.current!.focus(); queryInput.current!.select();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  // A new route of this view: keep the outgoing settled answer, restore a kept one, or search.
  const initialHash = retrieveHash(initial);
  useEffect(() => {
    if (!sameRetrieveState(initial, applied)) setDraft(initial);
    setApplied(initial);
  }, [initialHash]);

  const plan: Plan | null = applied.mode !== null ? planSearch(applied.mode, [])
    : capabilities.status === "loaded" ? planSearch(null, capabilities.modes) : null;
  const planKey = plan === null ? "" : `${plan.mode}:${plan.defaulted}`;
  // Only a defaulted search waits for the capability read; an explicit mode is requested as it is.
  const waiting = plan === null ? capabilities.status : "ready";
  const appliedHash = retrieveHash(applied);

  const fetchPage = useCallback((state: RetrieveState, mode: RetrievalModeName, offset: number): Promise<RetrievedPage> =>
    api.retrieve(state.query, mode, { project: state.project === "" ? undefined : state.project, includeArchived: state.includeArchived, offset, limit: PAGE_SIZE }), []);

  const search = useCallback(async (state: RetrieveState, planned: Plan) => {
    const request = ++sequence.current;
    setAppending(false);
    setResults({ kind: "loading", plan: planned });
    if (visible(section.current) && window.scrollY > 0) window.scrollTo(0, 0);
    let served = planned;
    let page: RetrievedPage;
    try {
      try { page = await fetchPage(state, planned.mode, 0); }
      catch (error) {
        if (request !== sequence.current || !(error instanceof RetrievalUnavailable)) throw error;
        const fallback = afterUnavailable(planned, error.reason);
        if (fallback.kind === "unavailable") { setResults({ kind: "unavailable", plan: planned, reason: fallback.reason }); return; }
        served = { mode: "Lexical", defaulted: true, notice: fallback.notice };
        setResults({ kind: "loading", plan: served });
        page = await fetchPage(state, served.mode, 0);
      }
    } catch (error) {
      if (request !== sequence.current) return;
      if (error instanceof AuthError) { onAuthLost(); return; }
      setResults({ kind: "failed", plan: served, message: failureText(error), network: error instanceof NetworkError });
      return;
    }
    if (request !== sequence.current) return;
    setResults({ kind: "settled", plan: served, mode: page.mode, hits: page.hits, countScope: page.countScope, total: page.total, rankingLimit: page.rankingLimit,
      pending: page.pending, next: nextOffset(0, PAGE_SIZE, page.total, page.rankingLimit), appendFailure: null });
  }, [fetchPage, onAuthLost]);

  useEffect(() => {
    // `results` is still the answer of the route shown before this one.
    const outgoing = shownHash.current;
    shownHash.current = appliedHash;
    const routeChanged = outgoing !== appliedHash;
    if (outgoing !== null && routeChanged && (results.kind === "settled" || results.kind === "unavailable")) {
      const focused = document.activeElement;
      kept.current.delete(outgoing);
      kept.current.set(outgoing, { results, pageTop: visible(section.current) ? window.scrollY : pageTop.current,
        focus: focused !== null && section.current !== null && section.current.contains(focused) ? focused : null });
      if (kept.current.size > MAX_KEPT_ROUTES) kept.current.delete(kept.current.keys().next().value!);
    }
    const back = fresh.current || !routeChanged ? undefined : kept.current.get(appliedHash);
    fresh.current = false;
    kept.current.delete(appliedHash);
    if (back !== undefined) {
      sequence.current++;
      setAppending(false);
      restored.current = back;
      setResults(back.results);
      return;
    }
    if (applied.query.trim() === "") { sequence.current++; setAppending(false); setResults({ kind: "idle" }); return; }
    if (plan === null) { sequence.current++; setResults(capabilities.status === "failed" ? { kind: "failed", plan: null, message: capabilities.message, network: capabilities.network } : { kind: "loading", plan: null }); return; }
    void search(applied, plan);
  }, [appliedHash, planKey, waiting, attempt, search]);

  // A restored route gets its scroll position and focus back once its hits are rendered.
  useLayoutEffect(() => {
    const route = restored.current;
    restored.current = null;
    if (route === null) return;
    window.scrollTo(0, route.pageTop);
    if (route.focus instanceof HTMLElement && route.focus.isConnected) route.focus.focus({ preventScroll: true });
  }, [results]);

  const append = useCallback(async () => {
    if (results.kind !== "settled" || results.next === null || appending || results.appendFailure !== null) return;
    const request = sequence.current;
    const offset = results.next;
    setAppending(true);
    try {
      const page = await fetchPage(applied, results.mode, offset);
      if (request !== sequence.current) return;
      setResults((previous) => previous.kind !== "settled" ? previous : {
        ...previous, hits: [...new Map([...previous.hits, ...page.hits].map((hit) => [hit.key, hit])).values()],
        total: page.total, rankingLimit: page.rankingLimit, pending: page.pending, next: nextOffset(offset, PAGE_SIZE, page.total, page.rankingLimit),
      });
    } catch (error) {
      if (request !== sequence.current) return;
      if (error instanceof AuthError) { onAuthLost(); return; }
      // The same rule as for the first page: a defaulted hybrid restarts lexically from the start (rankings are not
      // mixed); an explicit mode keeps its hits and shows the refusal with the lexical search.
      const fallback = error instanceof RetrievalUnavailable ? afterUnavailable(results.plan, error.reason) : null;
      if (fallback !== null && fallback.kind === "lexical") { void search(applied, { mode: "Lexical", defaulted: true, notice: fallback.notice }); return; }
      const refusal = fallback === null ? null : fallback.reason;
      setResults((previous) => previous.kind !== "settled" ? previous : { ...previous, appendFailure: { message: failureText(error), refusal } });
    } finally {
      if (request === sequence.current) setAppending(false);
    }
  }, [results, appending, applied, fetchPage, onAuthLost, search]);

  const canAppend = results.kind === "settled" && results.next !== null && !appending && results.appendFailure === null;
  useEffect(() => {
    if (!canAppend || sentinel.current === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) void append(); }, { rootMargin: PREFETCH_MARGIN });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [canAppend, append]);

  /** Applies `state`: changed values are navigated to; the values shown (whatever the fragment's spelling) search again. */
  function submit(state: RetrieveState) {
    setDraft(state);
    fresh.current = true;
    if (!sameRetrieveState(state, applied)) { location.hash = retrieveHash(state); return; }
    if (capabilities.status === "failed" && state.mode === null) void readCapabilities();
    setAttempt((value) => value + 1);
  }
  function retryCapabilities() { fresh.current = true; void readCapabilities(); }

  const offered = capabilities.status === "loaded" ? capabilities.modes : MODES;
  const unoffered = MODES.filter((mode) => !offered.includes(mode));
  const edited = draft.query !== applied.query;
  const servedPlan = results.kind === "idle" ? null : results.plan;
  const served = results.kind === "settled" ? results.mode : servedPlan === null ? null : servedPlan.mode;
  const counter = results.kind === "idle" ? ""
    : results.kind === "loading" ? "Searching…"
    : results.kind === "failed" || results.kind === "unavailable" ? "Not loaded"
    : results.hits.length === 0 ? "No matches"
    : results.next === null ? `All ${records(results.hits.length)} loaded` : `${results.hits.length} loaded · more available`;
  const notice = servedPlan?.notice ?? null;

  return <section ref={section} className="retrieve" aria-labelledby={headingId} aria-busy={results.kind === "loading" || appending}>
    <h1 id={headingId} className="sr-only">{SEARCH_LABEL}</h1>
    <form id={formId} className="viewbar" role="search" aria-label="Ranked search" onSubmit={(event) => { event.preventDefault(); submit(draft); }}>
      <div className="querybar">
        <UiIcon name="search" />
        <input ref={queryInput} type="text" aria-label="Search text" enterKeyHint="search" maxLength={QUERY_MAX} autoComplete="off" spellCheck={false}
          placeholder={'Search by words or meaning — web-search syntax: "phrase", -word, or'} value={draft.query}
          onChange={(event) => setDraft({ ...draft, query: event.currentTarget.value })} />
        <button type="button" className="btn btn-ghost btn-icon btn-sm retrieve-clear" aria-label="Clear search text" disabled={draft.query === ""}
          onMouseDown={(event) => event.preventDefault()} onClick={() => { setDraft({ ...draft, query: "" }); queryInput.current?.focus(); }}><UiIcon name="x" /></button>
        {edited ? <span className="retrieve-draft" role="status">Edited · press Enter to search</span> : <span className="kbd hide-md" aria-hidden="true">Ctrl K</span>}
        <button className="btn btn-primary" type="submit">Search</button>
      </div>
      <div className="viewbar-meta" role="status" aria-live="polite">{counter}</div>
    </form>
    <div className="filterbar retrieve-controls">
      <div className="segmented" role="group" aria-label="Search mode" aria-describedby={unoffered.length > 0 ? modeHintId : undefined}>
        <button type="button" aria-pressed={draft.mode === null} title="Hybrid when the server offers it, otherwise lexical"
          onClick={() => submit({ ...draft, mode: null })}>Default</button>
        {MODES.map((mode) => {
          const disabled = unoffered.includes(mode);
          return <button key={mode} type="button" aria-pressed={draft.mode === mode} aria-disabled={disabled || undefined}
            title={disabled ? `${mode}: ${NOT_OFFERED}` : MODE_HINTS[mode]}
            onClick={() => { if (!disabled) submit({ ...draft, mode }); }}>{mode}</button>;
        })}
      </div>
      {unoffered.length > 0 && <span id={modeHintId} className="retrieve-mode-hint">{unoffered.join(" and ")}: {NOT_OFFERED.toLowerCase()}</span>}
      <span className="filter-divider hide-sm" aria-hidden="true" />
      <input className="input retrieve-project" form={formId} aria-label="Project (exact)" placeholder="Project (exact)" value={draft.project} autoComplete="off" spellCheck={false}
        onChange={(event) => setDraft({ ...draft, project: event.currentTarget.value })} />
      <label className="check"><input type="checkbox" checked={draft.includeArchived} onChange={(event) => submit({ ...draft, includeArchived: event.currentTarget.checked })} />Include archived</label>
      <div className="sortline"><a href="#/browse">Exact filters in Browse</a></div>
    </div>
    {served !== null && servedPlan !== null && <p className="retrieve-summary" data-effective-mode={served}>
      Mode <strong>{served}</strong> {servedPlan.defaulted ? "(default)" : "(chosen)"}
      {results.kind === "settled" && ` · ${countText(results)}`}
      {results.kind === "loading" && " · searching…"}
    </p>}
    <div className="retrieve-notices">
      {notice !== null && <div className="notice notice-warn notice-row" role="status" data-notice="lexical"><UiIcon name="alert" /><div className="grow">{notice}</div></div>}
      {results.kind === "settled" && results.mode !== "Lexical" && results.pending > 0 &&
        <div className="notice notice-row" role="status" data-notice="pending"><UiIcon name="info" /><div className="grow">{pendingNotice(results.pending)}</div></div>}
      {results.kind === "unavailable" && <div className="notice notice-warn" role="alert" data-notice="unavailable"><UiIcon name="alert" /><div className="grow">
        <div className="notice-title">{results.plan.mode} search is unavailable</div>
        The server answered: {results.reason}. No other mode was used.
        <div className="notice-actions"><button type="button" className="btn btn-sm" onClick={() => submit({ ...applied, mode: "Lexical" })}>Search lexically instead</button></div>
      </div></div>}
    </div>
    {results.kind === "failed" && <div className="page"><div className="notice notice-danger" role="alert"><UiIcon name="alert" /><div className="grow">
      <div className="notice-title">{plan === null && applied.mode === null ? "Search modes could not be read" : "Search failed"}</div>
      {results.message} Your query is unchanged and nothing was modified.
      <div className="notice-actions"><button type="button" className="btn btn-sm"
        onClick={() => { if (applied.mode === null && capabilities.status === "failed") retryCapabilities(); else submit(applied); }}>Retry</button>
        {results.network && <ConnectionDetailsButton />}</div>
    </div></div></div>}
    <div className="retrieve-results" role="region" aria-label="Search results" data-state={edited && results.kind === "settled" ? "stale" : results.kind}>
      {results.kind === "loading" && <ol className="retrieve-hits" aria-hidden="true" data-skeleton="">
        {Array.from({ length: SKELETON_HITS }, (_, index) => <li key={index} className="hit-row"><span className="skeleton sk-30" />
          {Array.from({ length: SKELETON_TEXT_LINES }, (_, line) => <span key={line} className="skeleton" />)}</li>)}
      </ol>}
      {results.kind === "settled" && results.hits.length > 0 && <ol className="retrieve-hits">
        {results.hits.map((hit) => <HitRow key={hit.key} hit={hit} onOpen={onOpen} />)}
      </ol>}
      {results.kind === "idle" && <div className="empty" data-empty="idle">
        <UiIcon name="search" />
        <h2>Search records by words or meaning</h2>
        <p>Ranked search over titles, descriptions and tags. Words use web-search syntax, not the Browse query language; semantic and hybrid modes also find related wording.</p>
        <div className="row row-wrap retrieve-examples">{EXAMPLES.map((example) => <button key={example} type="button" className="filter filter-field"
          onClick={() => submit({ ...draft, query: example })}>{example}</button>)}</div>
      </div>}
      {results.kind === "settled" && results.hits.length === 0 && <div className="empty" data-empty="no-matches">
        <UiIcon name="search" />
        <h2>No matching records</h2>
        <p>Nothing matches <code>{applied.query}</code> in {results.mode.toLowerCase()} search{applied.project !== "" && <> in project <code>{applied.project}</code></>}.
          {!applied.includeArchived && " Archived records are not searched."}</p>
        <div className="row">
          <button type="button" className="btn" onClick={() => submit({ ...applied, query: "" })}>Clear query</button>
          {!applied.includeArchived && <button type="button" className="btn" onClick={() => submit({ ...applied, includeArchived: true })}>Include archived</button>}
          <a className="btn btn-ghost" href="#/browse">Browse records</a>
        </div>
      </div>}
      {results.kind === "settled" && results.hits.length > 0 && (results.appendFailure !== null ? <div className="retrieve-foot-notice">
        <div className="notice notice-danger notice-row" role="alert" data-notice={results.appendFailure.refusal === null ? undefined : "unavailable"}><UiIcon name="alert" /><div className="grow">
          <span className="notice-title">The next results could not be loaded{results.appendFailure.refusal === null ? "." : `: ${results.mode} search is unavailable.`}</span>
          {" "}{results.appendFailure.message} The {records(results.hits.length)} above {results.hits.length === 1 ? "is" : "are"} kept{results.appendFailure.refusal === null ? "." : "; no other mode was used."}
        </div>
        {results.appendFailure.refusal !== null && <button type="button" className="btn btn-sm" onClick={() => submit({ ...applied, mode: "Lexical" })}>Search lexically instead</button>}
        <button type="button" className="btn btn-sm" onClick={() => setResults({ ...results, appendFailure: null })}>Retry loading results</button></div>
      </div> : results.next === null ? <div className="list-foot list-end" data-list-end="">
        {results.countScope === "CandidateWindow" ? "End of the candidate window" : "End of list"} · {records(results.hits.length)}</div>
        : <div ref={sentinel} className="list-foot">{appending && <span className="spinner" aria-hidden="true" />}{appending ? "Loading more results…" : "More results load as you scroll"}</div>)}
    </div>
  </section>;
}
