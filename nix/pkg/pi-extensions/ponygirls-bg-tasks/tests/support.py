"""Shared test support: import path, clocks, the memory store, and fault-injecting filesystem ops."""
import copy
import errno
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import supervisor as sv  # noqa: E402


class FakeClock:
    def __init__(self):
        self.mono = 100.0
        self.now = 1_800_000_000.0

    def monotonic(self):
        return self.mono

    def wall(self):
        return self.now


class MemoryLog:
    def __init__(self, store, task_id):
        self.store = store
        self.task_id = task_id
        self.closed = False

    def write(self, data):
        assert not self.closed
        self.store.logs[self.task_id] += data

    def sync(self):
        pass

    def close(self):
        self.closed = True


class MemoryTaskStore:
    """Hand-written TaskStore: committed state is what a crash would leave."""

    def __init__(self):
        self.registry = None
        self.logs = {}
        self.fail_next = set()

    def _maybe_fail(self, op):
        if op in self.fail_next:
            self.fail_next.discard(op)
            raise OSError(errno.EIO, f"injected {op} failure")

    def init_layout(self):
        pass

    def load_registry(self):
        return copy.deepcopy(self.registry)

    def commit_registry(self, data):
        try:
            self._maybe_fail("commit")
        except OSError as e:
            raise sv.StorageError(str(e)) from e
        self.registry = copy.deepcopy(data)

    def create_log(self, task_id):
        try:
            self._maybe_fail("create_log")
        except OSError as e:
            raise sv.StorageError(str(e)) from e
        assert task_id not in self.logs
        self.logs[task_id] = b""
        return MemoryLog(self, task_id)

    def remove_task_artifacts(self, task_id):
        try:
            self._maybe_fail("remove")
        except OSError as e:
            raise sv.DomainError("CLEAR_FAILED", str(e)) from e
        self.logs.pop(task_id, None)

    def read_log(self, task_id, offset, limit):
        if task_id not in self.logs:
            raise sv.DomainError("ARTIFACT_MISSING", task_id)
        data = self.logs[task_id]
        if offset > len(data):
            raise sv.DomainError("OFFSET_OUT_OF_RANGE", task_id)
        return data[offset:offset + limit], len(data)

    def log_size(self, task_id):
        if task_id not in self.logs:
            raise sv.DomainError("ARTIFACT_MISSING", task_id)
        return len(self.logs[task_id])


class InjectedCrash(OSError):
    pass


class RecordingFs(sv.FsOps):
    """Records every durability-relevant operation; optionally fails the Nth one."""

    def __init__(self, root, fail_at=None):
        self.root = root
        self.ops = []
        self.fail_at = fail_at

    def _rec(self, name, path, relative=False):
        rel = os.path.relpath(path, self.root) if isinstance(path, str) and not relative else path
        self.ops.append((name, rel))
        if self.fail_at is not None and len(self.ops) == self.fail_at:
            raise InjectedCrash(errno.EIO, f"injected failure at {name} {rel}")

    def mkdir(self, path):
        self._rec("mkdir", path)
        super().mkdir(path)

    def open_new(self, path, flags):
        self._rec("open", path)
        fd = super().open_new(path, flags)
        self.fds = getattr(self, "fds", {})
        self.fds[fd] = path
        return fd

    def write(self, fd, data):
        self._rec("write", self.fds.get(fd, fd))
        super().write(fd, data)

    def fsync(self, fd):
        self._rec("fsync", getattr(self, "fds", {}).get(fd, fd))
        super().fsync(fd)

    def fsync_dir(self, path):
        self._rec("fsync_dir", path)
        super().fsync_dir(path)

    def close(self, fd):
        # Closing is not a durability point; never injected.
        super().close(fd)

    def rename(self, src, dst):
        self._rec("rename", f"{os.path.relpath(src, self.root)}->{os.path.relpath(dst, self.root)}", relative=True)
        super().rename(src, dst)

    def unlink(self, path):
        self._rec("unlink", path)
        super().unlink(path)

    def rmdir(self, path):
        self._rec("rmdir", path)
        super().rmdir(path)
