import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { SessionFind, type FindChoice } from './SessionFind.tsx';
import { recordedYoloProfile } from './recorded-yolo-profile.ts';
import type { SessionFindReadGate } from './session-find.ts';
import { ContentView, Span, PassageFormat, Operation_GetPassages, Operation_GetPassageSpans, Result_Passages, Result_PassageSpans, type PassageInfo, type PassagesResult, Operation_GetSession, Operation_GetMessages, Operation_Related, Operation_LocateMessage, Result_Session, Result_Messages, Result_Related, Result_LocatedMessage, type UserInfo, type Message, type MessagesResult, type Operation, type Result, type SessionInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { useInfiniteResource } from './infinite.ts';
import { InfiniteTrigger } from './InfiniteTrigger.tsx';
import { ScrollAnchor } from './ScrollAnchor.tsx';
import { ErrorNotice, formatDate } from './App.tsx';
import { CopyButton, MessageContent, sourceOnly } from './MessageContent.tsx';
import { Anchored } from './Popover.tsx';
import { Icon } from './Icon.tsx';
import { HashRouter, InvalidSessionAddress, formatRoute, parseFragment, routeSlot, sessionIdOf, sessionPlaceOf, sessionPlaceRoute, useRouteState, SESSION_PANES, type Route, type SessionPane, type SessionPlace } from './router.ts';
import { contentViewKey, requireContentView } from './source-view.ts';
import { isAuthorityDenial, sourceFailureAffectsView } from './source-authority.ts';
import { PASSAGE_PAGE_SIZE, validatePassages, validatePassageSpans } from './passages.ts';
import './session.css';
import { RequestFailure, type ManagerStats } from './transport/types.ts';
const MESSAGE_PAGE_SIZE = 40;
const SOURCE_SCROLL_GAP = 8;
const RELATED_LIMIT = 6;
// Prose messages fold after about seven lines (session.css `.msg-fold`). Rendered lines are estimated from the text: a
// source line wraps every LINE_CHARACTERS characters at the 720 px measure. A system prompt longer than one line folds to one.
const LINE_CHARACTERS = 100, FOLD_LINES = 8, PROMPT_CHARACTERS = 160;
// An open tool row shows the head of long output (the same fold) with "Show all N lines".
const TOOL_HEAD_LINES = 10;
// The side pane opens by default on wide viewports only (spec §9 decision 6); the reader's choice is remembered per browser.
const WIDE_SESSION_QUERY = '(min-width: 1280px)';
// On phones the open side pane covers the transcript (session.css); choosing a place in it closes it to show that place.
const PHONE_QUERY = '(max-width: 720px)';
const PANE_STORAGE_KEY = 'chronicle.session.pane';
const SIDE_TABS: readonly { readonly pane: Exclude<SessionPane, 'closed'>; readonly label: string }[] = [{ pane: 'outline', label: 'Outline' }, { pane: 'find', label: 'Find' }, { pane: 'related', label: 'Related' }, { pane: 'info', label: 'Info' }];
const TOOL_ROLES: ReadonlySet<string> = new Set(['tool', 'toolresult', 'function_call']);
const PROMPT_ROLES: ReadonlySet<string> = new Set(['system', 'developer']);
const ROLE_LABELS: ReadonlyMap<string, string> = new Map([['user', 'User'], ['assistant', 'Assistant'], ['system', 'System'], ['developer', 'Developer'], ['tool', 'Tool'], ['toolresult', 'Tool result'], ['function_call', 'Function call']]);
type SourceNavigationOrigin = 'annotation' | 'find' | 'place';
interface SourceNavigation { operation: number; origin: SourceNavigationOrigin }
/** A navigation waiting for its message page: by message id (located) or, for the position bar, by position only. */
interface PendingSourceScroll extends SourceNavigation { messageId: string | null; position: number; focus: boolean }
interface LandedSource extends PendingSourceScroll { messageId: string }
class UnverifiedSourceLocator extends Error {}

/** The list a session page was opened from (the parent list for an address): its address with its retained query, and its name. */
export interface ParentList { readonly href: string; readonly label: string }
/** What the routed page integrates: Back, links to messages, and the reading place it keeps in the address. */
interface PageIntegration {
  back(): void;
  /** The parent list, for the header's crumb and the notices' Back. */
  parent: ParentList;
  initial: { readonly at: string | null; readonly find: string | null; readonly passage: string | null };
  messageLink(view: ContentView, messageId: string): string;
  report(update: { readonly view: ContentView; readonly at: string | null; readonly passage: string | null }): void;
}
/**
 * A source read of this session was denied (session, passages, spans, message pages, locator or Find): the message the user
 * saw, its failure code, the pin the failed read used (null while the default view is still being chosen) and the session.
 */
export interface SourceUnavailableReport { readonly sessionId: string; readonly pin: ContentView | null; readonly code: string; readonly message: string }
/**
 * What the host learned elsewhere about this session's source; one object per signal, in arrival order. `source-failure`: another view's read
 * of `pin` failed (`pin` null: the session's default view); it applies when `sourceFailureAffectsView` holds for the shown
 * view. `withdrawn`: the list that opened the session no longer lists it; it applies to every view.
 */
export type SourceRevocation =
  | { readonly kind: 'source-failure'; readonly pin: ContentView | null; readonly code: string | null; readonly message: string }
  | { readonly kind: 'withdrawn'; readonly message: string };
/** Whether a revocation concerns the shown view; null while the default view is still being chosen and only its pin could tell. */
function revocationAffects(revocation: SourceRevocation, view: ContentView | undefined): boolean | null {
  if (revocation.kind === 'withdrawn' || isAuthorityDenial(revocation.code)) return true;
  return view === undefined ? null : sourceFailureAffectsView(revocation.pin, view, revocation.code);
}
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['indexed-view-retired', 'forbidden', 'not-found', 'unauthorized']);
interface SessionViewProps {
  connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; sessionId: string; initialView: ContentView | undefined; findReads: SessionFindReadGate;
  relatedHref(sessionId: string): string; pane: SessionPane; setPane(pane: SessionPane): void; page: PageIntegration;
  report(report: SourceUnavailableReport): void; revocations: readonly SourceRevocation[];
}
interface HeadScope { connection: ChronicleConnection; userId: string; sessionId: string; generation: number; activeId: number | null; invalidation: number }
interface KnownHead extends HeadScope { ownerId: string; revision: number }
function sameHeadScope(left: HeadScope, right: HeadScope): boolean {
  return left.connection === right.connection && left.userId === right.userId && left.sessionId === right.sessionId && left.generation === right.generation && left.activeId === right.activeId && left.invalidation === right.invalidation;
}
function storedPane(storage: Storage): SessionPane | null {
  // Storage can be unavailable (privacy settings); the pane then follows the viewport default.
  let value: string | null;
  try { value = storage.getItem(PANE_STORAGE_KEY); } catch { return null; }
  return SESSION_PANES.find(pane => pane === value) ?? null;
}
function rememberPane(storage: Storage, pane: SessionPane) { try { storage.setItem(PANE_STORAGE_KEY, pane); } catch { /* not remembered; see storedPane */ } }
function initialPane(): SessionPane { return storedPane(window.localStorage) ?? (window.matchMedia(WIDE_SESSION_QUERY).matches ? 'outline' : 'closed'); }

