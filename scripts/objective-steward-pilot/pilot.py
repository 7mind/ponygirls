"""Isolated append-only interpretation layer and bounded background review loop."""
import asyncio
from dataclasses import asdict, dataclass, replace
import json
from typing import Protocol
import uuid

from profile import Input, Rejected, Result, canonical, choice, decode, digest, fields, items, parse_input, parse_result, positive, text
from store import MAX_STATE_BYTES, Store

MAX_HISTORY = 64
MAX_PASSES = 16

@dataclass(frozen=True)
class Lease:
    id: str
    input_index: int
    phase: str

@dataclass(frozen=True)
class Job:
    id: str
    input_index: int
    snapshot: Input

@dataclass(frozen=True)
class Publication:
    id: str
    input_index: int
    result: Result

@dataclass(frozen=True)
class Delivery:
    issue: str
    kind: str

@dataclass(frozen=True)
class State:
    inputs: tuple[Input, ...]
    publications: tuple[Publication, ...]
    deliveries: tuple[Delivery, ...]
    lease: Lease | None
    error: str | None


def encode_state(state: State) -> bytes:
    return canonical(asdict(state))


def decode_state(raw: bytes) -> State:
    row = fields(decode(raw, MAX_STATE_BYTES), {"inputs", "publications", "deliveries", "lease", "error"})
    inputs = tuple(parse_input(value) for value in items(row["inputs"], MAX_HISTORY))
    if not inputs:
        raise Rejected("empty input history")
    publications = []
    for value in items(row["publications"], MAX_HISTORY):
        item = fields(value, {"id", "input_index", "result"})
        index = positive(item["input_index"]) - 1
        if index >= len(inputs):
            raise Rejected("invalid publication input")
        publications.append(Publication(text(item["id"]), index + 1, parse_result(item["result"], inputs[index])))
    deliveries = []
    for value in items(row["deliveries"], MAX_HISTORY * 16):
        item = fields(value, {"issue", "kind"})
        deliveries.append(Delivery(text(item["issue"]), choice(item["kind"], ("accepted", "acknowledged"))))
    lease = None
    if row["lease"] is not None:
        item = fields(row["lease"], {"id", "input_index", "phase"})
        index = positive(item["input_index"])
        if index > len(inputs):
            raise Rejected("invalid lease input")
        lease = Lease(text(item["id"]), index, choice(item["phase"], ("running", "published", "draining", "failed")))
    return State(inputs, tuple(publications), tuple(deliveries), lease, None if row["error"] is None else text(row["error"]))


