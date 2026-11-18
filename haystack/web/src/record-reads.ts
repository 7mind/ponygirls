// The record page's reads (Record.tsx) as one state machine; the page performs its effects and feeds the outcomes back.
//
// - Record lane: one read of the record at a time, bounded by RECORD_READ_TIMEOUT_MS; a request made while one is in
//   flight is read once more after it. A record is applied only at or above its confirmed-revision floor
//   (edit-drafts.ts); below it the record is read again, at most FLOOR_READS answers in a row, then the page offers Retry.
// - Ancillary reads (history, incoming links) start when a record is applied and never hold the lane; an answer is applied
//   only while the page still shows the key and revision it was started for (`shows`).
// - A change announced while the editor is open is remembered and read once when the editor closes, however it closes.
// - Every answer carries the key and request it belongs to; one for a record the page has left, or for a read the lane
//   gave up, is discarded.
//
// State: lane idle | reading(request, queued, below); key (null: left); shown revision (null: none yet); editing;
// invalidated. "read" below means: idle → reading(next request, not queued, below 0) with effect get; reading → queued.
//
// | Event               | Condition                                       | Transition                                | Effects            |
// |---------------------|-------------------------------------------------|-------------------------------------------|--------------------|
// | entered(key)        |                                                 | at key, nothing shown, not editing; read  | get                |
// | left                |                                                 | key null, lane idle                       | —                  |
// | requested           | at a key                                        | read                                      | get or none        |
// | announced           | editing                                         | invalidated                               | —                  |
// | announced           | not editing                                     | read                                      | get or none        |
// | floor(f)            | not editing, idle, shown < f                    | read                                      | get                |
// | editor-opened       |                                                 | editing                                   | —                  |
// | editor-closed(f)    | editing                                         | not editing, not invalidated; read if it  | get or none        |
// |                     |                                                 | was invalidated or shown < f              |                    |
// | answered(r, item)   | not the lane's request r at the key             | unchanged                                 | —                  |
// | answered(r, item)   | revision < floor, below + 1 < FLOOR_READS       | reading(next request, below + 1)          | get                |
// | answered(r, item)   | revision < floor, otherwise                     | idle                                      | fail(below-floor)  |
// | answered(r, item)   | revision ≥ floor                                | shown = revision; queued ? read : idle    | apply, ancillary,  |
// |                     |                                                 |                                           | get if queued      |
// | failed(r, error)    | the lane's request r at the key                 | idle                                      | fail(error)        |
// | timed-out(r)        | the lane's request r at the key                 | idle                                      | abort(r), fail     |
// | offered(item)       | at a key, revision ≥ floor                      | shown = revision                          | apply, ancillary   |
import type { Item } from "./api.ts";

/** Answers in a row below the record's confirmed-revision floor before the page stops and offers Retry. */
export const FLOOR_READS = 3;
/** How long one read of the record may take before the page stops waiting and offers Retry. */
export const RECORD_READ_TIMEOUT_MS = 15_000;

export type Lane =
  | { readonly kind: "idle" }
  /** `queued`: a request arrived meanwhile; `below`: answers below the floor so far. */
  | { readonly kind: "reading"; readonly request: number; readonly queued: boolean; readonly below: number };

export interface Reads {
  /** The record the page is at; null once it has left. */
  readonly key: string | null;
  readonly lane: Lane;
  /** The revision applied to the page; null before the first. */
  readonly shown: number | null;
  readonly editing: boolean;
  /** A change was announced while the editor was open: the record is read when it closes. */
  readonly invalidated: boolean;
  /** Record reads issued so far, across every key: request numbers are never reused. */
  readonly issued: number;
}

export type ReadEvent =
  | { readonly kind: "entered"; readonly key: string }
  | { readonly kind: "left" }
  | { readonly kind: "requested" }
  | { readonly kind: "announced" }
  | { readonly kind: "floor"; readonly floor: number }
  | { readonly kind: "editor-opened" }
  | { readonly kind: "editor-closed"; readonly floor: number }
  | { readonly kind: "answered"; readonly key: string; readonly request: number; readonly item: Item; readonly floor: number }
  | { readonly kind: "failed"; readonly key: string; readonly request: number; readonly error: unknown }
  | { readonly kind: "timed-out"; readonly key: string; readonly request: number }
  | { readonly kind: "offered"; readonly item: Item; readonly floor: number };

/** Why a read of the record ended without a record. */
export type ReadFailure =
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "below-floor"; readonly floor: number };

