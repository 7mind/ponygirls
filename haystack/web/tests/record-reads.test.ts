// The record page's reads as one state machine (record-reads.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { FLOOR_READS, Flights, NOWHERE, RECORD_READ_TIMEOUT_MS, shows, step, type ReadEffect, type ReadEvent, type Reads } from "../src/record-reads.ts";
import type { Item } from "../src/api.ts";

const KEY = "p:a";
const item = (revision: number, key = KEY) => ({ key, revision }) as Item;
/** Runs `events` from `state`; returns the final state and every effect, by kind and request/revision. */
function run(state: Reads, ...events: ReadEvent[]): { state: Reads; effects: string[] } {
  const effects: string[] = [];
  const name = (effect: ReadEffect): string => effect.kind === "get" || effect.kind === "abort" ? `${effect.kind} ${effect.request}` :
    effect.kind === "apply" || effect.kind === "ancillary" ? `${effect.kind} ${effect.item.revision}` : `fail ${effect.failure.kind}`;
  for (const event of events) { const next = step(state, event); state = next.state; effects.push(...next.effects.map(name)); }
  return { state, effects };
}

test("the record lane: one read at a time and one follow-up; below the floor a bounded re-read; a timeout gives the read up; late answers are discarded", () => {
  const entered = run(NOWHERE, { kind: "entered", key: KEY }, { kind: "requested" }, { kind: "announced" });
  assert.deepEqual(entered.effects, ["get 1"], "requests while a read is in flight coalesce");
  const answered = run(entered.state, { kind: "answered", key: KEY, request: 1, item: item(1), floor: 0 });
  assert.deepEqual(answered.effects, ["apply 1", "ancillary 1", "get 2"], "exactly one follow-up read");
  const below = run(answered.state, ...Array.from({ length: FLOOR_READS }, (_, i) => ({ kind: "answered", key: KEY, request: 2 + i, item: item(1), floor: 2 }) as const));
  assert.deepEqual(below.effects, ["get 3", "get 4", "fail below-floor"]);
  assert.equal(below.state.lane.kind, "idle");
  const timedOut = run(below.state, { kind: "requested" }, { kind: "timed-out", key: KEY, request: 5 }, { kind: "answered", key: KEY, request: 5, item: item(2), floor: 2 });
  assert.deepEqual(timedOut.effects, ["get 5", "abort 5", "fail timeout"], "the late answer of a read given up is discarded");
  const left = run(timedOut.state, { kind: "requested" }, { kind: "left" }, { kind: "entered", key: "p:b" },
    { kind: "answered", key: KEY, request: 6, item: item(2), floor: 0 }, { kind: "failed", key: KEY, request: 6, error: new Error("late") });
  assert.deepEqual(left.effects, ["get 6", "abort 6", "get 7"], "leaving gives the read up; its late answers are discarded");
});

test("ancillary answers apply only at their key and revision; a change announced while the editor is open is read once when it closes", () => {
  const shown = run(NOWHERE, { kind: "entered", key: KEY }, { kind: "answered", key: KEY, request: 1, item: item(1), floor: 0 }).state;
  assert.deepEqual([shows(shown, KEY, 1), shows(shown, KEY, 2), shows(shown, "p:b", 1)], [true, false, false]);
  const editing = run(shown, { kind: "editor-opened" }, { kind: "announced" }, { kind: "announced" }, { kind: "floor", floor: 2 });
  assert.deepEqual(editing.effects, [], "nothing is read under the editor");
  const closed = run(editing.state, { kind: "editor-closed", floor: 0 }, { kind: "editor-closed", floor: 0 });
  assert.deepEqual(closed.effects, ["get 2"]);
  assert.equal(closed.state.invalidated, false);
  const offered = run(closed.state, { kind: "offered", item: item(1), floor: 2 }, { kind: "offered", item: item(3), floor: 2 });
  assert.deepEqual(offered.effects, ["apply 3", "ancillary 3"], "an offered record below the floor is not applied");
  assert.equal(shows(offered.state, KEY, 1), false);
});

test("a result never replaces a newer one already applied: an older answer releases the lane and honours queued work", () => {
  const shown = run(NOWHERE, { kind: "entered", key: KEY }, { kind: "answered", key: KEY, request: 1, item: item(1), floor: 0 }).state;
  // A refresh in flight; the editor's conflicting save then offers revision 3; the refresh answers with revision 2.
  const stale = run(shown, { kind: "requested" }, { kind: "offered", item: item(3), floor: 0 }, { kind: "answered", key: KEY, request: 2, item: item(2), floor: 0 },
    { kind: "offered", item: item(2), floor: 0 });
  assert.deepEqual(stale.effects, ["get 2", "apply 3", "ancillary 3"]);
  assert.deepEqual([stale.state.shown, stale.state.lane.kind], [3, "idle"]);
  const queued = run(shown, { kind: "requested" }, { kind: "offered", item: item(3), floor: 0 }, { kind: "announced" },
    { kind: "answered", key: KEY, request: 2, item: item(2), floor: 0 });
  assert.deepEqual(queued.effects, ["get 2", "apply 3", "ancillary 3", "get 3"], "the request made meanwhile is still read");
  assert.equal(queued.state.shown, 3);
});

test("a read in flight keeps one timer until it settles or is given up; giving it up aborts its request", () => {
  const active = new Map<number, number>();
  let handles = 0;
  const flights = new Flights({ set: (_run, ms) => { active.set(++handles, ms); return handles; }, clear: (handle) => { active.delete(handle); } });
  flights.start(1, () => {});
  const given = flights.start(2, () => {});
  assert.deepEqual([...active.values()], [RECORD_READ_TIMEOUT_MS, RECORD_READ_TIMEOUT_MS]);
  flights.settled(1);
  flights.abort(2);
  assert.deepEqual([active.size, flights.size, given.aborted], [0, 0, true]);
  flights.settled(2);
  assert.throws(() => flights.abort(2), /not in flight/);
});