class Pilot:
    def __init__(self, store: Store):
        self.store = store

    def _load(self) -> tuple[int, State]:
        record = self.store.read()
        if record.payload is None:
            raise Rejected("not-initialized")
        return record.revision, decode_state(record.payload)

    def _save(self, revision: int, state: State) -> None:
        if len(state.inputs) > MAX_HISTORY or len(state.publications) > MAX_HISTORY or len(state.deliveries) > MAX_HISTORY * 16:
            raise Rejected("history-bound")
        self.store.commit(revision, encode_state(state))

    def initialize(self, snapshot: Input) -> None:
        record = self.store.read()
        if record.payload is not None:
            raise Rejected("already-initialized")
        self._save(record.revision, State((snapshot,), (), (), None, None))

    def update(self, snapshot: Input) -> None:
        version, state = self._load()
        previous = state.inputs[-1]
        if snapshot.scope.root != previous.scope.root:
            raise Rejected("foreign-root")
        old_context = (previous.scope.session, previous.scope.branch)
        new_context = (snapshot.scope.session, snapshot.scope.branch)
        if snapshot.scope.epoch < previous.scope.epoch or (old_context != new_context and snapshot.scope.epoch <= previous.scope.epoch):
            raise Rejected("invalid-context-epoch")
        for historical in state.inputs:
            if historical.scope.session == snapshot.scope.session:
                old_sources = {item.id: item for item in historical.sources}
                for source in snapshot.sources:
                    if source.id in old_sources and source != old_sources[source.id]:
                        raise Rejected("source-identity-collision")
            if (historical.scope.session, historical.scope.branch) == new_context:
                for name in ("objectives", "claims"):
                    old_records = {item.id: item for item in getattr(historical, name)}
                    for item in getattr(snapshot, name):
                        old = old_records.get(item.id)
                        if old is not None and (item.revision < old.revision or (item.revision == old.revision and item != old)):
                            raise Rejected("record-revision-collision")
        if snapshot == previous:
            return
        self._save(version, replace(state, inputs=(*state.inputs, snapshot)))

    def begin(self) -> Job:
        version, state = self._load()
        if state.lease is not None:
            raise Rejected("busy-or-undrained")
        lease = Lease(str(uuid.uuid4()), len(state.inputs), "running")
        self._save(version, replace(state, lease=lease, error=None))
        return Job(lease.id, lease.input_index, state.inputs[-1])

    def _lease(self, state: State, job: Job) -> Lease:
        lease = state.lease
        if lease is None or lease.id != job.id or lease.input_index != job.input_index or state.inputs[job.input_index - 1] != job.snapshot:
            raise Rejected("stale-lease")
        return lease

    def publish(self, job: Job, output: object) -> str:
        result = parse_result(output, job.snapshot)
        version, state = self._load()
        for publication in state.publications:
            if publication.id == job.id:
                if publication.result != result or publication.input_index != job.input_index:
                    raise Rejected("idempotency-conflict")
                return publication.id
        lease = self._lease(state, job)
        if lease.phase != "running" or state.inputs[-1] != job.snapshot:
            raise Rejected("stale-input-or-cancelled")
        publication = Publication(job.id, job.input_index, result)
        self._save(version, replace(state, publications=(*state.publications, publication), lease=replace(lease, phase="published"), error=None))
        return publication.id

    def fail(self, job: Job, category: str) -> None:
        version, state = self._load()
        lease = self._lease(state, job)
        self._save(version, replace(state, lease=replace(lease, phase="failed"), error=text(category)))

    def cancel(self, job: Job) -> None:
        version, state = self._load()
        lease = self._lease(state, job)
        self._save(version, replace(state, lease=replace(lease, phase="draining"), error="cancelled"))

    def drained(self, job: Job) -> None:
        version, state = self._load()
        self._lease(state, job)
        self._save(version, replace(state, lease=None))

    def history(self) -> list[dict[str, object]]:
        _, state = self._load()
        return [{"id": item.id, "actor": "steward", "input": state.inputs[item.input_index - 1].wire(), "result": json.loads(canonical(asdict(item.result)))} for item in state.publications]

    def view(self) -> dict[str, object]:
        _, state = self._load()
        snapshot = state.inputs[-1]
        current = next((item for item in reversed(state.publications) if state.inputs[item.input_index - 1] == snapshot), None)
        review = None if current is None else json.loads(canonical(asdict(current.result)))
        issues = []
        if current is not None:
            for category, rows in (("assessment", current.result.assessments), ("proposal", current.result.proposals)):
                for item in rows:
                    if category == "assessment" and item.verdict == "supported":
                        continue
                    identity = digest({"scope": asdict(snapshot.scope), "input": snapshot.fingerprint(), "category": category, "body": asdict(item)})
                    states = {event.kind for event in state.deliveries if event.issue == identity}
                    issues.append({"id": identity, "category": category, "body": json.loads(canonical(asdict(item))), "delivery_accepted": "accepted" in states, "acknowledged": "acknowledged" in states})
        coverage = ("unreviewed" if not state.publications else "pending") if current is None else ("partial-window" if snapshot.gaps else "reviewed-window")
        return {"input": snapshot.wire(), "human_acceptance": "not-recorded", "review": review,
                "review_actor": "steward", "coverage": coverage, "semantic_completeness": "not-established",
                "activity": "idle" if state.lease is None else state.lease.phase, "activity_basis": "persisted phase, not process-liveness proof", "error": state.error,
                "issues": issues, "input_versions": len(state.inputs), "publications": len(state.publications)}

    def feedback(self, active_boundary: bool) -> list[dict[str, object]]:
        if not active_boundary:
            return []
        return [item for item in self.view()["issues"] if not item["delivery_accepted"] and not item["acknowledged"]]

    def _delivery(self, issue: str, kind: str) -> None:
        version, state = self._load()
        if issue not in {item["id"] for item in self.view()["issues"]}:
            raise Rejected("unknown-or-stale-issue")
        event = Delivery(issue, kind)
        if event not in state.deliveries:
            self._save(version, replace(state, deliveries=(*state.deliveries, event)))

    def accept_delivery(self, issue: str) -> None:
        self._delivery(issue, "accepted")

    def acknowledge(self, issue: str) -> None:
        self._delivery(issue, "acknowledged")