export type ReadEffect =
  | { readonly kind: "get"; readonly key: string; readonly request: number }
  | { readonly kind: "abort"; readonly request: number }
  | { readonly kind: "apply"; readonly item: Item }
  /** History and incoming links of `key` as of `item`, the record just applied. */
  | { readonly kind: "ancillary"; readonly key: string; readonly item: Item }
  /** `initial`: no record was shown yet. */
  | { readonly kind: "fail"; readonly failure: ReadFailure; readonly initial: boolean };

export interface Step { readonly state: Reads; readonly effects: readonly ReadEffect[] }

/** No record yet. */
export const NOWHERE: Reads = { key: null, lane: { kind: "idle" }, shown: null, editing: false, invalidated: false, issued: 0 };

/** The page shows `key` at `revision`: an ancillary answer started for them still applies. */
export const shows = (state: Reads, key: string, revision: number): boolean => state.key === key && state.shown === revision;

const IDLE: Lane = { kind: "idle" };
const unchanged = (state: Reads): Step => ({ state, effects: [] });

type At = Reads & { readonly key: string };
type Reading = Extract<Lane, { kind: "reading" }>;

/** One more read of the record: a new one, or once more after the one in flight. */
function read(state: Reads): Step {
  if (state.key === null) return unchanged(state);
  if (state.lane.kind === "reading") return unchanged({ ...state, lane: { ...state.lane, queued: true } });
  return next({ ...state, key: state.key }, 0, []);
}

/** A new read of the record, after `effects`. */
function next(state: At, below: number, effects: readonly ReadEffect[]): Step {
  const request = state.issued + 1;
  return { state: { ...state, issued: request, lane: { kind: "reading", request, queued: false, below } },
    effects: [...effects, { kind: "get", key: state.key, request }] };
}

/** `item` is applied to the page at `state.key`, and its ancillary reads start. */
function applied(state: At, item: Item): Step {
  return { state: { ...state, shown: item.revision }, effects: [{ kind: "apply", item }, { kind: "ancillary", key: state.key, item }] };
}

/** The answer belongs to the lane's read in flight at the page's key. */
const current = (state: Reads, key: string, request: number): state is At & { readonly lane: Reading } =>
  state.key === key && state.lane.kind === "reading" && state.lane.request === request;

export function step(state: Reads, event: ReadEvent): Step {
  switch (event.kind) {
    case "entered":
      return read({ ...NOWHERE, key: event.key, issued: state.issued });
    case "left":
      return unchanged({ ...state, key: null, lane: IDLE });
    case "requested":
      return read(state);
    case "announced":
      return state.editing ? unchanged({ ...state, invalidated: true }) : read(state);
    case "floor":
      return !state.editing && state.lane.kind === "idle" && state.shown !== null && state.shown < event.floor ? read(state) : unchanged(state);
    case "editor-opened":
      return unchanged({ ...state, editing: true });
    case "editor-closed": {
      if (!state.editing) return unchanged(state);
      const closed = { ...state, editing: false, invalidated: false };
      return state.invalidated || (state.shown !== null && state.shown < event.floor) ? read(closed) : unchanged(closed);
    }
    case "answered": {
      if (!current(state, event.key, event.request)) return unchanged(state);
      const { lane } = state;
      if (event.item.revision < event.floor) {
        if (lane.below + 1 < FLOOR_READS) return next(state, lane.below + 1, []);
        return { state: { ...state, lane: IDLE }, effects: [{ kind: "fail", failure: { kind: "below-floor", floor: event.floor }, initial: state.shown === null }] };
      }
      const shown = applied({ ...state, lane: IDLE }, event.item);
      return lane.queued ? next({ ...shown.state, key: state.key }, 0, shown.effects) : shown;
    }
    case "failed":
      if (!current(state, event.key, event.request)) return unchanged(state);
      return { state: { ...state, lane: IDLE }, effects: [{ kind: "fail", failure: { kind: "error", error: event.error }, initial: state.shown === null }] };
    case "timed-out":
      if (!current(state, event.key, event.request)) return unchanged(state);
      return { state: { ...state, lane: IDLE },
        effects: [{ kind: "abort", request: event.request }, { kind: "fail", failure: { kind: "timeout" }, initial: state.shown === null }] };
    case "offered":
      return state.key !== null && event.item.revision >= event.floor ? applied({ ...state, key: state.key }, event.item) : unchanged(state);
  }
}