// Last reading place per session of this owner: reopening a session from a list returns to it (spec §5, groundwork S5).
const SESSION_PLACES = routeSlot<SessionPlace | null>('session-place', () => null);
const EMPTY_PLACE: SessionPlace = { pin: null, at: null, find: null, pane: null, passage: null };
type Arrival = { readonly epoch: number; readonly place: SessionPlace } | { readonly epoch: number; readonly invalid: string };
function sameSessionPin(left: SessionPlace['pin'], right: SessionPlace['pin']): boolean { return left !== null && right !== null && left.revision === right.revision && left.generationId === right.generationId; }
/**
 * The routed session page (`#/session/<id>?…`, scroll model B). The address holds the reading place and is replaced, never
 * pushed, while reading; an address that changes otherwise (an edited fragment) reopens the session at the new place.
 */
export function SessionPage({ connection, stats, user, findReads, route, router, parent, back, onSourceUnavailable, revocations }: {
  connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; findReads: SessionFindReadGate; route: Route; router: HashRouter; parent: ParentList; back: () => void;
  /** Every denial of this session's source reads (see SourceUnavailableReport). */
  onSourceUnavailable: (report: SourceUnavailableReport) => void;
  /** Signals since the page opened; one that applies clears the source into the source-unavailable state, as the page's own denials do. */
  revocations: readonly SourceRevocation[];
}) {
  const sessionId = sessionIdOf(route), [saved, setSaved] = useRouteState(SESSION_PLACES, sessionId);
  const written = useRef<string | null>(null), current = useRef<SessionPlace>(EMPTY_PLACE);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const address = formatRoute(route);
  function write(place: SessionPlace) {
    current.current = place;
    const next = sessionPlaceRoute(sessionId, place), text = formatRoute(next);
    setSaved({ ...place, find: null });
    // Only into this page's own history entry: when the reader has already left (Back before the place was written), the
    // browser's current entry is another view's, even before the router has seen the traversal, and must not be replaced.
    const entry = parseFragment(window.location.hash);
    if (entry.kind !== 'route' || entry.route.view !== 'session' || sessionIdOf(entry.route) !== sessionId || text === formatRoute(entry.route)) return;
    written.current = text; router.navigate(next, 'replace');
  }
  useLayoutEffect(() => {
    if (address === written.current) return;
    const epoch = (previous: Arrival | null) => previous === null ? 0 : previous.epoch + 1;
    let fromUrl: SessionPlace;
    try { fromUrl = sessionPlaceOf(route); } catch (cause) {
      if (!(cause instanceof InvalidSessionAddress)) throw cause;
      setArrival(previous => ({ epoch: epoch(previous), invalid: cause.message })); return;
    }
    // An address with no place, or only the pin of the last place (a list's link), returns to the last place.
    const reopened = saved !== null && fromUrl.at === null && fromUrl.find === null && fromUrl.pane === null && fromUrl.passage === null && (fromUrl.pin === null || sameSessionPin(fromUrl.pin, saved.pin));
    const place = reopened ? saved : fromUrl;
    setArrival(previous => ({ epoch: epoch(previous), place }));
    // A Find literal runs once on arrival and is not kept in the address.
    write({ ...place, find: null });
  }, [address]);
  const [preference, setPreference] = useState<SessionPane>(initialPane);
  if (arrival === null) return null;
  if ('invalid' in arrival) return <main className="session" aria-label="Session" data-view="session"><div className="page session-state"><div className="notice notice-danger" role="alert"><Icon name="alert" small={false}/><div><div className="notice-title">This session address is invalid</div>{arrival.invalid}. No source was read.<div className="notice-actions"><button type="button" className="btn btn-sm" onClick={back}>Back to {parent.label}</button></div></div></div></div></main>;
  const pane = arrival.place.pane ?? current.current.pane ?? preference;
  const page: PageIntegration = {
    back, parent, initial: { at: arrival.place.at, find: arrival.place.find, passage: arrival.place.passage },
    messageLink: (view, messageId) => `${window.location.origin}${window.location.pathname}${window.location.search}${formatRoute(sessionPlaceRoute(sessionId, { pin: { revision: view.revision, generationId: view.generationId ?? null }, at: messageId, find: null, pane: null, passage: null }))}`,
    report: update => write({ ...current.current, pin: { revision: update.view.revision, generationId: update.view.generationId ?? null }, at: update.at, passage: update.passage }),
  };
  const pin = arrival.place.pin;
  return <main className="session" aria-label="Session" data-view="session">
    <SessionView key={arrival.epoch} connection={connection} stats={stats} user={user} sessionId={sessionId} findReads={findReads}
      initialView={pin === null ? undefined : new ContentView(pin.revision, pin.generationId ?? undefined)} report={onSourceUnavailable} revocations={revocations}
      relatedHref={id => formatRoute(sessionPlaceRoute(id, EMPTY_PLACE))} pane={pane}
      setPane={value => { rememberPane(window.localStorage, value); setPreference(value); setArrival(previous => previous === null || !('place' in previous) ? previous : { ...previous, place: { ...previous.place, pane: null } }); write({ ...current.current, pane: value }); }} page={page}/>
  </main>;
}

function SessionView(props: SessionViewProps) {
  const [view, setView] = useState<ContentView | undefined>(props.initialView), [knownHead, setKnownHead] = useState<KnownHead | null>(null);
  // The place a routed page arrived with applies to the first view only; an explicitly chosen view starts at its top.
  const [initial, setInitial] = useState<PageIntegration['initial'] | null>(props.page.initial);
  const [attempt, setAttempt] = useState(0);
  // A revocation is settled once: applied (with every earlier one) or found not to concern the shown view. A Retry or another
  // chosen view then reads again.
  const settledRevocations = useRef(new Set<SourceRevocation>());
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
  function chooseView(next: ContentView | undefined) { setInitial(null); setView(next); }
  return <ConversationSnapshot key={`${contentViewKey(view)}:${attempt}`} {...props} view={view} chooseView={chooseView} resolveView={setView} retry={() => setAttempt(value => value + 1)} initial={initial} settledRevocations={settledRevocations} knownHead={knownHead !== null && sameHeadScope(knownHead, scope) ? knownHead : null} rememberHead={rememberHead}/>;
}