class Worker(Protocol):
    async def review(self, snapshot: Input) -> bytes: ...


class Controller:
    def __init__(self, pilot: Pilot, worker: Worker):
        self.pilot = pilot
        self.worker = worker
        self.task: asyncio.Task | None = None
        self.pending = False
        self.closed = False
        self.current: Job | None = None

    def request(self) -> None:
        if self.closed:
            raise Rejected("controller-closed")
        self.pending = True
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        passes = 0
        while self.pending and not self.closed:
            if passes >= MAX_PASSES:
                raise Rejected("pass-bound-exhausted")
            passes += 1
            self.pending = False
            job = self.pilot.begin()
            self.current = job
            try:
                raw = await self.worker.review(job.snapshot)
                if self.closed:
                    raise Rejected("controller-closed")
                self.pilot.publish(job, decode(raw, 32768))
            except asyncio.CancelledError:
                self.pilot.fail(job, "interrupted")
                raise
            except Exception as error:
                self.pilot.fail(job, str(error) if isinstance(error, Rejected) else type(error).__name__)
            finally:
                self.pilot.drained(job)
                self.current = None

    async def wait_idle(self) -> None:
        if self.task is not None:
            await self.task

    async def close(self) -> None:
        self.closed = True
        self.pending = False
        if self.current is not None:
            self.pilot.cancel(self.current)
        await self.wait_idle()


def render(view: dict[str, object]) -> str:
    # JSON quoting keeps untrusted terminal controls inert and preserves attribution.
    quote = lambda value: json.dumps(value, ensure_ascii=False)
    snapshot = view["input"]
    lines = ["OBJECTIVES -- read-only pilot; no automatic execution",
             f"Context: {quote(snapshot['scope'])}",
             f"Operational goal: {quote(snapshot['operational_goal'])} (not fulfillment verification)",
             f"Coverage: {view['coverage']}; activity: {view['activity']} ({view['activity_basis']}); semantic completeness: not-established",
             f"Human acceptance: {view['human_acceptance']}"]
    review = view["review"]
    if review is not None:
        for interpretation in review["objectives"]:
            lines.append(f"Steward account [{interpretation['basis']}, not adopted]: {quote(interpretation['text'])}; sources {quote(interpretation['sources'])}")
    assessments = {} if review is None else {item["claim"]["id"]: item for item in review["assessments"]}
    for objective in snapshot["objectives"]:
        lines.append(f"\nTracked interpretation {quote(objective['id'])}@{objective['revision']}: {quote(objective['text'])}")
        lines.append(f"  Criteria: {quote(objective['criteria'])}; sources: {quote(objective['sources'])}")
        for claim in snapshot["claims"]:
            if claim["objective"]["id"] != objective["id"]:
                continue
            lines.append(f"  Worker {quote(claim['id'])}@{claim['revision']}: {claim['conclusion']} -- {quote(claim['text'])}")
            assessment = assessments.get(claim["id"])
            lines.append("  Steward: pending" if assessment is None else f"  Steward: {assessment['verdict']} -- {quote(assessment['reason'])}; sources {quote(assessment['sources'])}")
    lines.append(f"\nNotes: {0 if review is None else len(review['notes'])}; proposed corrections: {0 if review is None else len(review['proposals'])}")
    lines.append("Use view --details for full typed notes, proposals, source text and issue IDs; --history for old scoped records.")
    if view["error"] is not None:
        lines.append("Fault: " + quote(view["error"]))
    if snapshot["gaps"]:
        lines.append("Coverage gaps: " + quote(snapshot["gaps"]))
    return "\n".join(lines) + "\n"
