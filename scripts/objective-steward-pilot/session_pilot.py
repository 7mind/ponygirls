"""One persistent graph, automatically revised at successive session boundaries."""
from dataclasses import asdict, dataclass, replace
import uuid

from profile import Rejected, canonical, choice, decode, fields, items, positive, text
from session_profile import Event, Graph, Snapshot, parse_events, parse_graph
from store import MAX_STATE_BYTES, Store

MAX_CHECKPOINTS = 16

@dataclass(frozen=True)
class Publication:
    checkpoint: str
    event_count: int
    graph: Graph

@dataclass(frozen=True)
class Attempt:
    checkpoint: str
    event_count: int
    input_digest: str
    previous_digest: str
    outcome: str
    error: str | None

@dataclass(frozen=True)
class Ticket:
    token: str
    snapshot: Snapshot

@dataclass(frozen=True)
class State:
    session: str
    events: tuple[Event, ...]
    publications: tuple[Publication, ...]
    attempts: tuple[Attempt, ...]
    lease: Ticket | None


def encode(state: State):
    return canonical(asdict(state))


def decode_state(raw: bytes) -> State:
    row = fields(decode(raw, MAX_STATE_BYTES), {"session", "events", "publications", "attempts", "lease"})
    session = text(row["session"])
    events = parse_events(row["events"])
    previous = Graph((), ())
    publications = []
    for raw in items(row["publications"], MAX_CHECKPOINTS):
        item = fields(raw, {"checkpoint", "event_count", "graph"})
        count = positive(item["event_count"])
        if count > len(events) or (publications and count < publications[-1].event_count):
            raise Rejected("publication event position")
        graph = parse_graph(item["graph"], events[:count], previous)
        publications.append(Publication(text(item["checkpoint"]), count, graph))
        previous = graph
    attempts = []
    for raw in items(row["attempts"], MAX_CHECKPOINTS):
        item = fields(raw, {"checkpoint", "event_count", "input_digest", "previous_digest", "outcome", "error"})
        count = positive(item["event_count"])
        if count > len(events):
            raise Rejected("attempt event position")
        attempts.append(Attempt(text(item["checkpoint"]), count, text(item["input_digest"]), text(item["previous_digest"]), choice(item["outcome"], ("inflight", "published", "failed")), None if item["error"] is None else text(item["error"])))
    if len({item.checkpoint for item in attempts}) != len(attempts):
        raise Rejected("duplicate checkpoint attempt")
    lease = None
    if row["lease"] is not None:
        item = fields(row["lease"], {"token", "snapshot"})
        snapshot = fields(item["snapshot"], {"session", "checkpoint", "events", "previous"})
        prefix = parse_events(snapshot["events"])
        if snapshot["session"] != session or events[:len(prefix)] != prefix:
            raise Rejected("lease source prefix")
        prior = parse_graph(snapshot["previous"], prefix, Graph((), ()))
        lease = Ticket(text(item["token"]), Snapshot(session, text(snapshot["checkpoint"]), prefix, prior))
    return State(session, events, tuple(publications), tuple(attempts), lease)


class SessionPilot:
    def __init__(self, store: Store):
        self.store = store

    def _load(self):
        value = self.store.read()
        if value.payload is None:
            raise Rejected("session not initialized")
        return value.revision, decode_state(value.payload)

    def _save(self, revision: int, state: State):
        if len(state.attempts) > MAX_CHECKPOINTS:
            raise Rejected("checkpoint bound")
        self.store.commit(revision, encode(state))

    def initialize(self, session: str):
        value = self.store.read()
        if value.payload is not None:
            raise Rejected("already initialized")
        self._save(value.revision, State(text(session), (), (), (), None))

    def append(self, events: tuple[Event, ...]):
        version, state = self._load()
        known = {item.id: item for item in state.events}
        result = list(state.events)
        for event in events:
            if event.id in known:
                if known[event.id] != event:
                    raise Rejected("immutable source event")
            else:
                known[event.id] = event
                result.append(event)
        parsed = parse_events([asdict(item) for item in result])
        if parsed != state.events:
            self._save(version, replace(state, events=parsed))

    def begin(self, checkpoint: str) -> Ticket:
        version, state = self._load()
        checkpoint = text(checkpoint)
        if state.lease is not None:
            raise Rejected("busy or undrained")
        if not state.events or any(item.checkpoint == checkpoint for item in state.attempts):
            raise Rejected("empty or repeated checkpoint")
        previous = state.publications[-1].graph if state.publications else Graph((), ())
        snapshot = Snapshot(state.session, checkpoint, state.events, previous)
        ticket = Ticket(str(uuid.uuid4()), snapshot)
        attempt = Attempt(checkpoint, len(state.events), snapshot.fingerprint(), previous.fingerprint(), "inflight", None)
        self._save(version, replace(state, lease=ticket, attempts=(*state.attempts, attempt)))
        return ticket

    def _owned(self, state: State, ticket: Ticket):
        if state.lease != ticket:
            raise Rejected("stale lease")

    def publish(self, ticket: Ticket, value: object):
        graph = parse_graph(value, ticket.snapshot.events, ticket.snapshot.previous)
        version, state = self._load()
        self._owned(state, ticket)
        attempt = state.attempts[-1]
        if attempt.outcome != "inflight" or state.events != ticket.snapshot.events:
            raise Rejected("stale or terminal review")
        previous = state.publications[-1].graph if state.publications else Graph((), ())
        if previous != ticket.snapshot.previous:
            raise Rejected("changed graph head")
        publication = Publication(ticket.snapshot.checkpoint, len(state.events), graph)
        self._save(version, replace(state, publications=(*state.publications, publication), attempts=(*state.attempts[:-1], replace(attempt, outcome="published"))))

    def fail(self, ticket: Ticket, category: str):
        version, state = self._load()
        self._owned(state, ticket)
        attempt = state.attempts[-1]
        if attempt.outcome != "inflight":
            raise Rejected("terminal checkpoint")
        self._save(version, replace(state, attempts=(*state.attempts[:-1], replace(attempt, outcome="failed", error=text(category)))))

    def drained(self, ticket: Ticket):
        version, state = self._load()
        self._owned(state, ticket)
        if state.attempts[-1].outcome == "inflight":
            raise Rejected("checkpoint result not recorded")
        self._save(version, replace(state, lease=None))

    def view(self):
        _, state = self._load()
        publication = state.publications[-1] if state.publications else None
        graph = Graph((), ()) if publication is None else publication.graph
        through = 0 if publication is None else publication.event_count
        return {"session": state.session, "events": [asdict(item) for item in state.events], "graph": graph.wire(),
                "last_valid_through": through, "current_prefix": len(state.events),
                "coverage": "reviewed-prefix-not-semantic-completeness" if through == len(state.events) and publication is not None else "unreviewed-or-failed-prefix",
                "attempts": [asdict(item) for item in state.attempts],
                "inflight_marker": state.lease is not None, "marker_meaning": "persisted phase, not process-liveness proof",
                "meaning": "revisable ontology/intent tags, not editing source Human intent or granting execution authority"}

    def history(self):
        _, state = self._load()
        return [{"checkpoint": item.checkpoint, "event_count": item.event_count, "graph": item.graph.wire()} for item in state.publications]