function roleOf(message: Message): string { return message.role.toLowerCase(); }
function roleLabel(role: string): string { return ROLE_LABELS.get(role) ?? role; }
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' });
const SPAN_TIME = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function parsedDate(value: string | undefined): Date | null { if (value === undefined) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date; }
function MessageTime({ value }: { value: string | undefined }) {
  const date = parsedDate(value);
  return date === null ? <span>time not recorded</span> : <time dateTime={value} title={date.toString()}>{TIME.format(date)}</time>;
}
function timeSpan(session: SessionInfo): string {
  const start = parsedDate(session.metadata.startedAt), end = parsedDate(session.metadata.endedAt);
  if (start === null) return 'time not recorded';
  return end === null ? SPAN_TIME.format(start) : `${SPAN_TIME.format(start)} – ${SPAN_TIME.format(end)}`;
}
function plural(count: number, noun: string): string { return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`; }
function lineCount(text: string): number { let lines = 1; for (const char of text) if (char === '\n') lines++; return lines; }
function renderedLines(text: string): number { return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / LINE_CHARACTERS)), 0); }
function firstLine(text: string): string { const line = text.split('\n', 1)[0]!; return line.length === 0 ? '(empty)' : line; }

interface MessageProps {
  message: Message; position: number; spans: readonly Span[]; reveal: number; landed: LandedSource | null; landingLabel: string;
  passages: readonly PassageInfo[]; selectPassage(passage: PassageInfo): void; link: string | null;
}
function MessageActions({ message, link, sourceText, setSourceText, highlighted }: { message: Message; link: string | null; sourceText: boolean; setSourceText(value: boolean): void; highlighted: boolean }) {
  return <span className="msg-actions">
    <CopyButton text={message.text} label="Copy message" done="Message copied" compact={true}/>
    {link !== null && <CopyButton text={link} label="Copy link to message" done="Link copied" compact={true}/>}
    <Anchored className="msg-menu" buttonClassName="btn btn-ghost btn-icon btn-sm" buttonState={undefined} label={<Icon name="more" small={true}/>} ariaLabel="More message actions" describedBy={undefined} panel="menu" panelClassName="menu" panelLabel={undefined}>
      <button type="button" role="menuitem" className="menu-item" aria-disabled={highlighted} onClick={() => { if (!highlighted) setSourceText(!sourceText); }}>{highlighted ? 'Source text (highlighted or large message)' : sourceText ? 'Formatted view' : 'Source text'}</button>
    </Anchored>
  </span>;
}
function TranscriptMessage({ message, position, spans, reveal, landed, landingLabel, passages, selectPassage, link }: MessageProps) {
  const role = roleOf(message), tool = TOOL_ROLES.has(role), prompt = PROMPT_ROLES.has(role);
  // Tool output is shown as its exact source text by default; prose is formatted.
  const [expanded, setExpanded] = useState(false), [output, setOutput] = useState(false), [sourceText, setSourceText] = useState(tool);
  useEffect(() => { if (reveal > 0) setExpanded(true); }, [reveal]);
  const own = spans.filter(span => span.messageId === message.id), forced = own.length > 0 || landed !== null || reveal > 0;
  const long = prompt ? message.text.length > PROMPT_CHARACTERS || message.text.includes('\n') : renderedLines(message.text) > FOLD_LINES, highlighted = sourceOnly(message.text, own);
  const open = expanded || forced;
  const marker = landed === null ? null : <p className="find-landing" tabIndex={-1}>{landingLabel} · message {landed.position + 1} · {message.id}</p>;
  const tech = <span className="msg-tech">{message.id}{message.parentId === undefined ? '' : ` · parent ${message.parentId}`} · Raw record #{message.recordIndex}</span>;
  const actions = <MessageActions message={message} link={link} sourceText={sourceText} setSourceText={setSourceText} highlighted={highlighted}/>;
  const anchor = { id: `message-${message.id}`, 'data-scroll-anchor': message.id, 'data-message-id': message.id, 'data-message-position': position, 'data-role': role, 'data-highlighted': own.length > 0 ? '' : undefined, 'aria-current': landed === null ? undefined : 'location' as const };
  const lines = lineCount(message.text), headOnly = lines > TOOL_HEAD_LINES && !output && !forced;
  if (tool) return <article className="tool-call" {...anchor}>
    <div className="tool-head"><button type="button" className="tool-toggle" aria-expanded={open} onClick={() => setExpanded(!open)}><span className="tool-name">{roleLabel(role)}</span><code>{firstLine(message.text)}</code><span className="tool-meta"><span>{plural(lineCount(message.text), 'line')}</span><MessageTime value={message.timestamp}/><span className="msg-n">#{position + 1}</span></span></button>{actions}</div>
    {marker}{open && <div className="tool-body">{tech}<div className={headOnly ? 'msg-fold' : undefined}><MessageContent text={message.text} spans={own} sourceText={sourceText} tool={true}/></div>
      {lines > TOOL_HEAD_LINES && !forced && <div className="row"><button type="button" className="btn btn-sm" aria-expanded={!headOnly} onClick={() => setOutput(headOnly)}>{headOnly ? `Show all ${plural(lines, 'line')}` : 'Show the head only'}</button></div>}</div>}
  </article>;
  const chips = passages.filter(item => item.start.messageId === message.id).map(item => <button type="button" className="passage-mark" key={item.id} title={item.summary} onClick={() => selectPassage(item)}><Icon name="hash" small={true}/>Passage {item.ordinal + 1}</button>);
  const folded = long && !open;
  return <article className="msg" {...anchor}>
    <div className="msg-head"><span className="msg-role">{roleLabel(role)}</span><MessageTime value={message.timestamp}/><span className="msg-n">#{position + 1}</span>{chips}{highlighted && <span className="xs">{own.length > 0 ? 'Source highlights' : 'Large message · source text'}</span>}{tech}{actions}</div>
    {marker}
    {prompt && folded ? <p className="muted msg-prompt">{roleLabel(role)} prompt · {message.text.length.toLocaleString()} characters · <button type="button" className="link-button" onClick={() => setExpanded(true)}>Show</button></p>
      : <><div className={folded ? 'msg-body msg-fold' : 'msg-body'}><MessageContent text={message.text} spans={own} sourceText={sourceText} tool={false}/></div>
        {long && !forced && <div className="msg-more row"><button type="button" className="btn btn-sm" aria-expanded={!folded} onClick={() => setExpanded(folded)}><Icon name={folded ? 'chevron-down' : 'chevron-up'} small={true}/>{folded ? 'Show full message' : 'Fold message'}</button>{folded && <span className="xs muted">{message.text.length.toLocaleString()} characters</span>}</div>}</>}
  </article>;
}
/** Messages in order, consecutive tool messages under one rule, a separator where the local day changes. */
function transcript(messages: readonly Message[], offset: number, render: (message: Message, position: number) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  let day: string | null = null, group: { key: string; items: ReactNode[] } | null = null;
  const flush = () => { if (group !== null) out.push(<div className="tool-group" data-role="tool" key={`group:${group.key}`}>{group.items}</div>); group = null; };
  messages.forEach((message, index) => {
    const date = parsedDate(message.timestamp), label = date === null ? null : DAY.format(date);
    if (label !== null && label !== day) { flush(); out.push(<div className="day-sep" key={`day:${message.id}`}>{label}</div>); day = label; }
    const node = <Fragment key={message.id}>{render(message, offset + index)}</Fragment>;
    if (TOOL_ROLES.has(roleOf(message))) { if (group === null) group = { key: message.id, items: [] }; group.items.push(node); }
    else { flush(); out.push(node); }
  });
  flush();
  return out;
}

function PositionBar({ pane, total, loading, items, goTo }: { pane: HTMLElement | null; total: number | null; loading: boolean; items: number; goTo(position: number): void }) {
  const [range, setRange] = useState<{ first: number; last: number } | null>(null), [asking, setAsking] = useState(false), [draft, setDraft] = useState('');
  const track = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (pane === null) return;
    const measure = () => {
      const bounds = pane.getBoundingClientRect();
      let first: number | null = null, last: number | null = null;
      for (const element of pane.querySelectorAll<HTMLElement>('[data-message-position]')) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= bounds.top + SOURCE_SCROLL_GAP || rect.top >= bounds.bottom - SOURCE_SCROLL_GAP) continue;
        const position = Number(element.dataset['messagePosition']);
        if (first === null) first = position;
        last = position;
      }
      setRange(previous => first === null || last === null ? null : previous !== null && previous.first === first && previous.last === last ? previous : { first, last });
    };
    measure();
    const resized = new ResizeObserver(measure); resized.observe(pane);
    pane.addEventListener('scroll', measure, { passive: true });
    return () => { resized.disconnect(); pane.removeEventListener('scroll', measure); };
  }, [pane, items]);
  useLayoutEffect(() => {
    if (track.current === null) return;
    track.current.style.setProperty('--position-fill', total === null || total === 0 || range === null ? '0%' : `${Math.max(1, Math.round((range.last + 1) / total * 100))}%`);
  }, [range, total]);
  const last = total === null ? 0 : total - 1;
  return <div className="position" role="group" aria-label="Position in the transcript">
    <span className="nowrap" role="status" aria-label="Visible messages">{total === null ? loading ? 'Loading messages…' : 'Message count unavailable' : range === null ? `${total.toLocaleString()} messages` : <>Messages <strong>{range.first + 1}–{range.last + 1}</strong> of {total.toLocaleString()}</>}</span>
    <span className="position-track" ref={track} title="Position in the whole session"><span className="position-fill"/></span>
    <button type="button" className="btn btn-sm" disabled={total === null || total === 0} onClick={() => goTo(0)}><Icon name="arrow-up" small={true}/>Start</button>
    <button type="button" className="btn btn-sm" disabled={total === null || total === 0} onClick={() => goTo(last)}><Icon name="arrow-down" small={true}/>End</button>
    {asking ? <form className="row" onSubmit={event => { event.preventDefault(); const value = Number(draft); if (Number.isInteger(value) && value >= 1 && value <= last + 1) { setAsking(false); setDraft(''); goTo(value - 1); } }}>
      <label className="sr-only" htmlFor="session-go-to">Message number</label><input id="session-go-to" className="input position-input" type="number" min={1} max={last + 1} value={draft} autoFocus onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setAsking(false); } }}/>
      <button type="submit" className="btn btn-sm">Go</button></form>
      : <button type="button" className="btn btn-sm" disabled={total === null || total === 0} onClick={() => setAsking(true)}>Go to message…</button>}
  </div>;
}

function InfoPane({ session, view, sessionId, headRevision, passages, link }: { session: SessionInfo; view: ContentView; sessionId: string; headRevision: number; passages: PassagesResult | null; link: string }) {
  const metadata = session.metadata, source = session.source;
  return <div className="info-pane">
    <section className="rail-section" aria-label="Source"><h3>Source</h3><dl className="dl dl-fixed">
      <dt>Owner</dt><dd>{session.ownerId}</dd>
      <dt>Viewing</dt><dd>source r{view.revision}</dd>
      <dt>Published</dt><dd>HEAD r{headRevision} / index {session.indexedRevision === undefined ? 'pending' : `r${session.indexedRevision}`}</dd>
      {session.indexedRevision !== undefined && session.indexedRevision < headRevision && <><dt>Indexing lag</dt><dd>{headRevision - session.indexedRevision} source revisions</dd></>}
      <dt>Annotations</dt><dd>{view.generationId === undefined ? 'Archive-only view · no annotations' : 'Published annotation generation'}</dd>
      <dt>Snapshot</dt><dd>{session.completion === 'Quiescent' ? 'Quiescent snapshot · may resume' : 'Closed source'}</dd>
      {session.redacted && <><dt>Redaction</dt><dd>Redacted before upload</dd></>}
      <dt>Collector</dt><dd className="mono">{source.collectorNamespace}</dd>
      <dt>Producer</dt><dd>{metadata.producer}</dd>
    </dl></section>
    <section className="rail-section" aria-label="Index"><h3>Index</h3><dl className="dl dl-fixed">
      <dt>Passages</dt><dd>{passages === null ? 'unavailable' : passages.format === PassageFormat.Unindexed ? 'Unindexed' : passages.total.toString()}</dd>
      <dt>Index revision</dt><dd>{session.indexedRevision === undefined ? 'pending' : `r${session.indexedRevision}`}</dd>
    </dl></section>
    <section className="rail-section" aria-label="Identifiers"><h3>Identifiers</h3><dl className="dl dl-stack">
      <dt>Archive identity</dt><dd className="mono xs">{sessionId}</dd>
      <dt>Annotation generation</dt><dd className="mono xs">{view.generationId ?? 'none · archive-only view'}</dd>
    </dl><div className="row row-wrap"><CopyButton text={sessionId} label="Copy session id" done="Session id copied" compact={false}/><CopyButton text={link} label="Copy link to this session" done="Link copied" compact={false}/></div></section>
    <section className="rail-section" aria-label="Recorded provenance"><h3>Recorded provenance</h3><dl className="dl dl-stack provenance-details">
      <dt>Source identity</dt><dd>{source.discoveryRootId} / {source.collectorNamespace} / {source.producerSessionId}</dd>
      <dt>Source format</dt><dd>{source.format}</dd>
      <dt>Recorded source model</dt><dd>{metadata.model ?? 'not recorded'}</dd>
      <dt title="Recorded source-root claim, not host or launch attestation">Recorded yolo profile</dt><dd>{recordedYoloProfile(source.discoveryRootId) ?? 'not recorded'}</dd>
      <dt>Recorded agent</dt><dd className="recorded-agent">{source.subagentId === undefined ? 'Main · no recorded subagent ID' : `Subagent · ${source.subagentId}`}</dd>
      <dt>Work directory</dt><dd className="mono">{metadata.workdir ?? 'not recorded'}</dd>
      <dt>Git remote</dt><dd className="mono">{metadata.gitRemote ?? 'not recorded'}</dd>
      <dt>Branch / commit</dt><dd className="mono">{metadata.gitBranch ?? 'not recorded'} / {metadata.gitCommit ?? 'not recorded'}</dd>
      <dt>Source dates</dt><dd>{formatDate(metadata.startedAt)} – {formatDate(metadata.endedAt)}</dd>
      <dt>Tags</dt><dd>{metadata.tags.length === 0 ? 'None' : <span className="row row-wrap">{metadata.tags.map(tag => <span className="chip" key={tag}>{tag}</span>)}</span>}</dd>
    </dl></section>
    <section className="rail-section"><h3>Per-message details</h3><p className="small muted">Message ids, parent ids and raw record numbers appear in each message header on hover or focus; its “⋯” menu switches to the exact source text.</p></section>
  </div>;
}

function ConversationSnapshot({ connection, stats, user, sessionId, relatedHref, view, chooseView, resolveView, retry, initial, settledRevocations, knownHead, rememberHead, findReads, report: reportUnavailable, revocations, pane, setPane, page }: SessionViewProps & { view: ContentView | undefined; chooseView(view: ContentView | undefined): void; resolveView(view: ContentView): void; retry(): void; initial: PageIntegration['initial'] | null; settledRevocations: RefObject<Set<SourceRevocation>>; knownHead: KnownHead | null; rememberHead: (ownerId: string, revision: number) => void }) {
  const [messageStart, setMessageStart] = useState(0), [retired, setRetired] = useState(false);
  const [passage, setPassage] = useState<PassageInfo | null>(null), [spanOffset, setSpanOffset] = useState(0);
  const [seekError, setSeekError] = useState<string | null>(null), [seeking, setSeeking] = useState(false), [revealedMessage, setRevealedMessage] = useState<string | null>(null);
  const [revealEpoch, setRevealEpoch] = useState(0), [findEpoch, setFindEpoch] = useState(0);
  const initialAttempted = useRef(false);
  // A passage restored from the address: kept (and reported) until it is selected or the whole outline shows it is gone.
  const [pendingPassage, setPendingPassage] = useState(initial === null ? null : initial.passage);
  const [landed, setLanded] = useState<LandedSource | null>(null);
  const navigation = useRef(0), currentSourceNavigation = useRef<SourceNavigation | null>(null), pendingScroll = useRef<PendingSourceScroll | null>(null);
  const [sourcePane, setSourcePane] = useState<HTMLDivElement | null>(null), [findBar, setFindBar] = useState<HTMLDivElement | null>(null), [findList, setFindList] = useState<HTMLDivElement | null>(null);
  const [findOpen, setFindOpen] = useState(initial !== null && initial.find !== null);
  // A `find=` literal runs once, in the first finder of this view.
  const arrivalFind = useRef(initial === null ? null : initial.find);
  const outlinePane = useRef<HTMLDivElement>(null), split = useRef<HTMLDivElement>(null);
  // Phones: the side pane covers the transcript below the open Find bar (session.css `--find-offset`), so both stay usable.
  useLayoutEffect(() => {
    const frame = split.current;
    if (frame === null) return;
    if (findBar === null) { frame.style.setProperty('--find-offset', '0px'); return; }
    const measure = () => frame.style.setProperty('--find-offset', `${findBar.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure); observer.observe(findBar); measure();
    return () => observer.disconnect();
  }, [findBar]);
  const retiredHeading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (retired && document.activeElement === document.body && retiredHeading.current !== null) retiredHeading.current.focus({ preventScroll: true });
  }, [retired]);
  const accessEpoch = useRef(0), accessScope = JSON.stringify([user.id, stats.activeId, stats.generation, contentViewKey(view)]), liveAccessScope = useRef(accessScope); liveAccessScope.current = accessScope;
  function retireIndexedView() { navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setPassage(null); setSpanOffset(0); setSeeking(false); setSeekError(null); setRevealedMessage(null); setFindEpoch(epoch => epoch + 1); setRetired(true); }
  function sourceUnavailable(cause: RequestFailure) {
    if (UNAVAILABLE_CODES.has(cause.code)) reportUnavailable({ sessionId, pin: view === undefined ? null : view, code: cause.code, message: cause.message });
    if (cause.code === 'indexed-view-retired') retireIndexedView();
  }
  // A failure another view saw that concerns the shown view: a retired generation retires this view; any other failure, and a
  // withdrawal, clears the source into the same notice a denied session read shows (Retry reads again).
  const [revoked, setRevoked] = useState<string | null>(null);
  useEffect(() => {
    const settled = settledRevocations.current;
    let revocation: SourceRevocation | null = null;
    for (const item of revocations) {
      if (settled.has(item)) continue;
      const affected = revocationAffects(item, view);
      if (affected === null) continue;
      settled.add(item);
      if (affected) { revocation = item; break; }
    }
    if (revocation === null) return;
    for (const item of revocations) settled.add(item);
    if (revocation.kind === 'source-failure' && revocation.code === 'indexed-view-retired') { retireIndexedView(); return; }
    accessEpoch.current++; navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null;
    setLanded(null); setPassage(null); setSpanOffset(0); setSeeking(false); setSeekError(null); setRevealedMessage(null); setFindEpoch(epoch => epoch + 1); setRevoked(revocation.message);
  }, [revocations, view]);
  async function readPinned<T>(operation: Operation, extract: (reply: Result) => T | null): Promise<T> {
    const epoch = accessEpoch.current;
    try { return await read(connection, operation, extract); }
    catch (cause) {
      if (cause instanceof RequestFailure && epoch === accessEpoch.current && liveAccessScope.current === accessScope) sourceUnavailable(cause);
      throw cause;
    }
  }
  useEffect(() => connection.onInvalidate(() => { accessEpoch.current++; navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setPassage(null); setSpanOffset(0); setRetired(false); setRevoked(null); setSeeking(false); setSeekError(null); setRevealedMessage(null); }), [connection]);
  useEffect(() => () => { accessEpoch.current++; navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; }, []);
  const session = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}`, '', true, async () => {
    const result = await readPinned(new Operation_GetSession(sessionId, view), value => value instanceof Result_Session ? value.result : null);
    if (view !== undefined) requireContentView(view, result.session.view);
    return result;
  });
  useEffect(() => { if (view === undefined && session.data !== null) resolveView(session.data.session.view); }, [view, session.data, resolveView]);
  const snapshot = view === undefined || retired || revoked !== null ? null : session.data;
  const passages = useInfiniteResource<PassageInfo, PassagesResult, number>(connection, stats, `${sessionId}:${contentViewKey(view)}`, '', snapshot !== null, undefined, async cursor => {
    const offset = cursor === undefined ? 0 : cursor;
    const result = validatePassages(await readPinned(new Operation_GetPassages(sessionId, view!, offset, PASSAGE_PAGE_SIZE), reply => reply instanceof Result_Passages ? reply.result : null), view!, offset);
    return { items: result.passages, next: result.format === PassageFormat.ContextAwareProblems && BigInt(result.offset + result.passages.length) < result.total ? result.offset + result.passages.length : undefined, previous: undefined, meta: result };
  }, item => item.id);
  const sourceSpans = useResource(connection, stats, `${sessionId}:${contentViewKey(view)}:${passage?.id ?? 'none'}:${spanOffset}`, '', snapshot !== null && passage !== null && passages.error === null, async () => validatePassageSpans(await readPinned(new Operation_GetPassageSpans(sessionId, view!, passage!.id, spanOffset, PASSAGE_PAGE_SIZE), reply => reply instanceof Result_PassageSpans ? reply.result : null), view!, passage!.id, spanOffset));
  useEffect(() => {
    if (passages.error !== null || (passage !== null && passages.meta !== null && !passages.refreshing && !passages.items.some(item => item.id === passage.id))) { setPassage(null); pendingScroll.current = null; }
  }, [passages.error, passages.items, passages.meta, passages.refreshing, passage]);
  // A routed page restores its selected passage (and its highlight) through the bounded passage pages, whether or not the
  // outline is shown; its place is `at`. An outline that ends without it (or fails) ends the restoration.
  useEffect(() => {
    if (pendingPassage === null || passages.meta === null || passages.loading || passages.refreshing) return;
    const item = passages.items.find(candidate => candidate.id === pendingPassage);
    if (item !== undefined) { setPendingPassage(null); setPassage(item); setSpanOffset(0); return; }
    if (passages.hasMore) { if (!passages.loadingMore) passages.loadMore(); return; }
    setPendingPassage(null);
  }, [pendingPassage, passages.items, passages.meta, passages.loading, passages.refreshing, passages.loadingMore, passages.hasMore]);
  useEffect(() => { if (passages.error !== null) setPendingPassage(null); }, [passages.error]);
  const messages = useInfiniteResource<Message, MessagesResult, number>(connection, stats, `${sessionId}:${contentViewKey(view)}:${messageStart}`, '', snapshot !== null, messageStart, async cursor => {
    const offset = cursor === undefined ? messageStart : cursor;
    const result = await readPinned(new Operation_GetMessages(sessionId, offset, MESSAGE_PAGE_SIZE, view), value => value instanceof Result_Messages ? value.result : null);
    requireContentView(view!, result.view);
    return { items: result.messages, next: result.offset + result.messages.length < result.total ? result.offset + result.messages.length : undefined, previous: result.offset > 0 ? Math.max(0, result.offset - MESSAGE_PAGE_SIZE) : undefined, meta: result };
  }, item => item.id);
  const related = useResource(connection, stats, sessionId, '', snapshot !== null, () => read(connection, new Operation_Related(sessionId, RELATED_LIMIT), value => value instanceof Result_Related ? value.result : null));
  const messageOffset = messages.meta === null ? 0 : messages.meta.offset;
  function messageAt(position: number): Message | undefined { return messages.meta === null ? undefined : messages.items[position - messageOffset]; }
  // Instant: a smooth scroll would be cut short by ScrollAnchor's corrections when the highlighted rows render.
  function scrollToMessage(messageId: string): boolean {
    const target = document.getElementById(`message-${messageId}`);
    if (sourcePane === null || target === null || !sourcePane.contains(target)) return false;
    const top = target.getBoundingClientRect().top - sourcePane.getBoundingClientRect().top + sourcePane.scrollTop - SOURCE_SCROLL_GAP;
    sourcePane.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
    return true;
  }
  function finishSourceScroll(pending: PendingSourceScroll & { messageId: string }) {
    if (pending.origin === 'find') setLanded(pending);
    else scrollToMessage(pending.messageId);
    pendingScroll.current = null;
  }
  useEffect(() => {
    const pending = pendingScroll.current;
    if (pending === null || pending.operation !== navigation.current) return;
    const target = pending.messageId === null ? messageAt(pending.position) : messages.items.find(item => item.id === pending.messageId);
    if (target !== undefined) finishSourceScroll({ ...pending, messageId: target.id });
  }, [messages.items, revealedMessage]);
  useLayoutEffect(() => {
    if (landed !== null && landed.operation === navigation.current && scrollToMessage(landed.messageId) && landed.focus) {
      const target = document.getElementById(`message-${landed.messageId}`);
      if (target !== null) { const marker = target.querySelector<HTMLElement>('.find-landing'); if (marker !== null) marker.focus({ preventScroll: true }); }
    }
  }, [landed]);
  useEffect(() => { if (session.error !== null || messages.error !== null) setLanded(null); }, [session.error, messages.error]);
  function supersedeFindNavigation() {
    const current = currentSourceNavigation.current;
    if (current === null || current.origin !== 'find') return;
    navigation.current++; currentSourceNavigation.current = null; pendingScroll.current = null; setLanded(null); setSeeking(false); setSeekError(null);
  }
  async function showSource(target: string | undefined, expectedPosition: number | null, origin: SourceNavigationOrigin, focus: boolean) {
    const operation = ++navigation.current; currentSourceNavigation.current = { operation, origin }; pendingScroll.current = null;
    setSeekError(null); setSeeking(false); setLanded(null);
    if (target === undefined) { setSeekError('This annotation has no verified source span; no logical extent is asserted.'); return; }
    if (origin === 'annotation' && expectedPosition === null && messages.items.some(message => message.id === target) && scrollToMessage(target)) return;
    setSeeking(true);
    try {
      const location = await readPinned(new Operation_LocateMessage(sessionId, view!, target), value => value instanceof Result_LocatedMessage ? value.result : null);
      if (navigation.current !== operation) return;
      try { requireContentView(view!, location.view); } catch (cause) { throw new UnverifiedSourceLocator(cause instanceof Error ? cause.message : 'Unverified source pin.'); }
      if (!Number.isInteger(location.position) || location.position < 0 || location.position >= location.total || (expectedPosition !== null && location.position !== expectedPosition)) throw new UnverifiedSourceLocator('The source locator returned an invalid message position.');
      const pending = { messageId: target, operation, origin, position: location.position, focus };
      if (messages.items.some(message => message.id === target)) finishSourceScroll(pending);
      else { pendingScroll.current = pending; setMessageStart(Math.floor(location.position / MESSAGE_PAGE_SIZE) * MESSAGE_PAGE_SIZE); }
    } catch (cause) { if (navigation.current === operation) { pendingScroll.current = null; setSeekError(cause instanceof Error ? cause.message : 'Source navigation failed'); if ((origin === 'find' && cause instanceof UnverifiedSourceLocator) || (cause instanceof RequestFailure && ['forbidden', 'not-found', 'unauthorized'].includes(cause.code))) setFindEpoch(epoch => epoch + 1); } }
    finally { if (navigation.current === operation) setSeeking(false); }
  }
  /** The position bar: a known position needs no locator; an unloaded one restarts the message chain at its page. */
  function goToPosition(position: number) {
    const operation = ++navigation.current; currentSourceNavigation.current = { operation, origin: 'place' };
    setSeekError(null); setSeeking(false); setLanded(null);
    const loaded = messageAt(position);
    if (loaded !== undefined) { pendingScroll.current = null; scrollToMessage(loaded.id); return; }
    pendingScroll.current = { operation, origin: 'place', messageId: null, position, focus: false };
    setMessageStart(Math.floor(position / MESSAGE_PAGE_SIZE) * MESSAGE_PAGE_SIZE);
  }
  // A layout effect: the arrival place's navigation starts before the arrival Find (`find=`, a child's passive effect) captures
  // the navigation it belongs to, so that a link's `at` and `find` together do not discard the Find result.
  useLayoutEffect(() => {
    if (initialAttempted.current || snapshot === null || view === undefined) return;
    if (initial !== null && initial.at !== null) {
      initialAttempted.current = true;
      void showSource(initial.at, null, 'place', false);
    }
  }, [snapshot, view]);
  function showPassage(selected: PassageInfo) { setPendingPassage(null); setPassage(selected); setSpanOffset(0); void showSource(selected.start.messageId, selected.start.messagePosition, 'annotation', false); }
  function revealTranscript() { if (pane !== 'closed' && window.matchMedia(PHONE_QUERY).matches) setPane('closed'); }
  function selectPassage(selected: PassageInfo) {
    showPassage(selected);
    if (pane !== 'outline' && !window.matchMedia(PHONE_QUERY).matches) setPane('outline');
  }
  // The selected outline row is scrolled into its own pane (passage chips in message headers select it).
  useEffect(() => {
    const list = outlinePane.current;
    if (passage === null || list === null) return;
    const row = list.querySelector<HTMLElement>(`[data-passage-id="${CSS.escape(passage.id)}"]`);
    if (row === null) return;
    const scroller = list.closest<HTMLElement>('.pane'), rect = row.getBoundingClientRect();
    if (scroller === null) throw new Error('Outline is not inside its pane');
    const bounds = scroller.getBoundingClientRect();
    if (rect.top < bounds.top || rect.bottom > bounds.bottom) scroller.scrollTo({ top: scroller.scrollTop + rect.top - bounds.top - SOURCE_SCROLL_GAP, behavior: 'instant' });
  }, [passage, pane]);
  const passageHighlightSpans = sourceSpans.data !== null && passage !== null ? sourceSpans.data.spans.map(span => new Span(span.messageId, span.start, span.end)) : [];
  const headRevision = snapshot === null ? undefined : Math.max(snapshot.session.revision, knownHead !== null && knownHead.ownerId === snapshot.session.ownerId ? knownHead.revision : snapshot.session.revision);
  useEffect(() => { if (snapshot !== null && headRevision !== undefined) rememberHead(snapshot.session.ownerId, headRevision); }, [snapshot, headRevision, rememberHead]);
  // The routed page keeps its reading place in the address: the pinned view, the top message after scrolling, the passage.
  const topMessage = useRef<string | null>(initial === null ? null : initial.at);
  const report = page.report;
  const reportedPassage = passage !== null ? passage.id : pendingPassage;
  useEffect(() => { if (view !== undefined && snapshot !== null) report({ view, at: topMessage.current, passage: reportedPassage }); }, [view, snapshot !== null, reportedPassage]);
  useEffect(() => {
    if (sourcePane === null || view === undefined) return;
    const settled = () => {
      const bounds = sourcePane.getBoundingClientRect();
      const top = [...sourcePane.querySelectorAll<HTMLElement>('[data-message-id]')].find(element => element.getBoundingClientRect().bottom > bounds.top + SOURCE_SCROLL_GAP);
      const at = top === undefined ? null : top.dataset['messageId']!;
      if (at === topMessage.current) return;
      topMessage.current = at; report({ view, at, passage: reportedPassage });
    };
    sourcePane.addEventListener('scrollend', settled);
    return () => sourcePane.removeEventListener('scrollend', settled);
  }, [report, sourcePane, view, reportedPassage]);
  // `/` opens Find on the routed page, as in the mockup; Escape inside the bar closes it.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || !(event.target instanceof HTMLElement) || event.target.closest('input,textarea,select,[contenteditable="true"]') !== null) return;
      event.preventDefault(); setFindOpen(true);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { if (snapshot !== null && messages.error === null) arrivalFind.current = null; });
  const title = snapshot === null ? 'Session' : snapshot.session.metadata.title || 'Untitled conversation';
  const loading = !retired && revoked === null && (session.loading || (snapshot === null && session.error === null));
  const rail = pane === 'closed' ? null : pane;
  // The side pane toggle reopens the tab it showed last.
  const lastRail = useRef<Exclude<SessionPane, 'closed'>>(rail ?? 'outline'); if (rail !== null) lastRail.current = rail;
  const chip = snapshot === null || view === undefined || headRevision === undefined ? null
    : view.generationId === undefined ? { tone: 'chip', text: `Archive-only · source r${view.revision}` }
    : view.revision < headRevision ? { tone: 'chip chip-warn', text: `Source r${view.revision} · HEAD r${headRevision}` }
    : snapshot.session.indexedRevision === undefined ? { tone: 'chip', text: `Source r${view.revision} · index pending` }
    : { tone: 'chip chip-ok', text: 'Indexed · latest' };
  const head = <header className="session-head">
    <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" title="Back to the list you came from" onClick={page.back}><Icon name="arrow-left" small={false}/></button>
    <div className="grow session-heading">
      {loading ? <><span className="skeleton sk-60" aria-hidden="true"/><span className="skeleton sk-30" aria-hidden="true"/><h1 className="sr-only">{title}</h1></> : <h1 className="session-title" title={title}>{title}</h1>}
      {snapshot !== null && view !== undefined && headRevision !== undefined && <div className="session-meta">
        <a href={page.parent.href}>{page.parent.label}</a><span className="sep">{snapshot.session.metadata.producer}</span><span className="sep">{snapshot.session.metadata.project ?? 'No project'}</span>{snapshot.session.metadata.gitBranch !== undefined && <span className="sep mono">{snapshot.session.metadata.gitBranch}</span>}<span className="sep">{timeSpan(snapshot.session)}</span>
        {messages.meta !== null && <span className="sep hide-md">{messages.meta.total.toLocaleString()} messages</span>}
        {chip !== null && <span className={`${chip.tone} hide-md`} title={`Viewing source r${view.revision} · HEAD r${headRevision} / index ${snapshot.session.indexedRevision === undefined ? 'pending' : `r${snapshot.session.indexedRevision}`} (details in Info)`}>{chip.text}</span>}
      </div>}
    </div>
    {snapshot !== null && <>
      <button type="button" className="btn" aria-pressed={findOpen} onClick={() => setFindOpen(!findOpen)}><Icon name="search" small={false}/>Find<span className="kbd hide-md" aria-hidden="true">/</span></button>
      <button type="button" className="btn" aria-pressed={rail !== null} onClick={() => setPane(rail === null ? lastRail.current : 'closed')}><Icon name="panel" small={false}/>Side pane</button>
      <Anchored className="session-menu" buttonClassName="btn btn-icon" buttonState={undefined} label={<Icon name="more" small={false}/>} ariaLabel="More session actions" describedBy={undefined} panel="menu" panelClassName="menu" panelLabel={undefined}>
        <button type="button" role="menuitem" className="menu-item" title="Read the source snapshot again with the default view" onClick={() => chooseView(undefined)}><Icon name="refresh" small={false}/>Recheck source</button>
        {headRevision !== undefined && view !== undefined && (view.revision !== headRevision || view.generationId !== undefined) && <button type="button" role="menuitem" className="menu-item" title="Latest archived revision, without annotations" onClick={() => chooseView(new ContentView(headRevision, undefined))}><Icon name="arrow-up" small={false}/>Go to latest archive</button>}
        <div className="menu-sep" role="separator"/>
        <button type="button" role="menuitem" className="menu-item" onClick={() => setPane('info')}><Icon name="info" small={false}/>Provenance and metadata</button>
      </Anchored>
    </>}
  </header>;
  if (retired) return <>{head}<div className="page session-state"><section className="notice notice-warn" role="region" aria-label="Indexed view unavailable"><div><h3 className="notice-title" ref={retiredHeading} tabIndex={-1}>Indexed view unavailable</h3><p>This indexed view is unavailable because its derived generation was retired.</p>{view !== undefined && <div className="notice-actions"><button type="button" className="btn btn-sm" onClick={() => chooseView(new ContentView(view.revision, undefined))}>View archived source r{view.revision}</button></div>}<p className="xs">This explicitly requests the same source revision without a generation. No HEAD or published view is selected automatically.</p></div></section></div></>;
  const unreadable = session.error !== null ? session.error : revoked;
  if (unreadable !== null) return <>{head}<div className="page session-state"><div className="notice notice-danger" role="alert"><Icon name="alert" small={false}/><div><div className="notice-title">This session can no longer be read</div>{unreadable}. Source content has been cleared.<div className="notice-actions"><button type="button" className="btn btn-sm" onClick={page.back}>Back to {page.parent.label}</button><button type="button" className="btn btn-sm btn-ghost" onClick={retry}>Retry</button></div></div></div></div></>;
  const outline = <div className="outline-pane" ref={outlinePane}>
    <div className="rail-search"><span className="grow" role="status">{passages.loading ? 'Loading passage metadata…' : passages.meta === null ? 'Passages' : passages.meta.format === PassageFormat.Unindexed ? 'Unindexed · no published passages for this source view.' : passages.meta.total === 0n ? 'No problems classified in this published context-aware generation.' : `Passages in transcript order · ${passages.meta.total.toString()}`}</span>{passages.updateAvailable && <button type="button" className="btn btn-sm" onClick={passages.applyUpdates}>Updated problem passages available</button>}</div>
    {passages.error !== null && <div className="notice" role="status"><div><p>Problem metadata unavailable. Original source remains readable; no legacy annotation fallback is used.</p><ErrorNotice>{passages.error}</ErrorNotice></div></div>}
    {passages.meta?.format === PassageFormat.ContextAwareProblems && <><div className="outline-list" role="list" aria-label="Passages">{passages.items.map(item => <div role="listitem" key={item.id}>
      <button type="button" className="outline-item" data-scroll-anchor={item.id} data-passage-id={item.id} aria-current={passage?.id === item.id ? 'true' : undefined} onClick={() => { showPassage(item); revealTranscript(); }}><span className="outline-n" aria-hidden="true">{item.ordinal + 1}</span><span className="outline-title">{item.summary || 'Problem passage'}</span><span className="outline-sub">{item.tags.map(tag => <span className="chip" key={tag}>{tag}</span>)}<span className={item.tags.length === 0 ? '' : 'sep'}>message {item.start.messagePosition + 1}</span></span></button>
      {passage !== null && passage.id === item.id && <section className="passage-span-details" aria-label="Selected passage source spans"><p className="xs muted">Start #{item.start.messagePosition} {item.start.messageId} byte {item.start.byteOffset} · End #{item.end.messagePosition} {item.end.messageId} byte {item.end.byteOffset}<br/>{item.sourceBytes.toString()} source bytes · {item.spanCount.toString()} spans · {item.pieceCount.toString()} retrieval pieces · UTF-8 bytes, end exclusive; highlighting covers this span page only.</p>{sourceSpans.loading && <p className="xs" role="status">Reading source span page…</p>}{sourceSpans.error !== null && <ErrorNotice>{sourceSpans.error}</ErrorNotice>}<ol start={spanOffset + 1}>{sourceSpans.data?.spans.map((span, index) => <li key={`${span.messageId}:${span.start}:${index}`}><button type="button" className="link-button" onClick={() => void showSource(span.messageId, span.messagePosition, 'annotation', false)}>#{span.messagePosition} {span.messageId} · UTF-8 bytes [{span.start}, {span.end})</button></li>)}</ol><div className="row"><button type="button" className="btn btn-sm" disabled={spanOffset === 0 || sourceSpans.loading} onClick={() => setSpanOffset(n => Math.max(0, n - PASSAGE_PAGE_SIZE))}>Previous span page</button><button type="button" className="btn btn-sm" disabled={sourceSpans.data === null || sourceSpans.loading || BigInt(spanOffset + sourceSpans.data.spans.length) >= sourceSpans.data.total} onClick={() => setSpanOffset(n => n + PASSAGE_PAGE_SIZE)}>Next span page</button><span className="xs muted">{sourceSpans.data === null ? 'Span count unavailable' : `${spanOffset + 1}–${spanOffset + sourceSpans.data.spans.length} / ${sourceSpans.data.total.toString()} source spans`}</span></div></section>}
    </div>)}</div>
    <InfiniteTrigger enabled={passages.hasMore && passages.error === null} loading={passages.loadingMore || passages.refreshing} load={passages.loadMore} label="Loading more problem passages…"/>
    {passages.meta.total > 0n && !passages.hasMore && <p className="list-end">End of outline · {passages.meta.total.toString()} passages</p>}</>}
  </div>;
  const relatedList = <div className="related-pane">
    <div className="rail-search"><span className="grow">Related conversations</span></div>
    {related.error !== null && <ErrorNotice>{related.error}</ErrorNotice>}{related.loading && <p className="rail-note" role="status">Resolving related conversations…</p>}
    {related.data !== null && related.data.sessions.length === 0 && <p className="rail-note">No related conversations available.</p>}
    {related.data !== null && related.data.sessions.length > 0 && <ul className="related-list" aria-label="Related conversations">{related.data.sessions.map((hit, index) => <li key={hit.session.id}>{relatedLink(hit.session, index)}</li>)}</ul>}
  </div>;
  function relatedLink(target: SessionInfo, index: number) {
    const content = <><span className="outline-n" aria-hidden="true">{index + 1}</span><span className="outline-title">{target.metadata.title || 'Untitled conversation'}</span><span className="outline-sub">{target.metadata.project ?? 'No project'}<span className="sep">{formatDate(target.metadata.startedAt)}</span></span></>;
    return <a className="outline-item" href={relatedHref(target.id)}>{content}</a>;
  }
  const rows = transcript(messages.items, messageOffset, (message, position) => <TranscriptMessage message={message} position={position} spans={passageHighlightSpans} reveal={message.id === revealedMessage ? revealEpoch : 0} landed={landed !== null && landed.messageId === message.id ? landed : null} landingLabel="Find result" passages={passages.items} selectPassage={selectPassage} link={view === undefined ? null : page.messageLink(view, message.id)}/>);
  return <>{head}
    <div className="split" ref={split} data-rail={rail === null ? 'closed' : 'open'}>
      <section className="pane-main" aria-label="Transcript">
        {findOpen && snapshot !== null && <div className="findbar-slot" ref={setFindBar}/>}
        <div className="pane" ref={setSourcePane} tabIndex={-1} data-pane="transcript">
          <ScrollAnchor><div className="session-transcript" data-scroll-container aria-busy={loading || messages.loading || messages.refreshing}>
            {loading && <div className="transcript-skeleton"><p className="sr-only" role="status">Rechecking source access…</p>{['user', 'assistant', 'tool', 'assistant'].map((role, index) => <div className="msg" data-role={role} key={index} aria-hidden="true"><span className="skeleton sk-30"/><span className="skeleton"/><span className="skeleton sk-60"/></div>)}</div>}
            <p className="xs source-navigation-status" role="status" aria-label="Source navigation status" aria-live="polite" aria-atomic="true">{landed === null || view === undefined ? '' : `Found matching message ${landed.position + 1} · ${landed.messageId} in selected source r${view.revision}.`}</p>
            {seekError !== null && <ErrorNotice>{seekError}</ErrorNotice>}{seeking && <p className="xs" role="status">Locating the original message…</p>}
            <InfiniteTrigger enabled={messages.hasPrevious && messages.error === null} loading={messages.loadingPrevious || messages.refreshing} load={messages.loadPrevious} label="Loading earlier messages…"/>
            {messages.error !== null && <ErrorNotice>{messages.error}. Message content has been cleared.</ErrorNotice>}{messages.loading && <div className="session-loading" role="status">Loading original messages…</div>}
            {rows}
            {messages.meta?.total === 0 && <p className="list-end">No messages in this source revision.</p>}
            <InfiniteTrigger enabled={messages.hasMore && messages.error === null} loading={messages.loadingMore || messages.refreshing} load={messages.loadMore} label="Loading later messages…"/>
            {messages.meta !== null && messages.meta.total > 0 && !messages.hasMore && !messages.loading && <p className="list-end">End of session · {messages.meta.total.toLocaleString()} messages</p>}
          </div></ScrollAnchor>
        </div>
        <PositionBar pane={sourcePane} total={messages.meta === null ? null : messages.meta.total} loading={loading || messages.loading} items={messages.items.length} goTo={goToPosition}/>
      </section>
      {rail !== null && <aside className="pane-rail" aria-label="Session side pane">
        <div className="rail-tabs tabs" role="tablist" aria-label="Side pane">{SIDE_TABS.map(tab => <button type="button" role="tab" className="tab" key={tab.pane} id={`session-tab-${tab.pane}`} aria-selected={rail === tab.pane} aria-controls="session-side-panel" onClick={() => { setPane(tab.pane); if (tab.pane === 'find') setFindOpen(true); }}>{tab.label}{tab.pane === 'outline' && passages.meta !== null && passages.meta.total > 0n && <span className="count">{passages.meta.total.toString()}</span>}{tab.pane === 'related' && related.data !== null && <span className="count">{related.data.sessions.length}</span>}</button>)}</div>
        <div className="pane" id="session-side-panel" role="tabpanel" aria-labelledby={`session-tab-${rail}`} data-pane="rail"><ScrollAnchor><div data-scroll-container>
          {rail === 'outline' && outline}
          {rail === 'find' && <div ref={setFindList}/>}
          {rail === 'related' && relatedList}
          {rail === 'info' && (snapshot !== null && view !== undefined && headRevision !== undefined ? <InfoPane session={snapshot.session} view={view} sessionId={sessionId} headRevision={headRevision} passages={passages.meta} link={window.location.href}/> : <p className="rail-note" role="status">Rechecking source access…</p>)}
        </div></ScrollAnchor></div>
      </aside>}
    </div>
    {snapshot !== null && messages.error === null && <SessionFind key={JSON.stringify([user.id, stats.generation, stats.activeId, sessionId, contentViewKey(view), findEpoch])} connection={connection} stats={stats} ownerId={user.id} sessionId={sessionId} view={view!} navigation={navigation} reads={findReads}
      initialLiteral={arrivalFind.current} bar={findBar} list={findList} open={() => setFindOpen(true)} close={() => setFindOpen(false)}
      sourceUnavailable={sourceUnavailable} supersedeSourceNavigation={supersedeFindNavigation} select={(hit, choice: FindChoice) => { setRevealedMessage(hit.messageId); setRevealEpoch(epoch => epoch + 1); if (choice === 'list') revealTranscript(); void showSource(hit.messageId, hit.position, 'find', choice === 'list'); }}/>}
  </>;
}
