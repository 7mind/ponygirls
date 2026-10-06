#!/usr/bin/env python3
"""ponygirls-bg-tasks supervisor.

One process per active Pi extension activation. It owns the session sidecar
lock, the durable task registry, one PTY and POSIX process group per task, and
completion outbox state. It talks to the extension over private
newline-delimited JSON pipes (stdin: requests, stdout: replies and hints).
Diagnostics go to stderr. Linux only.
"""
from __future__ import annotations

import argparse
import base64
import ctypes
import dataclasses
import datetime
import errno
import fcntl
import json
import os
import secrets
import selectors
import signal
import struct
import sys
import termios
import time
import traceback
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

PROTOCOL_VERSION = 1
REGISTRY_SCHEMA = "ponygirls-bg-tasks/registry"
REGISTRY_VERSION = 1

START_TIMEOUT_MS = 3000
TERM_GRACE_MS = 5000
KILL_WAIT_MS = 2000
OUTPUT_DRAIN_MS = 1000
OWNER_HANDOFF_WAIT_MS = 10000
LOG_SYNC_INTERVAL_MS = 1000
MAX_READ_BYTES = 32768
MAX_LIST_ITEMS = 50
# Deviation from the plan's constant list (documented in README): after root
# exit, a group member still running this long is a surviving descendant. It
# absorbs the kernel's hangup delivery to children of an exiting session leader.
DESCENDANT_GRACE_MS = 1000
CLOSING_POLL_MS = 50
FINAL_FLUSH_MS = 1000
LOCK_RETRY_MS = 50
MAX_LABEL_CHARS = 200
MAX_COMMAND_BYTES = 65536
MAX_REQUEST_LINE_BYTES = 1 << 20
PTY_ROWS = 40
PTY_COLS = 120
PTY_READ_CHUNK = 65536
DIR_MODE = 0o700
FILE_MODE = 0o600
EXEC_FAILURE_STATUS = 127
PR_SET_CHILD_SUBREAPER = 36

SUPPORTED_SIGNALS = {
    "SIGINT": signal.SIGINT,
    "SIGTERM": signal.SIGTERM,
    "SIGKILL": signal.SIGKILL,
    "SIGHUP": signal.SIGHUP,
    "SIGUSR1": signal.SIGUSR1,
    "SIGUSR2": signal.SIGUSR2,
    "SIGSTOP": signal.SIGSTOP,
    "SIGCONT": signal.SIGCONT,
}

STATE_RUNNING = "running"
STATE_COMPLETED = "completed"
STATE_FAILED = "failed"
STATE_DEAD = "dead"
TERMINAL_STATES = (STATE_COMPLETED, STATE_FAILED, STATE_DEAD)
PHASES = ("starting", "running", "closing", "stopping")
NOTICE_PENDING = "pending"
NOTICE_RECEIVED = "received"
NOTICE_INLINE = "inline"
NOTICE_STATUSES = (NOTICE_PENDING, NOTICE_RECEIVED, NOTICE_INLINE)
REASONS = (
    "exit", "exit_nonzero", "signaled", "terminated", "launch_failed", "descendants_remaining",
    "output_failed", "output_drain_timeout", "session_shutdown", "owner_lost", "supervisor_lost",
    "cleanup_unconfirmed",
)
SHUTDOWN_REASONS = ("quit", "reload", "new", "resume", "fork")


class DomainError(Exception):
    def __init__(self, code: str, message: str, task: Optional["TaskRecord"] = None):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.task = task


class StorageError(DomainError):
    def __init__(self, message: str):
        super().__init__("STORAGE_FAILED", message)


def now_iso(clock: "Clock") -> str:
    return datetime.datetime.fromtimestamp(clock.wall(), datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Clock(Protocol):
    def monotonic(self) -> float: ...
    def wall(self) -> float: ...


class SystemClock:
    def monotonic(self) -> float:
        return time.monotonic()

    def wall(self) -> float:
        return time.time()


# --------------------------------------------------------------------------
# Domain records
# --------------------------------------------------------------------------

def _req(obj: dict, key: str, kinds: tuple, nullable: bool = False):
    if key not in obj:
        raise ValueError(f"missing field {key}")
    value = obj[key]
    if value is None and nullable:
        return None
    if isinstance(value, bool) and bool not in kinds:
        raise ValueError(f"field {key} has wrong type")
    if not isinstance(value, kinds):
        raise ValueError(f"field {key} has wrong type")
    return value


@dataclass(frozen=True)
class ExitEvidence:
    kind: str  # "code" | "signal"
    code: Optional[int]
    signal: Optional[str]

    def to_json(self) -> dict:
        if self.kind == "code":
            return {"kind": "code", "code": self.code}
        return {"kind": "signal", "signal": self.signal}

    @staticmethod
    def from_json(obj) -> Optional["ExitEvidence"]:
        if obj is None:
            return None
        if not isinstance(obj, dict):
            raise ValueError("exit evidence must be an object")
        kind = _req(obj, "kind", (str,))
        if kind == "code":
            return ExitEvidence("code", _req(obj, "code", (int,)), None)
        if kind == "signal":
            return ExitEvidence("signal", None, _req(obj, "signal", (str,)))
        raise ValueError("unknown exit evidence kind")

    @staticmethod
    def from_waitid(info) -> "ExitEvidence":
        if info.si_code == os.CLD_EXITED:
            return ExitEvidence("code", info.si_status, None)
        try:
            name = signal.Signals(info.si_status).name
        except ValueError:
            name = f"SIG{info.si_status}"
        return ExitEvidence("signal", None, name)


@dataclass(frozen=True)
class NoticeEvent:
    id: str
    status: str

    def to_json(self) -> dict:
        return {"id": self.id, "status": self.status}

    @staticmethod
    def from_json(obj) -> Optional["NoticeEvent"]:
        if obj is None:
            return None
        if not isinstance(obj, dict):
            raise ValueError("event must be an object")
        status = _req(obj, "status", (str,))
        if status not in NOTICE_STATUSES:
            raise ValueError("unknown notice status")
        return NoticeEvent(_req(obj, "id", (str,)), status)


@dataclass
class TaskRecord:
    id: str
    seq: int
    session_id: str
    label: str
    command: str
    cwd: str
    created_at: str
    started_at: Optional[str]
    ended_at: Optional[str]
    activation: str
    state: str
    phase: Optional[str]
    revision: int
    exit: Optional[ExitEvidence]
    reason: Optional[str]
    reason_detail: Optional[str]
    log_path: str
    log_bytes: int
    notify: bool
    event: Optional[NoticeEvent]
    pid: Optional[int]
    pgid: Optional[int]
    interrupted_activation: Optional[str]
    clearing: bool
    cleanup_unconfirmed: bool

    def finalized(self) -> bool:
        return self.state in TERMINAL_STATES

    def to_json(self) -> dict:
        return {
            "id": self.id, "seq": self.seq, "sessionId": self.session_id, "label": self.label,
            "command": self.command, "cwd": self.cwd, "createdAt": self.created_at,
            "startedAt": self.started_at, "endedAt": self.ended_at, "activation": self.activation,
            "state": self.state, "phase": self.phase, "revision": self.revision,
            "exit": self.exit.to_json() if self.exit else None, "reason": self.reason,
            "reasonDetail": self.reason_detail, "logPath": self.log_path, "logBytes": self.log_bytes,
            "notify": self.notify, "event": self.event.to_json() if self.event else None,
            "pid": self.pid, "pgid": self.pgid, "interruptedActivation": self.interrupted_activation,
            "clearing": self.clearing, "cleanupUnconfirmed": self.cleanup_unconfirmed,
        }

    @staticmethod
    def from_json(obj) -> "TaskRecord":
        if not isinstance(obj, dict):
            raise ValueError("task record must be an object")
        record = TaskRecord(
            id=_req(obj, "id", (str,)), seq=_req(obj, "seq", (int,)), session_id=_req(obj, "sessionId", (str,)),
            label=_req(obj, "label", (str,)), command=_req(obj, "command", (str,)), cwd=_req(obj, "cwd", (str,)),
            created_at=_req(obj, "createdAt", (str,)), started_at=_req(obj, "startedAt", (str,), True),
            ended_at=_req(obj, "endedAt", (str,), True), activation=_req(obj, "activation", (str,)),
            state=_req(obj, "state", (str,)), phase=_req(obj, "phase", (str,), True),
            revision=_req(obj, "revision", (int,)), exit=ExitEvidence.from_json(_req(obj, "exit", (dict,), True)),
            reason=_req(obj, "reason", (str,), True), reason_detail=_req(obj, "reasonDetail", (str,), True),
            log_path=_req(obj, "logPath", (str,)), log_bytes=_req(obj, "logBytes", (int,)),
            notify=_req(obj, "notify", (bool,)), event=NoticeEvent.from_json(_req(obj, "event", (dict,), True)),
            pid=_req(obj, "pid", (int,), True), pgid=_req(obj, "pgid", (int,), True),
            interrupted_activation=_req(obj, "interruptedActivation", (str,), True),
            clearing=_req(obj, "clearing", (bool,)), cleanup_unconfirmed=_req(obj, "cleanupUnconfirmed", (bool,)),
        )
        if record.state not in (STATE_RUNNING,) + TERMINAL_STATES:
            raise ValueError(f"unknown state {record.state}")
        if record.finalized() != (record.phase is None):
            raise ValueError("phase must be null exactly for finalized records")
        if record.phase is not None and record.phase not in PHASES:
            raise ValueError(f"unknown phase {record.phase}")
        if record.reason is not None and record.reason not in REASONS:
            raise ValueError(f"unknown reason {record.reason}")
        if record.finalized() and (record.event is None or record.reason is None):
            raise ValueError("finalized records carry a reason and an event")
        if record.state == STATE_COMPLETED and (record.exit is None or record.exit.kind != "code" or record.exit.code != 0):
            raise ValueError("completed requires observed exit code 0")
        if record.clearing and not record.finalized():
            raise ValueError("only finalized records can be clearing")
        return record


@dataclass
class Registry:
    session_id: str
    next_seq: int
    revision: int
    tasks: dict  # task id -> TaskRecord, insertion in seq order

    def to_json(self) -> dict:
        return {
            "schema": REGISTRY_SCHEMA, "version": REGISTRY_VERSION, "sessionId": self.session_id,
            "nextSeq": self.next_seq, "revision": self.revision,
            "tasks": [t.to_json() for t in sorted(self.tasks.values(), key=lambda t: t.seq)],
        }

    @staticmethod
    def from_json(obj, session_id: str) -> "Registry":
        if not isinstance(obj, dict):
            raise DomainError("STORE_CORRUPT", "registry is not an object")
        if obj.get("schema") != REGISTRY_SCHEMA or obj.get("version") != REGISTRY_VERSION:
            raise DomainError("UNSUPPORTED_SCHEMA", f"unsupported registry schema {obj.get('schema')!r} version {obj.get('version')!r}")
        try:
            sid = _req(obj, "sessionId", (str,))
            next_seq = _req(obj, "nextSeq", (int,))
            revision = _req(obj, "revision", (int,))
            raw_tasks = _req(obj, "tasks", (list,))
            tasks = {}
            for raw in raw_tasks:
                record = TaskRecord.from_json(raw)
                if record.id in tasks or record.seq >= next_seq or record.session_id != sid:
                    raise ValueError(f"inconsistent task {record.id}")
                tasks[record.id] = record
        except ValueError as e:
            raise DomainError("STORE_CORRUPT", str(e)) from e
        if sid != session_id:
            raise DomainError("STORE_CORRUPT", f"registry belongs to session {sid}, not {session_id}")
        return Registry(sid, next_seq, revision, tasks)


# --------------------------------------------------------------------------
# State transitions (single authority)
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Outcome:
    state: str
    reason: str
    detail: Optional[str]


def decide_outcome(exit_evidence: Optional[ExitEvidence], *, shutdown: Optional[str], shutdown_detail: Optional[str],
                   terminate_requested: bool, output_failed: bool, descendants_remaining: bool,
                   drain_timed_out: bool, cleanup_confirmed: bool) -> Outcome:
    """Terminal outcome for an execution whose leader, group, and output were observed."""
    if not cleanup_confirmed:
        return Outcome(STATE_DEAD, "cleanup_unconfirmed", shutdown_detail)
    if shutdown == "owner_lost":
        return Outcome(STATE_DEAD, "owner_lost", shutdown_detail)
    if shutdown == "graceful":
        return Outcome(STATE_FAILED, "session_shutdown", shutdown_detail)
    if terminate_requested:
        return Outcome(STATE_FAILED, "terminated", None)
    if output_failed:
        return Outcome(STATE_FAILED, "output_failed", None)
    if descendants_remaining:
        return Outcome(STATE_FAILED, "descendants_remaining", None)
    if drain_timed_out:
        return Outcome(STATE_FAILED, "output_drain_timeout", None)
    if exit_evidence is None:
        raise AssertionError("an observed execution outcome requires exit evidence")
    if exit_evidence.kind == "code":
        return Outcome(STATE_COMPLETED, "exit", None) if exit_evidence.code == 0 else Outcome(STATE_FAILED, "exit_nonzero", None)
    return Outcome(STATE_FAILED, "signaled", None)


def apply_terminal(record: TaskRecord, outcome: Outcome, exit_evidence: Optional[ExitEvidence], ended_at: str,
                   log_bytes: int, notice_status: str) -> None:
    if record.finalized():
        raise AssertionError(f"task {record.id} is already finalized")
    if outcome.state == STATE_COMPLETED and (exit_evidence is None or exit_evidence.kind != "code" or exit_evidence.code != 0):
        raise AssertionError("completed requires observed exit code 0")
    record.revision += 1
    record.state = outcome.state
    record.phase = None
    record.reason = outcome.reason
    record.reason_detail = outcome.detail
    record.exit = exit_evidence if exit_evidence is not None else record.exit
    record.ended_at = ended_at
    record.log_bytes = log_bytes
    record.cleanup_unconfirmed = outcome.reason == "cleanup_unconfirmed"
    record.event = NoticeEvent(f"{record.id}:{record.revision}", notice_status)


def reconcile_unfinished(record: TaskRecord, ended_at: str) -> bool:
    """Recovery: an unfinished record of a released activation becomes dead."""
    if record.finalized():
        return False
    record.interrupted_activation = record.activation
    apply_terminal(record, Outcome(STATE_DEAD, "supervisor_lost", record.phase), record.exit, ended_at,
                   record.log_bytes, NOTICE_PENDING)
    return True


# --------------------------------------------------------------------------
# Filesystem boundary and durable store
# --------------------------------------------------------------------------

class FsOps:
    """The filesystem operations whose ordering defines durability."""

    def mkdir(self, path: str) -> None:
        os.mkdir(path, DIR_MODE)

    def open_new(self, path: str, flags: int) -> int:
        return os.open(path, flags | os.O_CLOEXEC, FILE_MODE)

    def write(self, fd: int, data: bytes) -> None:
        view = memoryview(data)
        while view:
            n = os.write(fd, view)
            view = view[n:]

    def fsync(self, fd: int) -> None:
        os.fsync(fd)

    def fsync_dir(self, path: str) -> None:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def close(self, fd: int) -> None:
        os.close(fd)

    def rename(self, src: str, dst: str) -> None:
        os.rename(src, dst)

    def unlink(self, path: str) -> None:
        os.unlink(path)

    def rmdir(self, path: str) -> None:
        os.rmdir(path)


class LogHandle(Protocol):
    def write(self, data: bytes) -> None: ...
    def sync(self) -> None: ...
    def close(self) -> None: ...


class TaskStore(Protocol):
    def init_layout(self) -> None: ...
    def load_registry(self) -> Optional[dict]: ...
    def commit_registry(self, data: dict) -> None: ...
    def create_log(self, task_id: str) -> LogHandle: ...
    def remove_task_artifacts(self, task_id: str) -> None: ...
    def read_log(self, task_id: str, offset: int, limit: int) -> tuple: ...
    def log_size(self, task_id: str) -> int: ...


class FileLogHandle:
    def __init__(self, fs: FsOps, fd: int):
        self.fs = fs
        self.fd = fd

    def write(self, data: bytes) -> None:
        self.fs.write(self.fd, data)

    def sync(self) -> None:
        self.fs.fsync(self.fd)

    def close(self) -> None:
        self.fs.close(self.fd)


class FileTaskStore:
    """Sidecar layout: owner.lock, tasks.json, tasks/<id>/terminal.log, clearing/<id>/."""

    def __init__(self, root: str, fs: FsOps):
        self.root = root
        self.fs = fs
        self.tasks_dir = os.path.join(root, "tasks")
        self.clearing_dir = os.path.join(root, "clearing")
        self.registry_path = os.path.join(root, "tasks.json")
        self.registry_tmp = os.path.join(root, "tasks.json.tmp")

    def log_rel(self, task_id: str) -> str:
        return f"tasks/{task_id}/terminal.log"

    def init_layout(self) -> None:
        # Entries are synced on every start: a crash after an earlier mkdir must
        # not leave an unsynced name that later starts would skip.
        if not os.path.isdir(self.root):
            self.fs.mkdir(self.root)
        self.fs.fsync_dir(os.path.dirname(self.root))
        for d in (self.tasks_dir, self.clearing_dir):
            if not os.path.isdir(d):
                self.fs.mkdir(d)
        self.fs.fsync_dir(self.root)

    def load_registry(self) -> Optional[dict]:
        try:
            with open(self.registry_path, "rb") as f:
                raw = f.read()
        except FileNotFoundError:
            return None
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise DomainError("STORE_CORRUPT", f"tasks.json is not valid JSON: {e}") from e

    def commit_registry(self, data: dict) -> None:
        payload = (json.dumps(data, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
        try:
            fd = self.fs.open_new(self.registry_tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC)
            try:
                self.fs.write(fd, payload)
                self.fs.fsync(fd)
            finally:
                self.fs.close(fd)
            self.fs.rename(self.registry_tmp, self.registry_path)
            self.fs.fsync_dir(self.root)
        except OSError as e:
            raise StorageError(f"registry commit failed: {e}") from e

    def create_log(self, task_id: str) -> LogHandle:
        task_dir = os.path.join(self.tasks_dir, task_id)
        try:
            self.fs.mkdir(task_dir)
            fd = self.fs.open_new(os.path.join(task_dir, "terminal.log"), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_APPEND)
            try:
                self.fs.fsync(fd)
                self.fs.fsync_dir(task_dir)
                self.fs.fsync_dir(self.tasks_dir)
            except OSError:
                self.fs.close(fd)
                raise
        except OSError as e:
            raise StorageError(f"task artifact creation failed: {e}") from e
        return FileLogHandle(self.fs, fd)

    def remove_task_artifacts(self, task_id: str) -> None:
        src = os.path.join(self.tasks_dir, task_id)
        dst = os.path.join(self.clearing_dir, task_id)
        try:
            if os.path.isdir(src):
                if os.path.isdir(dst):
                    self._delete_dir(dst)
                self.fs.rename(src, dst)
                self.fs.fsync_dir(self.tasks_dir)
                self.fs.fsync_dir(self.clearing_dir)
            if os.path.isdir(dst):
                self._delete_dir(dst)
        except OSError as e:
            raise DomainError("CLEAR_FAILED", f"deleting artifacts of {task_id} failed: {e}") from e

    def _delete_dir(self, path: str) -> None:
        for name in sorted(os.listdir(path)):
            self.fs.unlink(os.path.join(path, name))
        self.fs.fsync_dir(path)
        self.fs.rmdir(path)
        self.fs.fsync_dir(self.clearing_dir)

    def _log_path(self, task_id: str) -> str:
        return os.path.join(self.tasks_dir, task_id, "terminal.log")

    def read_log(self, task_id: str, offset: int, limit: int) -> tuple:
        try:
            with open(self._log_path(task_id), "rb") as f:
                size = os.fstat(f.fileno()).st_size
                if offset > size:
                    raise DomainError("OFFSET_OUT_OF_RANGE", f"offset {offset} exceeds log size {size}")
                f.seek(offset)
                return f.read(limit), size
        except FileNotFoundError as e:
            raise DomainError("ARTIFACT_MISSING", f"terminal log of {task_id} is missing") from e
        except OSError as e:
            raise DomainError("ARTIFACT_UNREADABLE", f"terminal log of {task_id} cannot be read: {e}") from e

    def log_size(self, task_id: str) -> int:
        try:
            return os.stat(self._log_path(task_id)).st_size
        except FileNotFoundError as e:
            raise DomainError("ARTIFACT_MISSING", f"terminal log of {task_id} is missing") from e


class OwnerLock:
    """Exclusive, non-blocking flock on a stable inode that is never replaced."""

    def __init__(self, root: str, fs: FsOps):
        self.path = os.path.join(root, "owner.lock")
        self.root = root
        self.fs = fs
        self.fd: Optional[int] = None

    def acquire(self, wait_ms: int, clock: Clock) -> None:
        existed = os.path.exists(self.path)
        fd = self.fs.open_new(self.path, os.O_RDWR | os.O_CREAT)
        if not existed:
            self.fs.fsync(fd)
            self.fs.fsync_dir(self.root)
        deadline = clock.monotonic() + wait_ms / 1000
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.fd = fd
                return
            except BlockingIOError:
                if clock.monotonic() >= deadline:
                    os.close(fd)
                    raise DomainError("SESSION_BUSY", "another live supervisor owns this session's background tasks")
                time.sleep(LOCK_RETRY_MS / 1000)

    def release(self) -> None:
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


# --------------------------------------------------------------------------
# Registry service (durable mutations, recovery, clear transaction)
# --------------------------------------------------------------------------

class TaskRegistry:
    def __init__(self, store: TaskStore, session_id: str, clock: Clock):
        self.store = store
        self.session_id = session_id
        self.clock = clock
        self.state: Optional[Registry] = None

    def open(self) -> list:
        """Load, finish committed clears, reconcile unfinished records. Returns recovered task ids."""
        self.store.init_layout()
        raw = self.store.load_registry()
        if raw is None:
            self.state = Registry(self.session_id, 1, 0, {})
            self._write(self.state)
            return []
        self.state = Registry.from_json(raw, self.session_id)
        for record in [t for t in self.state.tasks.values() if t.clearing]:
            try:
                self._finish_clear(record.id)
            except DomainError as e:
                if e.code != "CLEAR_FAILED":
                    raise
                # The committed intent stays; the record remains visible as clearing.
                print(f"bg-tasks supervisor: {e.message}", file=sys.stderr)
        recovered = []
        ended = now_iso(self.clock)

        def reconcile(reg: Registry) -> None:
            for record in reg.tasks.values():
                if reconcile_unfinished(record, ended):
                    recovered.append(record.id)
        if any(not t.finalized() for t in self.state.tasks.values()):
            self.mutate(reconcile)
        return recovered

    def _write(self, reg: Registry) -> None:
        self.store.commit_registry(reg.to_json())

    def mutate(self, fn: Callable[[Registry], None]) -> None:
        """Apply fn to a copy and commit it; the in-memory state changes only after a durable commit."""
        assert self.state is not None
        draft = Registry(self.state.session_id, self.state.next_seq, self.state.revision + 1,
                         {k: dataclasses.replace(v) for k, v in self.state.tasks.items()})
        fn(draft)
        self._write(draft)
        self.state = draft

    def get(self, task_id: str) -> TaskRecord:
        assert self.state is not None
        record = self.state.tasks.get(task_id)
        if record is None:
            raise DomainError("NOT_FOUND", f"no task {task_id} in this session")
        return record

    def admit(self, label: str, command: str, cwd: str, notify: bool, activation: str, task_id: str, log_rel: str) -> TaskRecord:
        assert self.state is not None
        created = now_iso(self.clock)
        holder = {}

        def fn(reg: Registry) -> None:
            record = TaskRecord(
                id=task_id, seq=reg.next_seq, session_id=reg.session_id, label=label, command=command, cwd=cwd,
                created_at=created, started_at=None, ended_at=None, activation=activation, state=STATE_RUNNING,
                phase="starting", revision=1, exit=None, reason=None, reason_detail=None, log_path=log_rel,
                log_bytes=0, notify=notify, event=None, pid=None, pgid=None, interrupted_activation=None,
                clearing=False, cleanup_unconfirmed=False)
            reg.next_seq += 1
            reg.tasks[task_id] = record
            holder["record"] = record
        self.mutate(fn)
        return holder["record"]

    def update(self, task_id: str, fn: Callable[[TaskRecord], None]) -> TaskRecord:
        def outer(reg: Registry) -> None:
            record = reg.tasks[task_id]
            fn(record)
            record.revision += 1
        self.mutate(outer)
        return self.get(task_id)

    def finalize(self, task_id: str, outcome: Outcome, exit_evidence: Optional[ExitEvidence], log_bytes: int,
                 notice_status: str) -> TaskRecord:
        ended = now_iso(self.clock)
        self.mutate(lambda reg: apply_terminal(reg.tasks[task_id], outcome, exit_evidence, ended, log_bytes, notice_status))
        return self.get(task_id)

    def set_notify(self, task_id: str, enabled: bool) -> TaskRecord:
        self.get(task_id)

        def fn(record: TaskRecord) -> None:
            record.notify = enabled
        return self.update(task_id, fn)

    def set_receipts(self, event_ids: list, status: str) -> list:
        assert self.state is not None
        wanted = set(event_ids)
        source = NOTICE_PENDING if status == NOTICE_RECEIVED else NOTICE_RECEIVED
        changed = [t.id for t in self.state.tasks.values() if t.event and t.event.id in wanted and t.event.status == source]
        if not changed:
            return []

        def fn(reg: Registry) -> None:
            for tid in changed:
                record = reg.tasks[tid]
                record.event = NoticeEvent(record.event.id, status)
                record.revision += 1
        self.mutate(fn)
        return [self.state.tasks[tid].event.id for tid in changed]

    def clear(self, task_id: str) -> int:
        record = self.get(task_id)
        if not record.finalized():
            raise DomainError("TASK_UNFINISHED", f"task {task_id} is {record.phase}; terminate it and wait for its outcome before clearing", record)
        removed = record.log_bytes
        if not record.clearing:
            self.update(task_id, lambda r: setattr(r, "clearing", True))
        self._finish_clear(task_id)
        return removed

    def _finish_clear(self, task_id: str) -> None:
        self.store.remove_task_artifacts(task_id)

        def fn(reg: Registry) -> None:
            del reg.tasks[task_id]
        self.mutate(fn)

    def page(self, upper: Optional[int], after: Optional[int], limit: int) -> dict:
        assert self.state is not None
        bound = upper if upper is not None else self.state.next_seq - 1
        ordered = sorted((t for t in self.state.tasks.values() if t.seq <= bound and (after is None or t.seq < after)),
                         key=lambda t: t.seq, reverse=True)
        items = ordered[:limit]
        more = len(ordered) > limit
        return {"items": items, "upper": bound, "next": items[-1].seq if more and items else None}

    def notices(self, status: str, after: Optional[int], limit: int) -> dict:
        assert self.state is not None
        if status == "eligible":
            match = lambda t: t.event is not None and t.event.status == NOTICE_PENDING and t.notify and not t.clearing
        else:
            match = lambda t: t.event is not None and t.event.status == NOTICE_RECEIVED and not t.clearing
        ordered = sorted((t for t in self.state.tasks.values() if match(t) and (after is None or t.seq > after)), key=lambda t: t.seq)
        items = ordered[:limit]
        return {"items": items, "next": items[-1].seq if len(ordered) > limit and items else None}


# --------------------------------------------------------------------------
# Protocol IO
# --------------------------------------------------------------------------

class ProtocolWriter:
    """Non-blocking writer: owner-EOF detection never waits on Pi reading stdout."""

    def __init__(self, fd: int):
        self.fd = fd
        self.buf = bytearray()
        self.broken = False
        self.hint_pending = False
        self.hint_terminal = False

    def send(self, obj: dict) -> None:
        if self.broken:
            return
        self.buf += (json.dumps({"v": PROTOCOL_VERSION, **obj}, separators=(",", ":"), ensure_ascii=False) + "\n").encode()

    def hint(self, terminal: bool) -> None:
        self.hint_pending = True
        self.hint_terminal = self.hint_terminal or terminal

    def flush(self) -> None:
        if self.broken:
            self.buf.clear()
            return
        if self.hint_pending and not self.buf:
            self.send({"type": "changed", "terminal": self.hint_terminal})
            self.hint_pending = False
            self.hint_terminal = False
        while self.buf:
            try:
                n = os.write(self.fd, self.buf)
            except BlockingIOError:
                return
            except (BrokenPipeError, OSError):
                self.broken = True
                self.buf.clear()
                return
            del self.buf[:n]

    def flush_until(self, deadline: float) -> None:
        """Bounded blocking flush for the final reply before exit."""
        while self.buf and not self.broken:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            sel = selectors.DefaultSelector()
            sel.register(self.fd, selectors.EVENT_WRITE)
            try:
                ready = sel.select(remaining)
            finally:
                sel.close()
            if ready:
                self.flush()

    def wants_write(self) -> bool:
        return bool(self.buf) or self.hint_pending


# --------------------------------------------------------------------------
# Linux process ownership helpers
# --------------------------------------------------------------------------

def enable_subreaper() -> None:
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        err = ctypes.get_errno()
        raise DomainError("PLATFORM_UNSUPPORTED", f"PR_SET_CHILD_SUBREAPER failed: {os.strerror(err)}")


def check_capabilities() -> None:
    if not sys.platform.startswith("linux"):
        raise DomainError("PLATFORM_UNSUPPORTED", f"background tasks require Linux, not {sys.platform}")
    for name in ("pidfd_open", "waitid", "WNOWAIT", "openpty"):
        if not hasattr(os, name):
            raise DomainError("PLATFORM_UNSUPPORTED", f"os.{name} is unavailable")
    if not hasattr(signal, "pidfd_send_signal"):
        raise DomainError("PLATFORM_UNSUPPORTED", "signal.pidfd_send_signal is unavailable")
    fd = os.pidfd_open(os.getpid())
    os.close(fd)
    proc_children(os.getpid())
    enable_subreaper()


def proc_children(self_pid: int) -> list:
    path = f"/proc/{self_pid}/task/{self_pid}/children"
    with open(path, "rb") as f:
        return [int(x) for x in f.read().split()]


def proc_parent_and_group(pid: int) -> Optional[tuple]:
    try:
        with open(f"/proc/{pid}/stat", "rb") as f:
            raw = f.read()
    except (FileNotFoundError, ProcessLookupError):
        return None
    fields = raw[raw.rindex(b")") + 2:].split()
    return int(fields[1]), int(fields[2])


# --------------------------------------------------------------------------
# Supervisor
# --------------------------------------------------------------------------

STAGE_NONE = "none"
STAGE_GRACE = "grace"
STAGE_TERM = "term"
STAGE_KILL = "kill"
STAGE_UNCONFIRMED = "unconfirmed"


@dataclass
class TaskRuntime:
    task_id: str
    pid: int
    pgid: int
    master_fd: Optional[int]
    log: Optional[LogHandle]
    log_bytes: int
    unsynced: bool = False
    last_sync: float = 0.0
    exit: Optional[ExitEvidence] = None
    sealed: bool = False
    group_settled: bool = False
    pty_eof: bool = False
    drain_deadline: Optional[float] = None
    drain_timed_out: bool = False
    output_failed: bool = False
    terminate_requested: bool = False
    descendants_remaining: bool = False
    shutdown: Optional[str] = None
    shutdown_detail: Optional[str] = None
    stage: str = STAGE_NONE
    stage_deadline: Optional[float] = None
    termed: set = field(default_factory=set)
    waiters: list = field(default_factory=list)  # request ids awaiting terminate outcome
    pending_outcome: Optional[Outcome] = None  # decided but not yet durably committed


class Supervisor:
    def __init__(self, registry: TaskRegistry, store: TaskStore, log_rel: Callable[[str], str], shell: str,
                 activation: str, writer: ProtocolWriter, clock: Clock, in_fd: int = 0):
        self.registry = registry
        self.store = store
        self.log_rel = log_rel
        self.shell = shell
        self.activation = activation
        self.writer = writer
        self.clock = clock
        self.in_fd = in_fd
        self.self_pid = os.getpid()
        self.runtimes: dict = {}  # task id -> TaskRuntime (unfinished only)
        self.leaders: dict = {}  # unreaped leader pid -> task id
        self.deferred_spawns: list = []  # (request id, args) waiting for closing groups
        self.storage_failed: Optional[str] = None
        self.shutting_down: Optional[str] = None
        self.shutdown_detail: Optional[str] = None
        self.shutdown_waiter: Optional[int] = None
        self.teardown_deadline: Optional[float] = None
        self.in_buf = bytearray()
        self.signal_shutdown: Optional[str] = None
        self.done = False
        self.selector = selectors.DefaultSelector()
        self.wake_r, self.wake_w = os.pipe2(os.O_NONBLOCK | os.O_CLOEXEC)

    # ---- loop ----------------------------------------------------------

    def run(self) -> None:
        signal.set_wakeup_fd(self.wake_w, warn_on_full_buffer=False)
        signal.signal(signal.SIGCHLD, lambda *_: None)
        signal.signal(signal.SIGTERM, self._on_term_signal)
        signal.signal(signal.SIGHUP, self._on_term_signal)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        os.set_blocking(self.in_fd, False)
        os.set_blocking(self.writer.fd, False)
        self.selector.register(self.wake_r, selectors.EVENT_READ, ("wake", None))
        self.selector.register(self.in_fd, selectors.EVENT_READ, ("control", None))
        out_registered = False
        while not self.done:
            want_out = self.writer.wants_write() and not self.writer.broken
            if want_out != out_registered:
                if want_out:
                    self.selector.register(self.writer.fd, selectors.EVENT_WRITE, ("out", None))
                else:
                    self.selector.unregister(self.writer.fd)
                out_registered = want_out
            timeout = self._next_timeout()
            for key, _mask in self.selector.select(timeout):
                kind, task_id = key.data
                if kind == "wake":
                    self._drain_wake()
                elif kind == "control":
                    self._read_control()
                elif kind == "pty":
                    self._read_pty(task_id)
                elif kind == "out":
                    self.writer.flush()
            if self.signal_shutdown is not None and self.shutting_down is None:
                self._begin_shutdown("graceful", f"supervisor_{self.signal_shutdown}", None)
            self._reap_children()
            self._advance_deadlines()
            self._sync_logs(False)
            self._maybe_finish_teardown()
            self.writer.flush()
        self.writer.flush_until(self.clock.monotonic() + FINAL_FLUSH_MS / 1000)

    def _on_term_signal(self, signum, _frame) -> None:
        # Handlers run between bytecodes; the loop performs the actual shutdown.
        self.signal_shutdown = signal.Signals(signum).name

    def _drain_wake(self) -> None:
        try:
            while os.read(self.wake_r, 4096):
                pass
        except BlockingIOError:
            pass

    def _next_timeout(self) -> Optional[float]:
        now = self.clock.monotonic()
        candidates = []
        for rt in self.runtimes.values():
            if rt.stage_deadline is not None:
                candidates.append(rt.stage_deadline)
            if rt.drain_deadline is not None:
                candidates.append(rt.drain_deadline)
            if rt.unsynced:
                candidates.append(rt.last_sync + LOG_SYNC_INTERVAL_MS / 1000)
            if rt.sealed and not rt.group_settled or rt.stage in (STAGE_TERM, STAGE_KILL, STAGE_UNCONFIRMED) or rt.pending_outcome is not None:
                candidates.append(now + CLOSING_POLL_MS / 1000)
        if self.teardown_deadline is not None:
            candidates.append(self.teardown_deadline)
        if not candidates:
            return None
        return max(0.0, min(candidates) - now)

    # ---- control channel -------------------------------------------------

    def _read_control(self) -> None:
        try:
            chunk = os.read(self.in_fd, 65536)
        except BlockingIOError:
            return
        except OSError:
            chunk = b""
        if not chunk:
            self.selector.unregister(self.in_fd)
            if self.shutting_down is None:
                self._begin_shutdown("owner_lost", None, None)
            else:
                # The owner is gone; no reply can reach it.
                self.writer.broken = True
            return
        self.in_buf += chunk
        while True:
            nl = self.in_buf.find(b"\n")
            if nl < 0:
                if len(self.in_buf) > MAX_REQUEST_LINE_BYTES:
                    print("bg-tasks supervisor: oversized request line dropped", file=sys.stderr)
                    self.in_buf.clear()
                return
            line = bytes(self.in_buf[:nl])
            del self.in_buf[:nl + 1]
            if line.strip():
                self._handle_line(line)

    def _reply_ok(self, req_id: int, result: dict) -> None:
        self.writer.send({"type": "reply", "id": req_id, "ok": True, "result": result})

    def _reply_err(self, req_id: int, err: DomainError) -> None:
        error = {"code": err.code, "message": err.message}
        if err.task is not None:
            error["task"] = self._record_json(err.task)
        self.writer.send({"type": "reply", "id": req_id, "ok": False, "error": error})

    def _handle_line(self, line: bytes) -> None:
        try:
            msg = json.loads(line)
        except (json.JSONDecodeError, UnicodeDecodeError):
            print("bg-tasks supervisor: unparsable request dropped", file=sys.stderr)
            return
        req_id = msg.get("id") if isinstance(msg, dict) else None
        if not isinstance(req_id, int) or isinstance(req_id, bool):
            print("bg-tasks supervisor: request without integer id dropped", file=sys.stderr)
            return
        try:
            if msg.get("v") != PROTOCOL_VERSION:
                raise DomainError("UNSUPPORTED_PROTOCOL", f"protocol version {msg.get('v')!r} is not {PROTOCOL_VERSION}")
            op = msg.get("op")
            args = msg.get("args")
            if not isinstance(args, dict):
                raise DomainError("INVALID_REQUEST", "args must be an object")
            handler = {
                "spawn": self._op_spawn, "list": self._op_list, "get": self._op_get, "read": self._op_read,
                "signal": self._op_signal, "terminate": self._op_terminate, "notify": self._op_notify,
                "clear": self._op_clear, "notices": self._op_notices, "receipts": self._op_receipts,
                "shutdown": self._op_shutdown,
            }.get(op)
            if handler is None:
                raise DomainError("INVALID_REQUEST", f"unknown operation {op!r}")
            result = handler(req_id, args)
            if result is not None:
                self._reply_ok(req_id, result)
        except DomainError as e:
            self._reply_err(req_id, e)
        except Exception as e:  # noqa: BLE001 - an invariant failure: report it and tear down with cleanup
            traceback.print_exc(file=sys.stderr)
            self._reply_err(req_id, DomainError("SUPERVISOR_FAULT", f"internal supervisor failure: {e!r}; stopping owned tasks"))
            if self.shutting_down is None:
                self._begin_shutdown("graceful", "supervisor_fault", None)

    # ---- argument validation ----------------------------------------------

    @staticmethod
    def _keys(args: dict, allowed: tuple) -> None:
        extra = set(args) - set(allowed)
        missing = set(allowed) - set(args)
        if extra or missing:
            raise DomainError("INVALID_REQUEST", f"fields must be exactly {sorted(allowed)}")

    @staticmethod
    def _str(args: dict, key: str) -> str:
        value = args[key]
        if not isinstance(value, str):
            raise DomainError("INVALID_REQUEST", f"{key} must be a string")
        return value

    @staticmethod
    def _bool(args: dict, key: str) -> bool:
        value = args[key]
        if not isinstance(value, bool):
            raise DomainError("INVALID_REQUEST", f"{key} must be a boolean")
        return value

    @staticmethod
    def _int(args: dict, key: str, lo: int, hi: int, nullable: bool = False) -> Optional[int]:
        value = args[key]
        if value is None and nullable:
            return None
        if not isinstance(value, int) or isinstance(value, bool) or not lo <= value <= hi:
            raise DomainError("INVALID_REQUEST", f"{key} must be an integer in [{lo}, {hi}]")
        return value

    # ---- records -----------------------------------------------------------

    def _record_json(self, record: TaskRecord) -> dict:
        data = record.to_json()
        rt = self.runtimes.get(record.id)
        if rt is not None:
            data["logBytes"] = rt.log_bytes
        return data

    # ---- operations --------------------------------------------------------

    def _op_spawn(self, req_id: int, args: dict) -> Optional[dict]:
        self._keys(args, ("label", "command", "cwd", "notify"))
        label = self._str(args, "label")
        command = self._str(args, "command")
        cwd = self._str(args, "cwd")
        notify = self._bool(args, "notify")
        if not label.strip() or len(label) > MAX_LABEL_CHARS:
            raise DomainError("INVALID_REQUEST", f"label must be 1..{MAX_LABEL_CHARS} characters")
        if not command.strip() or len(command.encode()) > MAX_COMMAND_BYTES or "\x00" in command:
            raise DomainError("INVALID_REQUEST", f"command must be a non-empty string of at most {MAX_COMMAND_BYTES} bytes without NUL")
        if not os.path.isabs(cwd) or "\x00" in cwd:
            raise DomainError("INVALID_REQUEST", "cwd must be an absolute path")
        if self.shutting_down is not None:
            raise DomainError("SHUTTING_DOWN", "the supervisor is shutting down")
        if self.storage_failed is not None:
            raise DomainError("STORAGE_FAILED", f"storage failed earlier; launches are disabled: {self.storage_failed}")
        if self._unconfirmed_group():
            raise DomainError("SESSION_CLOSING_GROUP", "a finished task's process group could not be confirmed settled; new launches are paused")
        if self._closing_groups():
            self.deferred_spawns.append((req_id, (label, command, cwd, notify)))
            return None
        return self._spawn(label, command, cwd, notify)

    def _unconfirmed_group(self) -> bool:
        return any(rt.sealed and not rt.group_settled and rt.stage == STAGE_UNCONFIRMED for rt in self.runtimes.values())

    def _closing_groups(self) -> bool:
        return any(rt.sealed and not rt.group_settled for rt in self.runtimes.values())

    def _spawn(self, label: str, command: str, cwd: str, notify: bool) -> dict:
        task_id = "bgt-" + secrets.token_hex(8)
        try:
            log = self.store.create_log(task_id)
        except StorageError as e:
            self.storage_failed = e.message
            raise
        try:
            record = self.registry.admit(label, command, cwd, notify, self.activation, task_id, self.log_rel(task_id))
        except StorageError as e:
            log.close()
            self.storage_failed = e.message
            raise
        try:
            pid, master = self._launch(command, cwd)
        except DomainError as e:
            log.close()
            failed = self._commit_or_mark(lambda: self.registry.finalize(
                task_id, Outcome(STATE_FAILED, "launch_failed", e.message), None, 0, NOTICE_INLINE))
            raise DomainError("LAUNCH_FAILED", e.message, failed)
        rt = TaskRuntime(task_id=task_id, pid=pid, pgid=pid, master_fd=master, log=log, log_bytes=0,
                         last_sync=self.clock.monotonic())
        self.runtimes[task_id] = rt
        self.leaders[pid] = task_id
        self.selector.register(master, selectors.EVENT_READ, ("pty", task_id))
        started = now_iso(self.clock)

        def mark_running(r: TaskRecord) -> None:
            r.phase = "running"
            r.pid = pid
            r.pgid = pid
            r.started_at = started
        try:
            record = self.registry.update(task_id, mark_running)
        except StorageError as e:
            self.storage_failed = e.message
            self._request_terminate(rt)
            raise
        self.writer.hint(False)
        return {"task": self._record_json(record)}

    def _commit_or_mark(self, fn: Callable[[], TaskRecord]) -> Optional[TaskRecord]:
        try:
            return fn()
        except StorageError as e:
            self.storage_failed = e.message
            return None

    def _launch(self, command: str, cwd: str) -> tuple:
        opened: list = []
        try:
            master, slave = os.openpty()
            opened += [master, slave]
            err_r, err_w = os.pipe2(os.O_CLOEXEC)
            opened += [err_r, err_w]
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", PTY_ROWS, PTY_COLS, 0, 0))
            pid = os.fork()
        except OSError as e:
            for fd in opened:
                os.close(fd)
            raise DomainError("LAUNCH_FAILED", f"cannot create the task's terminal or process: {e}") from e
        if pid == 0:
            self._child_exec(slave, err_w, command, cwd)
        os.close(slave)
        os.close(err_w)
        try:
            failure = self._await_exec(err_r, pid)
        finally:
            os.close(err_r)
        if failure is not None:
            os.close(master)
            raise DomainError("LAUNCH_FAILED", failure)
        os.set_blocking(master, False)
        return pid, master

    def _await_exec(self, err_r: int, pid: int) -> Optional[str]:
        deadline = self.clock.monotonic() + START_TIMEOUT_MS / 1000
        data = b""
        sel = selectors.DefaultSelector()
        sel.register(err_r, selectors.EVENT_READ)
        try:
            while True:
                remaining = deadline - self.clock.monotonic()
                if remaining <= 0:
                    pidfd = os.pidfd_open(pid)
                    try:
                        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
                    finally:
                        os.close(pidfd)
                    os.waitpid(pid, 0)
                    return f"the command did not start within {START_TIMEOUT_MS} ms"
                if not sel.select(remaining):
                    continue
                chunk = os.read(err_r, 512)
                if not chunk:
                    break
                data += chunk
        finally:
            sel.close()
        if not data:
            return None
        # The child wrote "stage:errno" and exits without forking; reap it here.
        os.waitpid(pid, 0)
        stage, _, code = data.decode(errors="replace").partition(":")
        try:
            detail = os.strerror(int(code))
        except ValueError:
            detail = code
        return f"{stage} failed: {detail}"

    def _child_exec(self, slave: int, err_w: int, command: str, cwd: str) -> None:
        stage = "setsid"
        try:
            os.setsid()
            stage = "controlling terminal"
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            stage = "terminal descriptors"
            for target in (0, 1, 2):
                os.dup2(slave, target)
            # Only the task's own terminal and the exec-status pipe survive.
            os.closerange(3, err_w)
            os.closerange(err_w + 1, os.sysconf("SC_OPEN_MAX"))
            for sig in (signal.SIGPIPE, signal.SIGXFSZ, signal.SIGINT, signal.SIGCHLD, signal.SIGTERM, signal.SIGHUP):
                signal.signal(sig, signal.SIG_DFL)
            signal.set_wakeup_fd(-1)
            stage = "chdir"
            os.chdir(cwd)
            stage = "exec"
            os.execve(self.shell, [self.shell, "--noprofile", "--norc", "-c", command], os.environ)
        except BaseException as e:  # noqa: BLE001 - the child must never return into the supervisor loop
            code = e.errno if isinstance(e, OSError) and e.errno else errno.EIO
            try:
                os.write(err_w, f"{stage}:{code}".encode())
            finally:
                os._exit(EXEC_FAILURE_STATUS)
        os._exit(EXEC_FAILURE_STATUS)

    def _op_list(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("upper", "after", "limit"))
        upper = self._int(args, "upper", 0, 1 << 62, True)
        after = self._int(args, "after", 0, 1 << 62, True)
        limit = self._int(args, "limit", 1, MAX_LIST_ITEMS)
        page = self.registry.page(upper, after, limit)
        return {"items": [self._record_json(t) for t in page["items"]], "upper": page["upper"], "next": page["next"]}

    def _op_get(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("id",))
        return {"task": self._record_json(self.registry.get(self._str(args, "id")))}

    def _visible(self, task_id: str) -> TaskRecord:
        record = self.registry.get(task_id)
        if record.clearing:
            raise DomainError("NOT_FOUND", f"task {task_id} is being cleared")
        return record

    def _op_read(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("id", "offset", "limit"))
        task_id = self._str(args, "id")
        limit = self._int(args, "limit", 1, MAX_READ_BYTES)
        offset = args["offset"]
        if offset != "tail" and (not isinstance(offset, int) or isinstance(offset, bool) or offset < 0):
            raise DomainError("INVALID_REQUEST", "offset must be a nonnegative integer or \"tail\"")
        record = self._visible(task_id)
        if offset == "tail":
            size = self.store.log_size(record.id)
            offset = max(0, size - limit)
        data, size = self.store.read_log(record.id, offset, limit)
        return {"task": self._record_json(record), "offset": offset, "data": base64.b64encode(data).decode(), "size": size}

    def _op_signal(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("id", "signal"))
        name = self._str(args, "signal")
        if name not in SUPPORTED_SIGNALS:
            raise DomainError("INVALID_REQUEST", f"unsupported signal {name}; use one of {sorted(SUPPORTED_SIGNALS)}")
        record = self._visible(self._str(args, "id"))
        if record.finalized():
            raise DomainError("TASK_FINALIZED", f"task {record.id} already finished; its process identity is released", record)
        rt = self._runtime_of(record)
        if rt.sealed:
            raise DomainError("TASK_CLOSING", f"task {record.id}'s root process exited; group signals are sealed (use terminate)", record)
        # The leader is unreaped while unsealed, so its PGID cannot have been reused.
        try:
            os.killpg(rt.pgid, SUPPORTED_SIGNALS[name])
            delivered = True
        except ProcessLookupError:
            delivered = False
        return {"task": self._record_json(record), "signal": name, "delivered": delivered}

    def _op_terminate(self, req_id: int, args: dict) -> Optional[dict]:
        self._keys(args, ("id",))
        record = self._visible(self._str(args, "id"))
        if record.finalized():
            return {"task": self._record_json(record)}
        rt = self._runtime_of(record)
        rt.waiters.append(req_id)
        rt.terminate_requested = True
        self._request_terminate(rt)
        return None

    def _runtime_of(self, record: TaskRecord) -> TaskRuntime:
        rt = self.runtimes.get(record.id)
        if rt is None:
            # Only a launch failure whose terminal commit failed leaves an unfinished record without a process.
            raise DomainError("STORAGE_FAILED", f"task {record.id} never started and its failure could not be committed: {self.storage_failed}", record)
        return rt

    def _request_terminate(self, rt: TaskRuntime) -> None:
        rt.terminate_requested = rt.terminate_requested or rt.shutdown is None
        if rt.stage == STAGE_UNCONFIRMED:
            self._set_stage(rt, STAGE_KILL)
            self._mark_record(rt, lambda r: setattr(r, "cleanup_unconfirmed", False))
            self._signal_group(rt, signal.SIGKILL)
            return
        if rt.stage in (STAGE_NONE, STAGE_GRACE):
            self._set_stage(rt, STAGE_TERM)
            self._mark_record(rt, lambda r: setattr(r, "phase", "stopping"))
            self._signal_group(rt, signal.SIGTERM)

    def _mark_record(self, rt: TaskRuntime, fn: Callable[[TaskRecord], None]) -> None:
        try:
            self.registry.update(rt.task_id, fn)
        except StorageError as e:
            self.storage_failed = e.message
        self.writer.hint(False)

    def _set_stage(self, rt: TaskRuntime, stage: str) -> None:
        rt.stage = stage
        now = self.clock.monotonic()
        rt.stage_deadline = {
            STAGE_GRACE: now + DESCENDANT_GRACE_MS / 1000,
            STAGE_TERM: now + TERM_GRACE_MS / 1000,
            STAGE_KILL: now + KILL_WAIT_MS / 1000,
        }.get(stage)

    def _signal_group(self, rt: TaskRuntime, sig: int) -> None:
        if not rt.sealed:
            # Numeric PGID signalling is allowed only while the leader is unreaped.
            try:
                os.killpg(rt.pgid, sig)
                if sig == signal.SIGTERM:
                    os.killpg(rt.pgid, signal.SIGCONT)
            except ProcessLookupError:
                pass
            return
        self._signal_candidates(rt, sig)

    def _signal_candidates(self, rt: TaskRuntime, sig: int) -> None:
        """After sealing: signal validated direct/adopted children of the group through pidfds."""
        if rt.group_settled:
            # ECHILD was observed: the PGID may now name a recycled leader.
            return
        try:
            candidates = proc_children(self.self_pid)
        except OSError as e:
            print(f"bg-tasks supervisor: child discovery failed: {e}", file=sys.stderr)
            return
        for pid in candidates:
            if sig == signal.SIGTERM and pid in rt.termed:
                continue
            identity = proc_parent_and_group(pid)
            if identity is None or identity != (self.self_pid, rt.pgid):
                continue
            try:
                pidfd = os.pidfd_open(pid)
            except ProcessLookupError:
                continue
            try:
                # No reaping happens between discovery and here, so the unreaped child keeps its PID.
                if proc_parent_and_group(pid) == (self.self_pid, rt.pgid):
                    signal.pidfd_send_signal(pidfd, sig)
                    if sig == signal.SIGTERM:
                        signal.pidfd_send_signal(pidfd, signal.SIGCONT)
                        rt.termed.add(pid)
            except ProcessLookupError:
                pass
            finally:
                os.close(pidfd)

    def _op_notify(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("id", "enabled"))
        record = self._visible(self._str(args, "id"))
        record = self.registry.set_notify(record.id, self._bool(args, "enabled"))
        self.writer.hint(False)
        return {"task": self._record_json(record)}

    def _op_clear(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("id",))
        task_id = self._str(args, "id")
        removed = self.registry.clear(task_id)
        self.writer.hint(False)
        return {"id": task_id, "removedBytes": removed}

    def _op_notices(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("status", "after", "limit"))
        status = self._str(args, "status")
        if status not in ("eligible", "received"):
            raise DomainError("INVALID_REQUEST", "status must be eligible or received")
        page = self.registry.notices(status, self._int(args, "after", 0, 1 << 62, True), self._int(args, "limit", 1, MAX_LIST_ITEMS))
        return {"items": [self._record_json(t) for t in page["items"]], "next": page["next"]}

    def _op_receipts(self, _req_id: int, args: dict) -> dict:
        self._keys(args, ("eventIds", "received"))
        ids = args["eventIds"]
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(ids) > MAX_LIST_ITEMS:
            raise DomainError("INVALID_REQUEST", f"eventIds must be at most {MAX_LIST_ITEMS} strings")
        status = NOTICE_RECEIVED if self._bool(args, "received") else NOTICE_PENDING
        changed = self.registry.set_receipts(ids, status)
        return {"changed": changed}

    def _op_shutdown(self, req_id: int, args: dict) -> Optional[dict]:
        self._keys(args, ("reason",))
        reason = self._str(args, "reason")
        if reason not in SHUTDOWN_REASONS:
            raise DomainError("INVALID_REQUEST", f"reason must be one of {SHUTDOWN_REASONS}")
        if self.shutting_down is not None:
            raise DomainError("SHUTTING_DOWN", "shutdown already in progress")
        self._begin_shutdown("graceful", reason, req_id)
        return None

    # ---- process observation -------------------------------------------------

    def _reap_children(self) -> None:
        while True:
            try:
                info = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            except ChildProcessError:
                break
            if info is None:
                break
            pid = info.si_pid
            task_id = self.leaders.pop(pid, None)
            if task_id is not None:
                rt = self.runtimes[task_id]
                rt.exit = ExitEvidence.from_waitid(info)
                # Seal numeric-PGID authority before releasing the leader's PID.
                rt.sealed = True
                os.waitpid(pid, 0)
                evidence = rt.exit

                def to_closing(r: TaskRecord) -> None:
                    r.exit = evidence
                    if r.phase != "stopping":
                        r.phase = "closing"
                self._mark_record(rt, to_closing)
            else:
                try:
                    os.waitpid(pid, 0)
                except ChildProcessError:
                    pass
        for rt in list(self.runtimes.values()):
            if rt.sealed and not rt.group_settled:
                self._check_group(rt)
            self._maybe_finalize(rt)
        if self.deferred_spawns and (not self._closing_groups() or self._unconfirmed_group()):
            pending, self.deferred_spawns = self.deferred_spawns, []
            for req_id, (label, command, cwd, notify) in pending:
                try:
                    if self._unconfirmed_group():
                        raise DomainError("SESSION_CLOSING_GROUP", "a finished task's process group could not be confirmed settled; new launches are paused")
                    if self.shutting_down is not None:
                        raise DomainError("SHUTTING_DOWN", "the supervisor is shutting down")
                    self._reply_ok(req_id, self._spawn(label, command, cwd, notify))
                except DomainError as e:
                    self._reply_err(req_id, e)

    def _check_group(self, rt: TaskRuntime) -> None:
        while True:
            try:
                pid, _status = os.waitpid(-rt.pgid, os.WNOHANG)
            except ChildProcessError:
                rt.group_settled = True
                rt.stage_deadline = None
                if not rt.pty_eof and rt.drain_deadline is None:
                    rt.drain_deadline = self.clock.monotonic() + OUTPUT_DRAIN_MS / 1000
                return
            if pid == 0:
                break
        if rt.stage == STAGE_NONE:
            if rt.terminate_requested or rt.shutdown is not None:
                self._set_stage(rt, STAGE_TERM)
                self._signal_candidates(rt, signal.SIGTERM)
            else:
                self._set_stage(rt, STAGE_GRACE)
        elif rt.stage == STAGE_TERM:
            self._signal_candidates(rt, signal.SIGTERM)
        elif rt.stage in (STAGE_KILL,):
            self._signal_candidates(rt, signal.SIGKILL)

    def _advance_deadlines(self) -> None:
        now = self.clock.monotonic()
        for rt in list(self.runtimes.values()):
            if rt.drain_deadline is not None and now >= rt.drain_deadline and not rt.pty_eof:
                rt.drain_timed_out = True
                self._close_pty(rt)
            if rt.stage_deadline is None or now < rt.stage_deadline:
                continue
            if rt.stage == STAGE_GRACE:
                rt.descendants_remaining = True
                self._set_stage(rt, STAGE_TERM)
                self._signal_candidates(rt, signal.SIGTERM)
            elif rt.stage == STAGE_TERM:
                self._set_stage(rt, STAGE_KILL)
                self._signal_group(rt, signal.SIGKILL)
            elif rt.stage == STAGE_KILL:
                self._set_stage(rt, STAGE_UNCONFIRMED)
                if rt.shutdown is not None:
                    self._finalize(rt, cleanup_confirmed=False)
                    continue

                def unconfirmed(r: TaskRecord) -> None:
                    r.phase = "stopping"
                    r.cleanup_unconfirmed = True
                self._mark_record(rt, unconfirmed)
                record = self.registry.get(rt.task_id)
                for waiter in rt.waiters:
                    self._reply_err(waiter, DomainError(
                        "TERMINATION_UNCONFIRMED",
                        f"task {rt.task_id} did not stop within {TERM_GRACE_MS + KILL_WAIT_MS} ms; it remains owned and observed",
                        record))
                rt.waiters.clear()

    # ---- output ---------------------------------------------------------------

    def _read_pty(self, task_id: str) -> None:
        rt = self.runtimes.get(task_id)
        if rt is None or rt.master_fd is None:
            return
        while True:
            try:
                data = os.read(rt.master_fd, PTY_READ_CHUNK)
            except BlockingIOError:
                return
            except OSError as e:
                if e.errno != errno.EIO:
                    # Not the Linux "no slave open" indication: an actual I/O error.
                    print(f"bg-tasks supervisor: PTY read failed for {task_id}: {e}", file=sys.stderr)
                    rt.output_failed = True
                self._close_pty(rt)
                rt.pty_eof = True
                return
            if not data:
                self._close_pty(rt)
                rt.pty_eof = True
                return
            self._append(rt, data)

    def _append(self, rt: TaskRuntime, data: bytes) -> None:
        if rt.output_failed or rt.log is None:
            return
        try:
            rt.log.write(data)
            rt.log_bytes += len(data)
            rt.unsynced = True
        except OSError as e:
            rt.output_failed = True
            self.storage_failed = f"log write failed: {e}"
            print(f"bg-tasks supervisor: log write failed for {rt.task_id}: {e}", file=sys.stderr)

    def _close_pty(self, rt: TaskRuntime) -> None:
        if rt.master_fd is None:
            return
        try:
            self.selector.unregister(rt.master_fd)
        except KeyError:
            pass
        os.close(rt.master_fd)
        rt.master_fd = None

    def _sync_logs(self, force: bool) -> None:
        now = self.clock.monotonic()
        for rt in self.runtimes.values():
            if rt.unsynced and rt.log is not None and not rt.output_failed and (force or now - rt.last_sync >= LOG_SYNC_INTERVAL_MS / 1000):
                try:
                    rt.log.sync()
                except OSError as e:
                    rt.output_failed = True
                    self.storage_failed = f"log sync failed: {e}"
                rt.unsynced = False
                rt.last_sync = now

    # ---- finalization ---------------------------------------------------------

    def _maybe_finalize(self, rt: TaskRuntime) -> None:
        if rt.pending_outcome is not None:
            self._commit_outcome(rt)
            return
        if rt.sealed and rt.group_settled and (rt.pty_eof or rt.drain_timed_out):
            if rt.master_fd is not None:
                self._read_pty(rt.task_id)
            self._finalize(rt, cleanup_confirmed=True)

    def _finalize(self, rt: TaskRuntime, cleanup_confirmed: bool) -> None:
        if rt.master_fd is not None:
            self._read_pty(rt.task_id)
            self._close_pty(rt)
        if rt.log is not None:
            if not rt.output_failed:
                try:
                    rt.log.sync()
                except OSError as e:
                    rt.output_failed = True
                    self.storage_failed = f"log sync failed: {e}"
            try:
                rt.log.close()
            except OSError:
                rt.output_failed = True
            rt.log = None
            rt.unsynced = False
        rt.pending_outcome = decide_outcome(
            rt.exit, shutdown=rt.shutdown, shutdown_detail=rt.shutdown_detail,
            terminate_requested=rt.terminate_requested, output_failed=rt.output_failed,
            descendants_remaining=rt.descendants_remaining, drain_timed_out=rt.drain_timed_out,
            cleanup_confirmed=cleanup_confirmed)
        self._commit_outcome(rt)

    def _commit_outcome(self, rt: TaskRuntime) -> None:
        assert rt.pending_outcome is not None
        try:
            record = self.registry.finalize(rt.task_id, rt.pending_outcome, rt.exit, rt.log_bytes, NOTICE_PENDING)
        except StorageError as e:
            # Not durable: no terminal state and no notice; retried from the loop.
            self.storage_failed = e.message
            if self.shutting_down is None:
                return
            record = None
        rt.pending_outcome = None
        del self.runtimes[rt.task_id]
        self.leaders.pop(rt.pid, None)
        if record is not None:
            for waiter in rt.waiters:
                self._reply_ok(waiter, {"task": self._record_json(record)})
        else:
            for waiter in rt.waiters:
                self._reply_err(waiter, StorageError("the terminal outcome could not be committed"))
        rt.waiters.clear()
        self.writer.hint(record is not None)

    # ---- shutdown ---------------------------------------------------------------

    def _begin_shutdown(self, kind: str, detail: Optional[str], waiter: Optional[int]) -> None:
        self.shutting_down = kind
        self.shutdown_detail = detail
        self.shutdown_waiter = waiter
        self.teardown_deadline = self.clock.monotonic() + (TERM_GRACE_MS + KILL_WAIT_MS + OUTPUT_DRAIN_MS) / 1000
        for req_id, _ in self.deferred_spawns:
            self._reply_err(req_id, DomainError("SHUTTING_DOWN", "the supervisor is shutting down"))
        self.deferred_spawns.clear()
        for rt in list(self.runtimes.values()):
            rt.shutdown = kind
            rt.shutdown_detail = detail
            self._request_terminate(rt)

    def _maybe_finish_teardown(self) -> None:
        if self.shutting_down is None:
            return
        if self.runtimes and self.clock.monotonic() < self.teardown_deadline:
            return
        for rt in list(self.runtimes.values()):
            # Budget exhausted: abandon without claiming the processes stopped.
            self._finalize(rt, cleanup_confirmed=False)
        if self.shutdown_waiter is not None:
            self._reply_ok(self.shutdown_waiter, {"storageFailed": self.storage_failed})
        self.done = True


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def emit_line(obj: dict) -> None:
    os.write(1, (json.dumps({"v": PROTOCOL_VERSION, **obj}, separators=(",", ":")) + "\n").encode())


def main(argv: list) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sidecar", required=True)
    parser.add_argument("--session-id", required=True)
    parser.add_argument("--activation", required=True)
    parser.add_argument("--shell", required=True)
    parser.add_argument("--handoff-wait-ms", type=int, required=True)
    args = parser.parse_args(argv)
    clock = SystemClock()
    fs = FsOps()
    lock = OwnerLock(args.sidecar, fs)
    try:
        if not os.path.isabs(args.sidecar) or not os.path.isabs(args.shell):
            raise DomainError("INVALID_REQUEST", "sidecar and shell must be absolute paths")
        if not os.access(args.shell, os.X_OK):
            raise DomainError("CONFIG_MISSING", f"shell {args.shell} is not executable")
        check_capabilities()
        store = FileTaskStore(args.sidecar, fs)
        store.init_layout()
        lock.acquire(min(args.handoff_wait_ms, OWNER_HANDOFF_WAIT_MS), clock)
        registry = TaskRegistry(store, args.session_id, clock)
        recovered = registry.open()
    except DomainError as e:
        emit_line({"type": "fatal", "error": {"code": e.code, "message": e.message}})
        return 1
    except OSError as e:
        emit_line({"type": "fatal", "error": {"code": "STORAGE_FAILED", "message": str(e)}})
        return 1
    emit_line({"type": "ready", "activation": args.activation, "pid": os.getpid(), "recovered": recovered})
    supervisor = Supervisor(registry, store, store.log_rel, args.shell, args.activation, ProtocolWriter(1), clock)
    try:
        supervisor.run()
    finally:
        lock.release()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
