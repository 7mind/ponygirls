"""SQLite + filesystem artifact store (explicit deps, no globals).

Layout under ``data_dir`` (contract §6.1)::

    manure.db                  # sqlite, journal_mode=WAL, synchronous=FULL
    staging/<hex32>/tree/...   # payload being assembled
    staging/<hex32>.json       # private session record (never served)
    live/<hex32>/...           # published user bytes ONLY

All sqlite access is serialized by one instance lock; quota reservation
uses a single ``BEGIN IMMEDIATE`` transaction so concurrent inits admit
exactly the fitting subset. Chunk receipt ordering (§6.2) and publish
windows (§6.3) are implemented here; startup ``reconcile()`` maps every
crash window to ready-or-resumable before serving.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import sqlite3
import stat as _stat
import threading
import time
from typing import Any, Callable, Iterator, Optional

from manure import auth as authmod
from manure import domain as D

__all__ = [
    "StorageError",
    "ArtifactStore",
    "MemoryArtifactStore",
    "UNSET",
]

UNSET: Any = object()


class StorageError(ValueError):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _fsync_dir(path: str) -> None:
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)
_O_DIRECTORY = getattr(os, "O_DIRECTORY", 0)


def _close_fd(fd: int) -> None:
    try:
        os.close(fd)
    except OSError:
        pass


def _open_child_dir(dirfd: int, comp: str) -> int:
    """Open a child directory without following symlinks (R13)."""
    try:
        fd = os.open(comp, os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY,
                     dir_fd=dirfd)
    except FileNotFoundError:
        raise StorageError("not-found", "no such file")
    except (NotADirectoryError, OSError) as exc:
        raise StorageError("invalid-path", "bad payload parent") from exc
    try:
        st = os.fstat(fd)
    except OSError as exc:
        _close_fd(fd)
        raise StorageError("invalid-path", "bad payload parent") from exc
    if not _stat.S_ISDIR(st.st_mode):
        _close_fd(fd)
        raise StorageError("invalid-path", "bad payload parent")
    return fd


def _stat_child(dirfd: int, comp: str) -> Any:
    """lstat-equivalent of one component relative to a dir fd."""
    try:
        return os.stat(comp, dir_fd=dirfd, follow_symlinks=False)
    except FileNotFoundError:
        raise StorageError("not-found", "no such file")
    except OSError as exc:
        raise StorageError("invalid-path", "bad payload entry") from exc


@contextlib.contextmanager
def _resolve_parent(data_dir: str, comps: list[str], create: bool = False,
                    expected: Any = None
                    ) -> Iterator[tuple[int, list[int]]]:
    """R13: open a component-wise no-follow chain from the validated
    storage root; yields (parent_fd, all_fds). With create=True, missing
    intermediate directories are created via mkdirat (never through
    symlinks). Every fd closes on exit.

    R9: when ``expected`` is a (st_dev, st_ino) pair, the opened root fd
    is verified against it BEFORE any child is touched; a retargeted
    parent alias or replaced root fails closed here (no child access).
    """
    fds: list[int] = []
    try:
        try:
            root_st = os.lstat(data_dir)
        except FileNotFoundError as exc:
            raise StorageError("not-found", "no such file") from exc
        except OSError as exc:
            raise StorageError("invalid-path", "bad storage root") from exc
        if _stat.S_ISLNK(root_st.st_mode) or \
                not _stat.S_ISDIR(root_st.st_mode):
            raise StorageError("invalid-path", "bad storage root")
        root = os.open(data_dir, os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY)
        fds.append(root)
        if expected is not None:
            try:
                rst = os.fstat(root)
            except OSError as exc:
                raise StorageError("unavailable",
                                   "storage root changed") from exc
            if (rst.st_dev, rst.st_ino) != expected:
                raise StorageError("unavailable",
                                   "storage root changed")
        for comp in comps:
            if comp in ("", ".", ".."):
                raise StorageError("invalid-path", "bad path component")
            try:
                fds.append(_open_child_dir(fds[-1], comp))
            except StorageError as exc:
                if not create or exc.code != "not-found":
                    raise
                try:
                    os.mkdir(comp, 0o700, dir_fd=fds[-1])
                except FileExistsError:
                    fds.append(_open_child_dir(fds[-1], comp))
                    continue
                except OSError as exc2:
                    raise StorageError("invalid-path",
                                       "bad payload parent") from exc2
                child = _open_child_dir(fds[-1], comp)
                fds.append(child)
                os.fsync(child)
                os.fsync(fds[-2])
        yield fds[-1], fds
    finally:
        for fd in reversed(fds):
            _close_fd(fd)


def _rmtree_at(dirfd: int, name: str) -> None:
    """Recursively remove one entry relative to a dir fd, unlinking
    symlinks themselves and never following them (R13 cleanup rule)."""
    try:
        st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
    except FileNotFoundError:
        return
    except OSError:
        return
    if _stat.S_ISLNK(st.st_mode) or not _stat.S_ISDIR(st.st_mode):
        try:
            os.unlink(name, dir_fd=dirfd)
        except FileNotFoundError:
            pass
        return
    try:
        child = os.open(name, os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY,
                        dir_fd=dirfd)
    except OSError:
        return
    try:
        for entry in os.listdir(child):
            _rmtree_at(child, entry)
    finally:
        _close_fd(child)
    try:
        os.rmdir(name, dir_fd=dirfd)
    except FileNotFoundError:
        pass


@contextlib.contextmanager
def _scan_root(data_dir: str,
               name: str, expected: Any = None) -> Iterator[Optional[int]]:
    """R13: open a top-level storage root for enumeration without ever
    traversing a symlinked root. Yields the dir fd, or None when the root
    is missing (recreated) or is not a real directory (skipped safely).
    R9: ``expected`` pins the storage-root identity (fail closed)."""
    fd: Optional[int] = None
    try:
        with _resolve_parent(data_dir, [], expected=expected) as (data_fd,
                                                                  _fds):
            try:
                st = os.stat(name, dir_fd=data_fd, follow_symlinks=False)
            except FileNotFoundError:
                try:
                    os.mkdir(name, 0o700, dir_fd=data_fd)
                    os.fsync(data_fd)
                except OSError:
                    yield None
                    return
                fd = os.open(name, os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY,
                             dir_fd=data_fd)
            else:
                if _stat.S_ISLNK(st.st_mode) or \
                        not _stat.S_ISDIR(st.st_mode):
                    yield None  # invalid root topology: touch nothing
                    return
                fd = os.open(name, os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY,
                             dir_fd=data_fd)
            try:
                st = os.fstat(fd)
            except OSError:
                _close_fd(fd)
                yield None
                return
            if not _stat.S_ISDIR(st.st_mode):
                _close_fd(fd)
                yield None
                return
            yield fd
    except StorageError:
        if fd is not None:
            _close_fd(fd)
        yield None
        return
    if fd is not None:
        _close_fd(fd)


def _coalesce(intervals: list[tuple[int, int]]) -> list[list[int]]:
    merged: list[list[int]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


class _Limits:
    """Duck-typed limits view for domain.validate_manifest."""

    def __init__(self, max_file_bytes: int, max_artifact_bytes: int,
                 max_files_per_artifact: int):
        self.max_file_bytes = max_file_bytes
        self.max_artifact_bytes = max_artifact_bytes
        self.max_files_per_artifact = max_files_per_artifact


class ArtifactStore:
    """Durable artifact repository. ``now`` is a private test-only clock."""

    def __init__(self, data_dir: str,
                 now: Optional[Callable[[], float]] = None,
                 storage_quota_bytes: int = 21474836480,
                 chunk_bytes: int = 1048576,
                 max_file_bytes: int = 536870912,
                 max_artifact_bytes: int = 2147483648,
                 max_files_per_artifact: int = 10000,
                 max_sessions_per_user: int = 10,
                 max_sessions_global: int = 1000,
                 max_grants_per_artifact: int = 10000,
                 incomplete_session_ttl_s: int = 86400,
                 grant_ttl_s: int = 86400,
                 one_time_grant_ttl_s: int = 60):
        self.data_dir = os.path.abspath(data_dir)
        self._now = now or time.time
        self._quota = storage_quota_bytes
        self._chunk_bytes = chunk_bytes
        self._max_file = max_file_bytes
        self._max_artifact = max_artifact_bytes
        self._max_files = max_files_per_artifact
        self._max_sess_user = max_sessions_per_user
        self._max_sess_global = max_sessions_global
        self._max_grants = max_grants_per_artifact
        self._idle_ttl = incomplete_session_ttl_s
        self._grant_ttl = grant_ttl_s
        self._otg_ttl = one_time_grant_ttl_s
        self._lock = threading.RLock()
        self._closed = False
        self._claim_sock: Optional[Any] = None
        self._claim_path = ""
        self._claim_fd: Optional[int] = None
        self._db: Optional[sqlite3.Connection] = None
        self._root_id: Any = None
        # R13: metadata topology — the configured root itself must be a
        # real directory, and a symlinked database file is refused.
        try:
            root_st = os.lstat(self.data_dir)
        except FileNotFoundError:
            root_st = None
        if root_st is not None and (_stat.S_ISLNK(root_st.st_mode)
                                    or not _stat.S_ISDIR(root_st.st_mode)):
            raise StorageError("invalid-path", "bad data_dir")
        os.makedirs(self.data_dir, exist_ok=True)
        # R9: bind exclusive ownership to ONE physical root for the entire
        # SQLite/files lifetime. Canonicalize the symlinked-parent alias,
        # pin (dev, ino), acquire the claim on that identity BEFORE any
        # child-directory effects, so retargeting cannot split SQLite/claim
        # (A) from payload (B) and a renamed-root competitor contends.
        canon = os.path.realpath(self.data_dir)
        try:
            canon_st = os.lstat(canon)
        except OSError as exc:
            raise StorageError("invalid-path", "bad data_dir") from exc
        if _stat.S_ISLNK(canon_st.st_mode) or \
                not _stat.S_ISDIR(canon_st.st_mode):
            raise StorageError("invalid-path", "bad data_dir")
        self.data_dir = canon
        try:
            rfd = os.open(self.data_dir,
                          os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY)
        except OSError as exc:
            raise StorageError("invalid-path", "bad data_dir") from exc
        try:
            rst = os.fstat(rfd)
        finally:
            _close_fd(rfd)
        if not _stat.S_ISDIR(rst.st_mode):
            raise StorageError("invalid-path", "bad data_dir")
        self._root_id = (rst.st_dev, rst.st_ino)
        # Exclusive ownership before staging/live/db effects; every later
        # initialization failure releases all acquired resources.
        self._acquire_claim()
        try:
            # R9-sqlite-root-lifetime: bind ALL child effects + SQLite to
            # the claimed fd (not the lexical path). Re-validate the pinned
            # fd, then mkdirat/fstatat/connect via that fd, so a
            # replacement at this boundary fails closed before touching B.
            root_fd = os.open(self.data_dir,
                              os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY)
            try:
                rst2 = os.fstat(root_fd)
                if (rst2.st_dev, rst2.st_ino) != self._root_id:
                    raise StorageError("unavailable",
                                       "storage root changed")
                for child in ("staging", "live"):
                    try:
                        os.mkdir(child, 0o700, dir_fd=root_fd)
                    except FileExistsError:
                        try:
                            cst = os.stat(child, dir_fd=root_fd,
                                          follow_symlinks=False)
                        except OSError as exc2:
                            raise StorageError(
                                "invalid-path",
                                "bad storage root") from exc2
                        if _stat.S_ISLNK(cst.st_mode) or \
                                not _stat.S_ISDIR(cst.st_mode):
                            raise StorageError("invalid-path",
                                               "bad storage root")
                    except OSError as exc2:
                        raise StorageError("invalid-path",
                                           "bad storage root") from exc2
                try:
                    os.fsync(root_fd)
                except OSError:
                    pass
                try:
                    db_st = os.stat("manure.db", dir_fd=root_fd,
                                    follow_symlinks=False)
                except FileNotFoundError:
                    db_st = None
                except OSError as exc2:
                    raise StorageError("invalid-path",
                                       "bad database file") from exc2
                if db_st is not None and \
                        not _stat.S_ISREG(db_st.st_mode):
                    raise StorageError("invalid-path",
                                       "bad database file")
                # SQLite via the pinned fd (Linux /proc); never resolves
                # the lexical path, so a concurrent replacement cannot
                # redirect creation/open under this claim.
                db_fd_path = "/proc/self/fd/%d/manure.db" % root_fd
                self._open_database(db_fd_path)
            finally:
                _close_fd(root_fd)
        except Exception:
            # R9-failed-startup-release-order: close SQLite SAFELY BEFORE
            # releasing the physical-root claim, so a same-root successor
            # stays excluded while the failed handle is alive/closing.
            # Retain ownership if safe cleanup cannot complete.
            if self._db is not None:
                try:
                    self._db.close()
                except sqlite3.Error as exc:
                    raise StorageError(
                        "unavailable",
                        "storage startup failed; ownership retained") from exc
                self._db = None
            self._release_claim()
            raise

    def _open_database(self, db_path: str | None = None) -> None:
        if db_path is None:
            db_path = os.path.join(self.data_dir, "manure.db")
        self._db = sqlite3.connect(db_path,
                                   check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.isolation_level = None
        with self._lock:
            # Init-only (object unpublished; no post-close race here) and
            # fd-bound via db_fd_path: no path-string recheck, which would
            # wrongly fail a safe pinned-fd open after replacement.
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA synchronous=FULL")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS artifacts("
                "id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,"
                "visibility TEXT NOT NULL, created_by_user TEXT NOT NULL,"
                "created_by_token TEXT NOT NULL, created_at TEXT NOT NULL,"
                "created_at_s REAL NOT NULL, expires_at TEXT,"
                "expires_at_s REAL, state TEXT NOT NULL, total_bytes INTEGER,"
                "file_count INTEGER, reserved_bytes INTEGER,"
                "ext_pwd_hash TEXT, last_activity_at REAL NOT NULL,"
                "manifest_json TEXT NOT NULL)")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS receipts(artifact_id TEXT,"
                "path TEXT, offset INTEGER, length INTEGER, sha256 TEXT,"
                "PRIMARY KEY(artifact_id, path, offset))")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS one_time_grants("
                "grant_hash TEXT PRIMARY KEY, artifact_id TEXT NOT NULL,"
                "principal TEXT NOT NULL, expires_at REAL NOT NULL,"
                "used INTEGER NOT NULL DEFAULT 0,"
                "user_id TEXT, token_id TEXT, token_digest TEXT)")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS content_grants("
                "grant_hash TEXT PRIMARY KEY, artifact_id TEXT NOT NULL,"
                "expires_at REAL NOT NULL, created_at REAL NOT NULL,"
                "user_id TEXT, token_id TEXT, token_digest TEXT,"
                "pwd_hash TEXT)")
            self._migrate_grant_columns()

    # ------------------------------------------------------------- helpers
    def _remove_payload_at(self, root_name: str, aid: str) -> None:
        """R13: remove one aid-keyed tree relative to a validated root."""
        try:
            with _resolve_parent(self.data_dir, [root_name], expected=self._root_id) as (root_fd,
                                                                 _fds):
                _rmtree_at(root_fd, aid)
        except StorageError:
            pass

    def _remove_sidecar(self, aid: str) -> None:
        """R13: unlink (never follow) one session sidecar."""
        try:
            with _resolve_parent(self.data_dir, ["staging"], expected=self._root_id) as (fd, _fds):
                try:
                    os.unlink(aid + ".json", dir_fd=fd)
                except FileNotFoundError:
                    pass
        except StorageError:
            pass

    def _write_sidecar(self, aid: str, payload: dict[str, Any]) -> None:
        """R13: create the session sidecar via openat (no traversal)."""
        with _resolve_parent(self.data_dir, ["staging"], expected=self._root_id) as (fd, _fds):
            try:
                new_fd = os.open(aid + ".json",
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | _O_NOFOLLOW, 0o600, dir_fd=fd)
            except FileExistsError:
                try:
                    os.unlink(aid + ".json", dir_fd=fd)
                except FileNotFoundError:
                    pass
                new_fd = os.open(aid + ".json",
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | _O_NOFOLLOW, 0o600, dir_fd=fd)
            try:
                with os.fdopen(new_fd, "w", encoding="utf-8") as fh:
                    json.dump(payload, fh)
                    fh.flush()
                    os.fsync(fh.fileno())
            except BaseException:
                try:
                    os.unlink(aid + ".json", dir_fd=fd)
                except OSError:
                    pass
                raise
            os.fsync(fd)

    def _ensure_staging_topology(self, item: dict[str, Any]) -> None:
        """R11+R13: (re)build a genuinely resumable staging topology from
        the immutable manifest via mkdirat (never through symlinks): tree
        root, declared directories, and empty placeholder files. Payload
        bytes are never fabricated — missing ranges stay missing until
        re-uploaded."""
        aid = item["id"]
        # R11-resumability: the tree root always exists afterwards, even for
        # empty manifests (which otherwise iterate zero entries).
        with _resolve_parent(self.data_dir, ["staging", aid, "tree"],
                             create=True, expected=self._root_id):
            pass
        for entry in item["manifest"]:
            parts = entry["path"].split("/")
            if entry["kind"] == "dir":
                with _resolve_parent(
                        self.data_dir, ["staging", aid, "tree"] + parts,
                        create=True, expected=self._root_id):
                    pass
                continue
            with _resolve_parent(
                    self.data_dir,
                    ["staging", aid, "tree"] + parts[:-1],
                    create=True, expected=self._root_id) as (parent_fd, fds):
                try:
                    fd = os.open(parts[-1],
                                 os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | _O_NOFOLLOW, 0o600, dir_fd=parent_fd)
                except FileExistsError:
                    continue
                except OSError as exc:
                    raise StorageError("invalid-path",
                                       "bad staging topology") from exc
                try:
                    os.fsync(fd)
                finally:
                    _close_fd(fd)
                os.fsync(parent_fd)
                os.fsync(fds[3])

    def _reconcile_file_receipts(self, aid: str,
                                 entry: dict[str, Any]) -> None:
        """R11-resumability: drop receipts whose staged bytes do not verify
        and truncate overlong tails, so status is truthful and re-uploads
        rewrite exactly the missing ranges."""
        for off, ln, sha in self._receipt_rows_locked(aid, entry["path"]):
            if not self._receipt_bytes_valid_at(self.data_dir, aid,
                                                entry["path"], off, ln, sha, expected=self._root_id):
                self._db.execute(
                    "DELETE FROM receipts WHERE artifact_id=? AND path=? "
                    "AND offset=?", (aid, entry["path"], off))
        receipts = self._receipt_rows_locked(aid, entry["path"])
        max_end = 0
        for off, ln, _sha in receipts:
            max_end = max(max_end, off + ln)
        max_end = min(max_end, entry["size"])
        try:
            with self._payload_leaf(self.data_dir, ["staging", aid, "tree"],
                                    entry["path"],
                                    write=True, expected=self._root_id) as (fd, _parent):
                if os.fstat(fd).st_size > max_end:
                    os.ftruncate(fd, max_end)
                    os.fsync(fd)
        except (StorageError, OSError):
            pass

    def _fire_failpoint(self, name: str) -> None:
        """One-shot private fault injection (tests only, never set in prod).
        Raises StorageError(unavailable) when armed with `name`."""
        armed = getattr(self, "_failpoints", None)
        if armed and name in armed:
            armed.discard(name)
            raise StorageError("unavailable", "injected fault")

    def _migrate_grant_columns(self) -> None:
        """Best-effort upgrade for pre-R3 databases (fresh dirs unaffected)."""
        for table, columns in (
                ("one_time_grants",
                 ("user_id", "token_id", "token_digest")),
                ("content_grants",
                 ("user_id", "token_id", "token_digest", "pwd_hash"))):
            try:
                cur = self._db.execute("PRAGMA table_info(%s)" % table)
                present = {row[1] for row in cur.fetchall()}
            except sqlite3.Error:
                continue
            for column in columns:
                if column not in present:
                    try:
                        self._db.execute("ALTER TABLE %s ADD COLUMN %s TEXT"
                                         % (table, column))
                    except sqlite3.Error:
                        pass

    def _acquire_claim(self) -> None:
        """R9: exclusive data_dir lifetime ownership.

        Primary: an abstract Unix-socket bind, which is atomic (no empty
        acquisition window), kernel-released on crash (no stale states or
        unlink-based liveness guesses), and exclusive across processes AND
        threads (a losing startup fails before touching any payload).
        Fallback (no abstract namespace): a held flock on a lockfile —
        same kernel lifetime semantics cross-process. Nothing is ever
        unlinked, so no check/unlink race exists.
        """
        import errno as _errno
        import socket as _socket
        # R9: the claim names the PINNED physical identity (dev, ino), not
        # a pathname, so a symlinked-parent alias of the same storage and
        # a renamed root (same inode, different string) contend for the
        # same name instead of opening it twice. The data_dir leaf itself
        # must still be a real dir (checked above).
        pinned = getattr(self, "_root_id", None)
        if pinned is None:
            raise StorageError("unavailable", "data_dir locked")
        digest = hashlib.sha256(("%d:%d" % (pinned[0], pinned[1])).encode(
            "utf-8")).hexdigest()
        try:
            sock = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        except OSError as exc:
            raise StorageError("unavailable", "data_dir locked") from exc
        try:
            sock.bind("\0manure-" + digest)
        except OSError as exc:
            try:
                sock.close()
            except OSError:
                pass
            if exc.errno == _errno.EADDRINUSE:
                raise StorageError("unavailable", "data_dir locked")
            # Explicit unsupported (governor disposition): flock-style file
            # locks are not exclusive within one process, and a shared
            # registry would be module-global mutable state (forbidden).
            # Fail closed instead of silently racing on such platforms.
            raise StorageError(
                "unavailable",
                "exclusive data_dir claim requires Linux abstract sockets"
            ) from exc
        self._claim_sock = sock

    def _release_claim(self) -> None:
        sock, self._claim_sock = getattr(self, "_claim_sock", None), None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
        fd, self._claim_fd = getattr(self, "_claim_fd", None), None
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        self._claim_path = ""

    def _assert_root_identity(self) -> None:
        """R9: fail closed if the physical storage root changed.

        Verifies the opened data_dir fd (O_NOFOLLOW) still matches the
        (dev, ino) pinned at construction, BEFORE any DB or filesystem
        mutation. A retargeted parent alias cannot affect this holder
        (canonical path), while a replaced root (same string, new
        directory) is detected here and in _resolve_parent.
        """
        expected = getattr(self, "_root_id", None)
        if expected is None:
            return
        try:
            fd = os.open(self.data_dir,
                         os.O_RDONLY | _O_NOFOLLOW | _O_DIRECTORY)
        except OSError as exc:
            raise StorageError("unavailable",
                               "storage root changed") from exc
        try:
            st = os.fstat(fd)
        except OSError as exc:
            _close_fd(fd)
            raise StorageError("unavailable",
                               "storage root changed") from exc
        _close_fd(fd)
        if (st.st_dev, st.st_ino) != expected:
            raise StorageError("unavailable", "storage root changed")

    def _limits(self) -> _Limits:
        return _Limits(self._max_file, self._max_artifact, self._max_files)

    def _staging_tree(self, aid: str) -> str:
        return os.path.join(self.data_dir, "staging", aid, "tree")

    def _staging_sidecar(self, aid: str) -> str:
        return os.path.join(self.data_dir, "staging", aid + ".json")

    def _live_dir(self, aid: str) -> str:
        return os.path.join(self.data_dir, "live", aid)

    def _get_locked(self, aid: str) -> Optional[dict[str, Any]]:
        cur = self._db.execute("SELECT * FROM artifacts WHERE id=?", (aid,))
        row = cur.fetchone()
        if row is None:
            return None
        item = _row_to_dict(row)
        item["manifest"] = json.loads(item.pop("manifest_json"))
        return item

    def _manifest_entries(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        return item["manifest"]

    def _check_owner_locked(self, item: dict[str, Any], user_id: str) -> None:
        if item["created_by_user"] != user_id:
            raise StorageError("session-not-owned", "not the session owner")

    @staticmethod
    def is_expired(item: dict[str, Any], now: float) -> bool:
        exp = item.get("expires_at_s")
        return exp is not None and now >= exp

    def _receipt_rows_locked(self, aid: str, path: str
                             ) -> list[tuple[int, int, str]]:
        cur = self._db.execute(
            "SELECT offset, length, sha256 FROM receipts "
            "WHERE artifact_id=? AND path=? ORDER BY offset",
            (aid, path))
        return [(r["offset"], r["length"], r["sha256"]) for r in cur.fetchall()]

    def _received_locked(self, aid: str, path: str,
                         size: int) -> tuple[int, list[list[int]]]:
        rows = self._receipt_rows_locked(aid, path)
        ranges = _coalesce([(o, o + ln) for o, ln, _ in rows])
        # clamp display to file size; overlong rows are reconciled away
        clamped = _coalesce([(max(0, s), min(size, e)) for s, e in ranges
                             if s < size and e > 0]) if size else []
        received = sum(e - s for s, e in clamped)
        return received, clamped

    # ------------------------------------------------------------ lifecycle
    def init_artifact(self, user_id: str, token_id: str, name: str, kind: str,
                      visibility: str, files_raw: Any,
                      expires_in_s: Any) -> dict[str, Any]:
        self._ensure_open()
        if not isinstance(name, str) or not name or len(name) > 256:
            raise StorageError("bad-envelope", "bad name")
        if visibility not in ("internal", "external", "public"):
            raise StorageError("invalid-visibility", "bad visibility")
        entries, total = D.validate_manifest(files_raw, kind, self._limits())
        ttl = D.validate_ttl_seconds(expires_in_s)
        now = self._now()
        aid = authmod.generate_artifact_id()
        password: Optional[str] = None
        pwd_hash: Optional[str] = None
        if visibility == "external":
            password = authmod.generate_external_password()
            pwd_hash = authmod.sha256_hex(password)
        manifest_json = json.dumps([{"path": e.path, "kind": e.kind,
                                     **({"size": e.size, "sha256": e.sha256}
                                        if e.kind == "file" else {})}
                                    for e in entries])
        now_s = float(int(now))  # created_at ordering ticks in whole seconds
        created_at = D.format_time(now_s)
        expires_at = D.format_time(now + ttl) if ttl is not None else None
        expires_at_s = (now + ttl) if ttl is not None else None
        # R8: row visibility and filesystem lifecycle share one exclusion:
        # directories/zero-byte files are staged first, then the row (with
        # its quota reservation) is committed; any failure unwinds both so
        # no exposed row lacks storage and no failure leaves orphans.
        with self._lock:
            self._ensure_open()
            # R13: fresh staging trees are built descriptor-relatively; a
            # pre-existing symlink anywhere in the fresh namespace aborts.
            with _resolve_parent(self.data_dir, ["staging", aid, "tree"],
                                 create=True, expected=self._root_id):
                pass
            for entry in entries:
                parts = entry.path.split("/")
                if entry.kind == "dir":
                    with _resolve_parent(
                            self.data_dir, ["staging", aid, "tree"] + parts,
                            create=True, expected=self._root_id):
                        pass
                    continue
                with _resolve_parent(
                        self.data_dir,
                        ["staging", aid, "tree"] + parts[:-1],
                        create=True, expected=self._root_id) as (parent_fd, fds):
                    if entry.size == 0:
                        # R10: zero-byte files exist as real files from init.
                        try:
                            fd = os.open(parts[-1],
                                         os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                         | _O_NOFOLLOW, 0o600,
                                         dir_fd=parent_fd)
                        except FileExistsError as exc:
                            raise StorageError("invalid-path",
                                               "staging collision") from exc
                        except OSError as exc:
                            raise StorageError("invalid-path",
                                               "bad staging file") from exc
                        try:
                            os.fsync(fd)
                        finally:
                            _close_fd(fd)
                        os.fsync(parent_fd)
                        os.fsync(fds[3])
            inserted = False
            try:
                self._db.execute("BEGIN IMMEDIATE")
                try:
                    cur = self._db.execute(
                        "SELECT COALESCE(SUM(reserved_bytes),0) "
                        "FROM artifacts")
                    reserved = cur.fetchone()[0] or 0
                    if reserved + total > self._quota:
                        raise StorageError("quota-exceeded",
                                           "storage quota hit")
                    cur = self._db.execute(
                        "SELECT COUNT(*) FROM artifacts WHERE state IN "
                        "('uploading','publishing')")
                    if cur.fetchone()[0] >= self._max_sess_global:
                        raise StorageError("session-limit",
                                           "global session cap")
                    cur = self._db.execute(
                        "SELECT COUNT(*) FROM artifacts WHERE state IN "
                        "('uploading','publishing') AND created_by_user=?",
                        (user_id,))
                    if cur.fetchone()[0] >= self._max_sess_user:
                        raise StorageError("session-limit",
                                           "user session cap")
                    self._db.execute(
                        "INSERT INTO artifacts(id,name,kind,visibility,"
                        "created_by_user,created_by_token,created_at,"
                        "created_at_s,expires_at,expires_at_s,state,"
                        "total_bytes,file_count,reserved_bytes,ext_pwd_hash,"
                        "last_activity_at,manifest_json) "
                        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (aid, name, kind, visibility, user_id, token_id,
                         created_at, now_s, expires_at, expires_at_s,
                         "uploading", total, len(entries), total, pwd_hash,
                         now, manifest_json))
                    self._db.execute("COMMIT")
                    inserted = True
                except Exception:
                    try:
                        self._db.execute("ROLLBACK")
                    except sqlite3.Error:
                        pass
                    raise
                self._write_sidecar(aid, {"artifact_id": aid, "owner": user_id,
                                        "token": token_id, "activity": now,
                                        "manifest": json.loads(manifest_json)})
            except Exception:
                if inserted:
                    try:
                        self._db.execute("DELETE FROM artifacts WHERE id=?",
                                         (aid,))
                    except sqlite3.Error:
                        pass
                self._remove_payload_at("staging", aid)
                self._remove_sidecar(aid)
                raise
            out = self._get_locked(aid)
            assert out is not None
        if password is not None:
            out["external_password"] = password
        return out

    def get_artifact(self, aid: str) -> Optional[dict[str, Any]]:
        self._ensure_open()
        with self._lock:
            self._ensure_open()
            return self._get_locked(aid)

    def list_artifacts(self, limit: int, cursor: str,
                       include_expired: bool,
                       visibility: Optional[str] = None,
                       state: Optional[str] = None
                       ) -> tuple[list[dict[str, Any]], Optional[str]]:
        # A1: cursor/expiry/visibility/state filters apply in SQL and only
        # limit+1 rows (with manifests) are fetched, preserving
        # created_at ASC, id ASC ordering and next_cursor semantics.
        self._ensure_open()
        now = self._now()
        clauses: list[str] = []
        params: list[Any] = []
        if cursor:
            after_created, after_id = D.decode_cursor(cursor)
            after_s = D.parse_time(after_created)
            clauses.append(
                "(created_at_s > ? OR "
                "(created_at_s = ? AND id > ?))")
            params.extend([after_s, after_s, after_id])
        if not include_expired:
            clauses.append("(expires_at_s IS NULL OR expires_at_s > ?)")
            params.append(now)
        if visibility is not None:
            clauses.append("visibility = ?")
            params.append(visibility)
        if state is not None:
            clauses.append("state = ?")
            params.append(state)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        # Bounded fetch: one extra row probes exhaustion without loading
        # the catalog or its manifest_json blobs.
        query = ("SELECT * FROM artifacts" + where +
                 " ORDER BY created_at_s ASC, id ASC LIMIT ?")
        params.append(int(limit) + 1)
        with self._lock:
            self._ensure_open()
            cur = self._db.execute(query, tuple(params))
            items = [_row_to_dict(r) for r in cur.fetchall()]
        has_more = len(items) > limit
        page = items[:limit]
        for item in page:
            item["manifest"] = json.loads(item.pop("manifest_json"))
        if has_more:
            last = page[-1]
            next_cursor: Optional[str] = D.encode_cursor(last["created_at"],
                                                         last["id"])
        else:
            next_cursor = None
        return page, next_cursor

    def delete_artifact(self, aid: str) -> bool:
        self._ensure_open()
        # R8: row deletion and tree removal share the lifecycle exclusion,
        # so a concurrent init can neither resurrect storage for a deleted
        # row nor lose trees for a live one.
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                return False
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("DELETE FROM receipts WHERE artifact_id=?",
                                 (aid,))
                self._db.execute("DELETE FROM one_time_grants "
                                 "WHERE artifact_id=?", (aid,))
                self._db.execute("DELETE FROM content_grants "
                                 "WHERE artifact_id=?", (aid,))
                self._db.execute("DELETE FROM artifacts WHERE id=?", (aid,))
                self._db.execute("COMMIT")
            except Exception:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise
            self._remove_payload_at("live", aid)
            self._remove_payload_at("staging", aid)
            self._remove_sidecar(aid)
            return True

    def patch_artifact(self, user_id: str, aid: str, name: Any = UNSET,
                       visibility: Any = UNSET,
                       expires_in_s: Any = UNSET) -> dict[str, Any]:
        self._ensure_open()
        # R4: validate the COMPLETE input before any side effect, then apply
        # the update together with grant revocations in one transaction.
        if name is not UNSET and \
                (not isinstance(name, str) or not name or len(name) > 256):
            raise StorageError("bad-envelope", "bad name")
        if visibility is not UNSET and \
                visibility not in ("internal", "external", "public"):
            raise StorageError("invalid-visibility", "bad visibility")
        ttl = D.validate_ttl_seconds(expires_in_s) \
            if expires_in_s is not UNSET else UNSET
        now = self._now()
        new_password: Optional[str] = None
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                raise StorageError("not-found", "no such artifact")
            if item["state"] != "ready":
                self._check_owner_locked(item, user_id)
            updates: dict[str, Any] = {}
            revoke = False
            if name is not UNSET:
                updates["name"] = name
            if visibility is not UNSET:
                if visibility != item["visibility"]:
                    if visibility == "external":
                        new_password = authmod.generate_external_password()
                        updates["ext_pwd_hash"] = authmod.sha256_hex(
                            new_password)
                    else:
                        updates["ext_pwd_hash"] = None
                    updates["visibility"] = visibility
                    revoke = True
            if ttl is not UNSET:
                updates["expires_at"] = (D.format_time(now + ttl)
                                           if ttl is not None else None)
                updates["expires_at_s"] = (now + ttl
                                             if ttl is not None else None)
            updates["last_activity_at"] = now
            self._db.execute("BEGIN IMMEDIATE")
            try:
                if updates:
                    assignments = ", ".join("%s=?" % k for k in updates)
                    self._db.execute("UPDATE artifacts SET %s WHERE id=?"
                                     % assignments,
                                     tuple(updates.values()) + (aid,))
                if revoke:
                    self._db.execute("DELETE FROM one_time_grants "
                                     "WHERE artifact_id=?", (aid,))
                    self._db.execute("DELETE FROM content_grants "
                                     "WHERE artifact_id=?", (aid,))
                self._db.execute("COMMIT")
            except Exception:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise
            out = self._get_locked(aid)
            assert out is not None
        if new_password is not None:
            out["external_password"] = new_password
        return out

    def rotate_password(self, aid: str) -> str:
        self._ensure_open()
        password = authmod.generate_external_password()
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                raise StorageError("not-found", "no such artifact")
            if item["visibility"] != "external":
                raise StorageError("invalid-visibility", "not external")
            # R4+R15: update + revocations commit atomically; rotation is
            # NOT an activity event (explicit allowlist).
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("UPDATE artifacts SET ext_pwd_hash=? "
                                 "WHERE id=?",
                                 (authmod.sha256_hex(password), aid))
                self._db.execute("DELETE FROM one_time_grants "
                                 "WHERE artifact_id=?", (aid,))
                self._db.execute("DELETE FROM content_grants "
                                 "WHERE artifact_id=?", (aid,))
                self._db.execute("COMMIT")
            except Exception:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise
        return password

    # ---------------------------------------------------------------- chunks
    def _validate_chunk_range(self, size: int, offset: int, length: int) -> None:
        if length <= 0:
            raise StorageError("invalid-range", "empty chunk")
        if length > self._chunk_bytes:
            raise StorageError("too-large", "chunk exceeds chunk_bytes")
        if offset < 0 or offset + length > size:
            raise StorageError("invalid-range", "chunk outside file")
        if size == 0:
            raise StorageError("invalid-range", "empty file needs no chunks")
        if offset + length < size:
            if length != self._chunk_bytes or offset % self._chunk_bytes != 0:
                raise StorageError("invalid-range", "misaligned chunk")
        else:  # tail chunk
            if size > self._chunk_bytes and offset % self._chunk_bytes != 0:
                raise StorageError("invalid-range", "misaligned tail")
            if size <= self._chunk_bytes and offset != 0:
                raise StorageError("invalid-range", "misaligned tail")

    def put_chunk(self, user_id: str, aid: str, path: str, offset: int,
                  data: bytes, chunk_sha: str) -> dict[str, Any]:
        self._ensure_open()
        if authmod.sha256_hex(data) != chunk_sha.lower():
            raise StorageError("invalid-range", "chunk hash mismatch")
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                raise StorageError("not-found", "no such artifact")
            # F4: incomplete-session ownership precedes state rejection.
            # A non-owner PUT against publishing observes 403 without any
            # recovery effects; the owner proceeds to the 409 below.
            if item["state"] in ("uploading", "publishing"):
                self._check_owner_locked(item, user_id)
            if item["state"] != "uploading":
                raise StorageError("state-conflict", "not uploading")
            wanted = None
            for entry in item["manifest"]:
                if entry["path"] == path and entry["kind"] == "file":
                    wanted = entry
                    break
            if wanted is None:
                raise StorageError("not-found", "unknown path")
            size = wanted["size"]
            self._validate_chunk_range(size, offset, len(data))
            rewrite_only = False
            for off, ln, sha in self._receipt_rows_locked(aid, path):
                if off == offset:
                    if ln == len(data) and sha == chunk_sha.lower():
                        # R11-resumability: a receipt alone does not prove
                        # bytes — verify the covered range first. A duplicate
                        # PUT over lost bytes rewrites them (self-healing)
                        # instead of falsely acknowledging; only verified
                        # bytes take the cheap no-write path.
                        if self._receipt_bytes_valid_at(
                                self.data_dir, aid, path, offset, len(data),
                                chunk_sha.lower(),
                                expected=self._root_id):
                            # R15: an idempotent retry is a successful chunk
                            # PUT: it advances activity like a fresh commit.
                            self._db.execute("UPDATE artifacts SET "
                                             "last_activity_at=? WHERE id=?",
                                             (self._now(), aid))
                            received, _ = self._received_locked(aid, path,
                                                               size)
                            return {"path": path, "offset": offset,
                                    "length": len(data),
                                    "received_bytes": received}
                        rewrite_only = True
                        break  # receipt kept (sha is content-correct); bytes
                        # are rewritten below without a duplicate INSERT.
                    raise StorageError("chunk-conflict",
                                       "conflicting bytes at offset")
            # R13: rooted descriptor-relative write — the staging chain is
            # opened component-wise without following symlinks, and the leaf
            # is written positionally (pwrite) via its own fd.
            rel_parts = path.split("/")
            leaf = rel_parts[-1]
            try:
                with _resolve_parent(
                        self.data_dir,
                        ["staging", aid, "tree"] + rel_parts[:-1],
                        create=True, expected=self._root_id) as (parent_fd, fds):
                    try:
                        fd = os.open(leaf, os.O_RDWR | _O_NOFOLLOW,
                                     dir_fd=parent_fd)
                        fresh_file = False
                    except FileNotFoundError:
                        fd = os.open(leaf,
                                     os.O_RDWR | os.O_CREAT | os.O_EXCL
                                     | _O_NOFOLLOW, 0o600, dir_fd=parent_fd)
                        fresh_file = True
                    except OSError as exc:
                        raise StorageError("invalid-path",
                                           "bad payload target") from exc
                    try:
                        st = os.fstat(fd)
                        if not _stat.S_ISREG(st.st_mode):
                            raise StorageError("invalid-path",
                                               "bad payload target")
                        # (1) POSITIONAL bytes (pwrite: no seek/append games),
                        # (2) fsync file + parent (+ tree root when fresh).
                        view = memoryview(data)
                        written = 0
                        while written < len(view):
                            n = os.pwrite(fd, view[written:],
                                          offset + written)
                            if n <= 0:
                                raise OSError("short chunk write")
                            written += n
                        os.fsync(fd)
                    except OSError as exc:
                        raise StorageError("unavailable",
                                           "chunk write failed") from exc
                    finally:
                        _close_fd(fd)
                    os.fsync(parent_fd)
                    if fresh_file:
                        os.fsync(fds[3])  # staging/<aid>/tree root
            except StorageError:
                raise
            except OSError as exc:
                raise StorageError("unavailable",
                                   "chunk write failed") from exc
            self._db.execute("BEGIN IMMEDIATE")
            try:
                if not rewrite_only:
                    self._insert_receipt(aid, path, offset, len(data),
                                         chunk_sha.lower())
                self._db.execute("UPDATE artifacts SET last_activity_at=? "
                                 "WHERE id=?", (self._now(), aid))
                self._db.execute("COMMIT")
            except StorageError:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise
            except sqlite3.Error as exc:
                # R11: receipt-commit failure keeps resumable chunk state
                # and reports a sanitized 503 (bytes stay for safe retry).
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise StorageError("unavailable",
                                   "receipt commit failed") from exc
            received, _ = self._received_locked(aid, path, size)
            # (5) respond only after the receipt commit (caller sends 200).
            return {"path": path, "offset": offset, "length": len(data),
                    "received_bytes": received}

    def _insert_receipt(self, aid: str, path: str, offset: int, length: int,
                        sha: str) -> None:
        """Separate seam so tests can fault-inject the receipt commit."""
        self._db.execute(
            "INSERT INTO receipts(artifact_id,path,offset,length,"
            "sha256) VALUES(?,?,?,?,?)", (aid, path, offset, length, sha))

    @staticmethod
    @contextlib.contextmanager
    def _payload_leaf(data_dir: str, prefix: list[str], rel: str,
                      write: bool = False, expected: Any = None
                      ) -> Iterator[tuple[int, int]]:
        """R13: open one payload leaf via a rooted no-follow chain.
        Yields (leaf_fd, parent_fd); every fd closes on exit. Raises
        StorageError(not-found/invalid-path) without touching external
        targets, even if a parent is replaced mid-operation."""
        parts = rel.split("/")
        with _resolve_parent(data_dir, prefix + parts[:-1],
                             create=False,
                             expected=expected) as (parent_fd, _fds):
            flags = (os.O_RDWR if write else os.O_RDONLY) | _O_NOFOLLOW
            try:
                fd = os.open(parts[-1], flags, dir_fd=parent_fd)
            except FileNotFoundError as exc:
                raise StorageError("not-found", "no such file") from exc
            except OSError as exc:
                raise StorageError("invalid-path",
                                   "bad payload leaf") from exc
            try:
                st = os.fstat(fd)
            except OSError as exc:
                _close_fd(fd)
                raise StorageError("invalid-path",
                                   "bad payload leaf") from exc
            if not _stat.S_ISREG(st.st_mode):
                _close_fd(fd)
                raise StorageError("not-found", "no such file")
            try:
                yield fd, parent_fd
            finally:
                _close_fd(fd)

    @classmethod
    def _receipt_bytes_valid_at(cls, data_dir: str, aid: str, rel: str,
                                offset: int, length: int, sha: str,
                                expected: Any = None) -> bool:
        """True iff the staged bytes exactly match the receipt checksum."""
        try:
            with cls._payload_leaf(data_dir, ["staging", aid, "tree"],
                                    rel,
                                    expected=expected) as (fd, _parent):
                got = os.pread(fd, length, offset)
        except (StorageError, OSError):
            return False
        if len(got) != length:
            return False
        return hashlib.sha256(got).hexdigest() == sha

    def upload_status(self, aid: str) -> dict[str, Any]:
        self._ensure_open()
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                raise StorageError("not-found", "no such artifact")
            files = []
            for entry in item["manifest"]:
                if entry["kind"] != "file":
                    continue
                received, ranges = self._received_locked(aid, entry["path"],
                                                         entry["size"])
                files.append({"path": entry["path"], "size": entry["size"],
                              "received_bytes": received,
                              "received_ranges": ranges})
            return {"artifact_id": aid, "state": item["state"],
                    "files": files}

    # ---------------------------------------------------------------- publish
    def _assert_clean_at(self, dirfd: int) -> None:
        """R13: recursive no-follow topology gate over an open dir fd."""
        try:
            names = os.listdir(dirfd)
        except OSError as exc:
            raise StorageError("invalid-path", "bad payload root") from exc
        for name in names:
            try:
                st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
            except OSError as exc:
                raise StorageError("invalid-path",
                                   "unreadable payload entry") from exc
            if _stat.S_ISLNK(st.st_mode):
                raise StorageError("invalid-path", "symlink in payload")
            if _stat.S_ISDIR(st.st_mode):
                try:
                    child = os.open(name, os.O_RDONLY | _O_NOFOLLOW
                                    | _O_DIRECTORY, dir_fd=dirfd)
                except OSError as exc:
                    raise StorageError("invalid-path",
                                       "bad payload dir") from exc
                try:
                    self._assert_clean_at(child)
                finally:
                    _close_fd(child)
            elif not _stat.S_ISREG(st.st_mode):
                raise StorageError("invalid-path",
                                   "special file in payload")

    def _payload_complete(self, prefix: list[str],
                          item: dict[str, Any]) -> bool:
        """R10+R13: rooted no-follow completeness — root opens as a real
        directory; every file present at exact size, every declared
        directory present as a real directory."""
        try:
            with _resolve_parent(self.data_dir, prefix, expected=self._root_id) as (root_fd, _fds):
                for entry in item["manifest"]:
                    parts = entry["path"].split("/")
                    cursor = root_fd
                    owned: list[int] = []
                    try:
                        for comp in parts[:-1]:
                            cursor = _open_child_dir(cursor, comp)
                            owned.append(cursor)
                        st = _stat_child(cursor, parts[-1])
                    except StorageError:
                        for fd in reversed(owned):
                            _close_fd(fd)
                        return False
                    for fd in reversed(owned):
                        _close_fd(fd)
                    if entry["kind"] == "dir":
                        if not _stat.S_ISDIR(st.st_mode):
                            return False
                    elif not _stat.S_ISREG(st.st_mode) or \
                            st.st_size != entry["size"]:
                        return False
        except StorageError:
            return False
        return True

    def _staging_complete_locked(self, item: dict[str, Any]) -> bool:
        return self._payload_complete(["staging", item["id"], "tree"],
                                      item)

    def _live_complete(self, item: dict[str, Any]) -> bool:
        return self._payload_complete(["live", item["id"]], item)

    def _verify_hashes(self, item: dict[str, Any], root: str) -> bool:
        # NOTE: root is the legacy path form; resolved below without
        # following symlinks. New callers prefer _verify_hashes_at.
        prefix = os.path.relpath(root, self.data_dir).split(os.sep)
        return self._verify_hashes_at(item, prefix)

    def _verify_hashes_at(self, item: dict[str, Any],
                          prefix: list[str]) -> bool:
        # R13: no-follow topology gate before any byte is hashed.
        try:
            with _resolve_parent(self.data_dir, prefix, expected=self._root_id) as (root_fd, _fds):
                self._assert_clean_at(root_fd)
        except StorageError:
            return False
        for entry in item["manifest"]:
            if entry["kind"] != "file":
                continue
            # R10: missing files never pass, even when size is zero.
            try:
                with self._payload_leaf(self.data_dir, prefix,
                                         entry["path"], expected=self._root_id) as (fd, _parent):
                    digest = hashlib.sha256()
                    with os.fdopen(os.dup(fd), "rb") as fh:
                        for block in iter(lambda: fh.read(1 << 20), b""):
                            digest.update(block)
            except (StorageError, OSError):
                return False
            if digest.hexdigest() != entry["sha256"]:
                return False
        for entry in item["manifest"]:
            if entry["kind"] != "dir":
                continue
            parts = entry["path"].split("/")
            try:
                with _resolve_parent(self.data_dir,
                                     prefix + parts[:-1], expected=self._root_id) as (parent_fd, _fds):
                    st = _stat_child(parent_fd, parts[-1])
            except StorageError:
                return False
            if not _stat.S_ISDIR(st.st_mode):
                return False
        return True

    def _fsync_tree_fd(self, dirfd: int) -> None:
        """R13: fsync a payload tree through open fds (no path follows)."""
        for name in os.listdir(dirfd):
            try:
                st = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
            except OSError as exc:
                raise StorageError("invalid-path",
                                   "bad payload entry") from exc
            if _stat.S_ISLNK(st.st_mode) or \
                    not (_stat.S_ISDIR(st.st_mode)
                         or _stat.S_ISREG(st.st_mode)):
                raise StorageError("invalid-path", "bad payload entry")
            if _stat.S_ISDIR(st.st_mode):
                child = _open_child_dir(dirfd, name)
                try:
                    self._fsync_tree_fd(child)
                finally:
                    _close_fd(child)
            else:
                try:
                    fd = os.open(name, os.O_RDONLY | _O_NOFOLLOW,
                                 dir_fd=dirfd)
                except OSError as exc:
                    raise StorageError("invalid-path",
                                       "bad payload entry") from exc
                try:
                    os.fsync(fd)
                finally:
                    _close_fd(fd)
        os.fsync(dirfd)

    def _finish_publish_locked(self, item: dict[str, Any]) -> None:
        aid = item["id"]
        # R13: every step descriptor-relative — parents pinned via open
        # fds, rename via src/dst dir fds, no path races.
        with _resolve_parent(self.data_dir, [], expected=self._root_id) as (data_fd, _data_fds):
            with _resolve_parent(self.data_dir,
                                 ["staging", aid], expected=self._root_id) as (staging_aid_fd, _f1):
                with _resolve_parent(self.data_dir,
                                     ["live"], expected=self._root_id) as (live_fd, _f2):
                    tree_fd = _open_child_dir(staging_aid_fd, "tree")
                    try:
                        # never publish through symlinks; then fsync.
                        self._assert_clean_at(tree_fd)
                        self._fsync_tree_fd(tree_fd)
                    finally:
                        _close_fd(tree_fd)
                    try:
                        live_st = os.stat(aid, dir_fd=live_fd,
                                          follow_symlinks=False)
                        live_present = _stat.S_ISDIR(live_st.st_mode) \
                            and not _stat.S_ISLNK(live_st.st_mode)
                    except OSError:
                        live_present = False
                    if live_present:
                        if self._live_complete(item):
                            pass
                        else:
                            _rmtree_at(live_fd, aid)
                            os.rename("tree", aid,
                                      src_dir_fd=staging_aid_fd,
                                      dst_dir_fd=live_fd)
                    else:
                        # Absent, or a symlink/non-dir squatting the live
                        # name (_rmtree_at unlinks links themselves).
                        _rmtree_at(live_fd, aid)
                        os.rename("tree", aid, src_dir_fd=staging_aid_fd,
                                  dst_dir_fd=live_fd)
                    self._fire_failpoint("after_rename")
                    self._fire_failpoint("fsync_live_dir")
                    os.fsync(live_fd)
                    self._fire_failpoint("fsync_data_dir")
                    os.fsync(data_fd)
        self._fire_failpoint("before_ready_commit")
        self._db.execute("BEGIN IMMEDIATE")
        try:
            self._db.execute("UPDATE artifacts SET state='ready' WHERE id=?",
                             (aid,))
            self._db.execute("DELETE FROM receipts WHERE artifact_id=?",
                             (aid,))
            self._fire_failpoint("ready_commit")
            self._db.execute("COMMIT")
        except Exception:
            try:
                self._db.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        self._remove_sidecar(aid)
        self._remove_payload_at("staging", aid)

    def _fsync_live_parents(self, aid: str) -> None:
        """R11-durability: fsync the live tree, live dir, and data dir
        through pinned fds before any recovered ready commit. Failpoints
        fire at the actual parent-fsync operations (live/ then data_dir,
        matching _finish_publish_locked order before the ready COMMIT)."""
        with _resolve_parent(self.data_dir, ["live", aid], expected=self._root_id) as (live_aid_fd,
                                                                 _f1):
            self._fsync_tree_fd(live_aid_fd)
            os.fsync(live_aid_fd)
        with _resolve_parent(self.data_dir, ["live"], expected=self._root_id) as (live_fd, _f2):
            self._fire_failpoint("fsync_live_dir")
            os.fsync(live_fd)
        with _resolve_parent(self.data_dir, [], expected=self._root_id) as (data_fd, _f3):
            self._fire_failpoint("fsync_data_dir")
            os.fsync(data_fd)

    def _recover_publishing_locked(self, item: dict[str, Any]) -> str:
        """R11: resolve a publishing row inline (no restart needed).
        Returns the resolved state: ready, uploading, or publishing."""
        aid = item["id"]
        if self._live_complete(item):
            # Durability first: a recovered ready commit requires the same
            # parent fsyncs as the live path; failure keeps the recoverable
            # publishing mark instead of acknowledging early.
            try:
                self._fsync_live_parents(aid)
            except (StorageError, OSError, sqlite3.Error):
                return "publishing"
            self._db.execute("BEGIN IMMEDIATE")
            try:
                self._db.execute("UPDATE artifacts SET state='ready' "
                                 "WHERE id=?", (aid,))
                self._db.execute("DELETE FROM receipts WHERE artifact_id=?",
                                 (aid,))
                self._fire_failpoint("ready_commit")
                self._db.execute("COMMIT")
            except Exception:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                return "publishing"
            self._remove_sidecar(aid)
            self._remove_payload_at("staging", aid)
            return "ready"
        if self._staging_complete_locked(item) and \
                self._verify_hashes(item, self._staging_tree(aid)):
            try:
                self._finish_publish_locked(item)
            except (StorageError, OSError, sqlite3.Error):
                return "publishing"
            return "ready"
        try:
            self._ensure_staging_topology(item)
        except StorageError:
            pass
        # R11-resumability: reconcile receipts against actual bytes before
        # yielding uploading, so duplicate PUTs cannot ack lost payloads.
        for entry in item["manifest"]:
            if entry["kind"] == "file":
                self._reconcile_file_receipts(aid, entry)
        try:
            self._db.execute("UPDATE artifacts SET state='uploading' "
                             "WHERE id=?", (aid,))
        except sqlite3.Error:
            return "publishing"
        return "uploading"

    def publish(self, user_id: str, aid: str) -> dict[str, Any]:
        self._ensure_open()
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                raise StorageError("not-found", "no such artifact")
            if item["state"] == "ready":
                return item  # idempotent
            # F4: incomplete-session ownership precedes ANY recovery or
            # publication effect — a non-owner never triggers recovery and
            # observes 403 session-not-owned, with state preserved.
            self._check_owner_locked(item, user_id)
            if item["state"] == "publishing":
                # F4+R11: an owner request encountering publishing is
                # 409 state-conflict even when authorized recovery
                # prepares the subsequent retry. Run recovery for its
                # side-effects (may commit ready or revert to uploading
                # so the next retry succeeds), then always raise 409.
                try:
                    self._recover_publishing_locked(item)
                except (StorageError, OSError, sqlite3.Error):
                    pass
                raise StorageError("state-conflict",
                                   "publish in progress")
            if item["state"] != "uploading":
                raise StorageError("state-conflict", "bad state")
            # (P1) read-only hash verification. On mismatch, rebuild
            # topology and reconcile receipts first so the failure is
            # self-healing: status turns truthful and re-uploads rewrite
            # exactly the missing ranges.
            if not self._verify_hashes(item, self._staging_tree(aid)):
                try:
                    self._ensure_staging_topology(item)
                except StorageError:
                    pass
                for entry in item["manifest"]:
                    if entry["kind"] == "file":
                        self._reconcile_file_receipts(aid, entry)
                raise StorageError("hash-mismatch", "payload hash mismatch")
            # (P2) durable publishing mark.
            self._db.execute("BEGIN IMMEDIATE")
            try:
                cur = self._db.execute("SELECT state FROM artifacts "
                                       "WHERE id=?", (aid,))
                if cur.fetchone()["state"] != "uploading":
                    self._db.execute("ROLLBACK")
                    raise StorageError("state-conflict", "raced publish")
                self._db.execute("UPDATE artifacts SET state='publishing' "
                                 "WHERE id=?", (aid,))
                self._db.execute("COMMIT")
            except StorageError:
                raise
            except Exception as exc:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise StorageError("unavailable",
                                   "publish not started") from exc
            # (P3)-(P6); R11: a catchable failure is classified by the
            # actual filesystem/DB window (never a blind revert): a complete
            # live tree stays publishing so retry/restart finishes it;
            # otherwise the row returns to uploading with a rebuilt staging
            # topology. Uncatchable crashes keep the durable mark for
            # startup reconciliation.
            try:
                self._finish_publish_locked(item)
            except (StorageError, OSError, sqlite3.Error) as exc:
                self._settle_publish_failure(aid, exc)
            try:
                self._db.execute("UPDATE artifacts SET last_activity_at=? "
                                 "WHERE id=?", (self._now(), aid))
            except sqlite3.Error:
                pass
            out = self._get_locked(aid)
            assert out is not None
            return out

    def _settle_publish_failure(self, aid: str,
                                exc: BaseException) -> dict[str, Any]:
        """R11: classify a (P3)-(P6) failure by its real window. Always
        raises: StorageError(unavailable) for operational faults (retry or
        restart resolves), or the original domain fault for topology/hash
        problems. Never returns normally."""
        item = self._get_locked(aid)
        if item is None:
            raise StorageError("not-found", "no such artifact")
        if isinstance(exc, StorageError) and exc.code in (
                "invalid-path", "hash-mismatch"):
            # Payload/topology faults: resumable uploading, original code.
            try:
                self._ensure_staging_topology(item)
            except StorageError:
                pass
            for entry in item["manifest"]:
                if entry["kind"] == "file":
                    self._reconcile_file_receipts(aid, entry)
            try:
                self._db.execute("UPDATE artifacts SET state='uploading' "
                                 "WHERE id=? AND state='publishing'", (aid,))
            except sqlite3.Error:
                pass
            raise exc
        if self._live_complete(item):
            # Post-rename window: the publication is complete on disk;
            # keep the durable mark so retry/restart commits ready.
            raise StorageError("unavailable",
                               "publish interrupted") from exc
        # Pre-rename window: back to uploading with genuinely resumable
        # topology and truthful receipts (verified duplicate PUTs below
        # cannot ack lost payloads).
        try:
            self._ensure_staging_topology(item)
        except StorageError:
            pass
        for entry in item["manifest"]:
            if entry["kind"] == "file":
                self._reconcile_file_receipts(aid, entry)
        try:
            self._db.execute("UPDATE artifacts SET state='uploading' "
                             "WHERE id=? AND state='publishing'", (aid,))
        except sqlite3.Error:
            pass
        raise StorageError("unavailable",
                           "publish interrupted") from exc

    def _revert_to_uploading(self, aid: str) -> None:
        try:
            self._db.execute("UPDATE artifacts SET state='uploading' "
                             "WHERE id=? AND state='publishing'", (aid,))
        except sqlite3.Error:
            pass

    # ---------------------------------------------------------------- grants
    # R3: every grant carries a revocable, non-plaintext credential
    # association (dashboard user/token digest for internal handoffs,
    # password-hash snapshot for external unlocks). Reads and redemption
    # revalidate the binding against live credentials; logout revokes the
    # server-side records without touching the static bearer token.
    def create_one_time_grant(self, aid: str, principal: str, user_id: str,
                              token_id: str, token_digest: str) -> str:
        self._ensure_open()
        grant = authmod.generate_grant()
        with self._lock:
            self._ensure_open()
            if self._get_locked(aid) is None:
                raise StorageError("not-found", "no such artifact")
            self._db.execute(
                "INSERT INTO one_time_grants(grant_hash,artifact_id,"
                "principal,expires_at,user_id,token_id,token_digest) "
                "VALUES(?,?,?,?,?,?,?)",
                (authmod.sha256_hex(grant), aid, principal,
                 self._now() + self._otg_ttl, user_id, token_id,
                 token_digest))
        return grant

    def consume_one_time_grant(self, grant: str, aid: str) -> str:
        self._ensure_open()
        """Legacy split redeem (tests only); server uses redeem_handoff."""
        with self._lock:
            self._ensure_open()
            return self._consume_locked(grant, aid)["principal"]

    def _consume_locked(self, grant: str, aid: str) -> dict[str, Any]:
        now = self._now()
        cur = self._db.execute("SELECT * FROM one_time_grants "
                               "WHERE grant_hash=?",
                               (authmod.sha256_hex(grant),))
        row = cur.fetchone()
        if row is None or row["artifact_id"] != aid or row["used"]:
            raise KeyError("grant-invalid")
        if now >= row["expires_at"]:
            self._db.execute("DELETE FROM one_time_grants "
                             "WHERE grant_hash=?",
                             (authmod.sha256_hex(grant),))
            raise KeyError("grant-expired")
        self._db.execute("UPDATE one_time_grants SET used=1 "
                         "WHERE grant_hash=?",
                         (authmod.sha256_hex(grant),))
        return _row_to_dict(row)

    def redeem_handoff(self, aid: str, grant: str,
                       credential_live: Callable[[str, str, str], bool]
                       ) -> tuple[str, float]:
        self._ensure_open()
        """R3+R4: consume a one-time handoff and issue the bound content
        grant atomically: artifact eligibility, credential liveness,
        consumption, and issuance share one lock hold, so rotation or a
        visibility change cannot interleave."""
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None:
                raise StorageError("not-found", "no such artifact")
            if self.is_expired(item, self._now()):
                raise StorageError("expired", "artifact expired")
            if item["visibility"] != "internal" or item["state"] != "ready":
                raise StorageError("invalid-visibility", "not grantable")
            record = self._consume_locked(grant, aid)
            user_id = record.get("user_id") or ""
            token_id = record.get("token_id") or ""
            digest = record.get("token_digest") or ""
            if not user_id or not credential_live(user_id, token_id, digest):
                raise KeyError("grant-invalid")
            return self._issue_content_locked(
                aid, user_id, token_id, digest, None)

    def unlock_with_password(self, aid: str, candidate: str
                             ) -> Optional[tuple[str, float]]:
        self._ensure_open()
        """R4: verify the external password and issue the bound content
        grant atomically. A concurrent rotation can only order fully
        before (new password required) or fully after (grant revoked by
        the rotation itself) — never verify-old then issue-new."""
        if not candidate:
            return None
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            if item is None or item["visibility"] != "external" \
                    or item["state"] != "ready":
                return None
            if item["ext_pwd_hash"] is None:
                return None
            if self.is_expired(item, self._now()):
                return None
            if not authmod.verify_hash(candidate, item["ext_pwd_hash"]):
                return None
            return self._issue_content_locked(aid, None, None, None,
                                              item["ext_pwd_hash"])

    def _issue_content_locked(self, aid: str, user_id: Optional[str],
                              token_id: Optional[str],
                              token_digest: Optional[str],
                              pwd_hash: Optional[str]
                              ) -> tuple[str, float]:
        now = self._now()
        item = self._get_locked(aid)
        assert item is not None
        expiry = now + self._grant_ttl
        if item["expires_at_s"] is not None:
            expiry = min(expiry, item["expires_at_s"])
        value = authmod.generate_content_grant()
        self._db.execute(
            "INSERT INTO content_grants(grant_hash,artifact_id,expires_at,"
            "created_at,user_id,token_id,token_digest,pwd_hash) "
            "VALUES(?,?,?,?,?,?,?,?)",
            (authmod.sha256_hex(value), aid, expiry, now, user_id, token_id,
             token_digest, pwd_hash))
        cur = self._db.execute(
            "SELECT grant_hash FROM content_grants WHERE artifact_id=? "
            "ORDER BY created_at ASC", (aid,))
        hashes = [r["grant_hash"] for r in cur.fetchall()]
        if len(hashes) > self._max_grants:
            for stale in hashes[:len(hashes) - self._max_grants]:
                self._db.execute("DELETE FROM content_grants "
                                 "WHERE grant_hash=?", (stale,))
        return value, expiry

    def lookup_content_grant(self, cookie_value: str,
                             aid: str) -> Optional[dict[str, Any]]:
        self._ensure_open()
        """Fetch a live grant record (artifact match + expiry only).
        The caller revalidates the credential binding against live
        provisioned credentials (R3)."""
        with self._lock:
            self._ensure_open()
            cur = self._db.execute("SELECT * FROM content_grants "
                                   "WHERE grant_hash=?",
                                   (authmod.sha256_hex(cookie_value),))
            row = cur.fetchone()
            if row is None or row["artifact_id"] != aid:
                return None
            if self._now() >= row["expires_at"]:
                self._db.execute("DELETE FROM content_grants "
                                 "WHERE grant_hash=?",
                                 (authmod.sha256_hex(cookie_value),))
                return None
            return _row_to_dict(row)

    def validate_content_grant(self, cookie_value: str, aid: str) -> bool:
        return self.lookup_content_grant(cookie_value, aid) is not None

    def delete_content_grant(self, cookie_value: str) -> None:
        self._ensure_open()
        with self._lock:
            self._ensure_open()
            self._db.execute("DELETE FROM content_grants WHERE grant_hash=?",
                             (authmod.sha256_hex(cookie_value),))

    def revoke_credential_grants(self, user_id: str, token_id: str) -> None:
        self._ensure_open()
        """Revoke one-time + content grants of one credential (logout).
        The static bearer token itself is untouched."""
        with self._lock:
            self._ensure_open()
            self._db.execute("DELETE FROM one_time_grants "
                             "WHERE user_id=? AND token_id=?",
                             (user_id, token_id))
            self._db.execute("DELETE FROM content_grants "
                             "WHERE user_id=? AND token_id=?",
                             (user_id, token_id))

    def revoke_artifact_grants(self, aid: str) -> None:
        self._ensure_open()
        with self._lock:
            self._ensure_open()
            self._db.execute("DELETE FROM one_time_grants WHERE artifact_id=?",
                             (aid,))
            self._db.execute("DELETE FROM content_grants WHERE artifact_id=?",
                             (aid,))

    # ---------------------------------------------------------------- sweep
    def sweep(self, _stop: Any = None) -> int:
        self._ensure_open()
        # R7: cooperative cancellation points between units of work so
        # shutdown never waits on a full sweep pass.
        def _halted() -> bool:
            return _stop is not None and _stop.is_set()
        now = self._now()
        removed = 0
        with self._lock:
            self._ensure_open()
            cur = self._db.execute("SELECT * FROM artifacts")
            rows = [_row_to_dict(r) for r in cur.fetchall()]
            for row in rows:
                if _halted():
                    return removed
                expired = (row["expires_at_s"] is not None
                           and now >= row["expires_at_s"])
                idle = (row["state"] in ("uploading", "publishing")
                        and now - row["last_activity_at"] > self._idle_ttl)
                # publishing sessions are publish-crash windows, not idle
                # garbage: only sweep idle *uploading* sessions here.
                if row["state"] == "publishing":
                    idle = False
                if expired or idle:
                    self._db.execute("DELETE FROM receipts WHERE artifact_id=?",
                                     (row["id"],))
                    self._db.execute("DELETE FROM one_time_grants "
                                     "WHERE artifact_id=?", (row["id"],))
                    self._db.execute("DELETE FROM content_grants "
                                     "WHERE artifact_id=?", (row["id"],))
                    self._db.execute("DELETE FROM artifacts WHERE id=?",
                                     (row["id"],))
                    self._remove_payload_at("live", row["id"])
                    self._remove_payload_at("staging", row["id"])
                    self._remove_sidecar(row["id"])
                    removed += 1
            self._db.execute("DELETE FROM one_time_grants "
                             "WHERE expires_at<=?", (now,))
            self._db.execute("DELETE FROM content_grants WHERE expires_at<=?",
                             (now,))
            # R8: the whole sweep holds the lifecycle exclusion, and orphan
            # candidates are revalidated against a fresh row snapshot
            # immediately before deletion, so a concurrent init/publish
            # (serialized on the same lock, cross-process on the claim)
            # can never lose a live tree to a stale snapshot.
            # R13: orphan enumeration is rooted — symlinked staging/live
            # roots are skipped entirely (never traversed into), and every
            # stat/unlink/rmtree is dir-fd-relative (links unlinked, never
            # followed).
            with _scan_root(self.data_dir, "staging", expected=self._root_id) as staging_fd:
                if staging_fd is not None:
                    try:
                        entries = os.listdir(staging_fd)
                    except OSError:
                        entries = []
                    for name in entries:
                        if _halted():
                            return removed
                        cur = self._db.execute("SELECT id FROM artifacts")
                        known = {r["id"] for r in cur.fetchall()}
                        try:
                            st = os.stat(name, dir_fd=staging_fd,
                                          follow_symlinks=False)
                        except OSError:
                            continue
                        if name.endswith(".json"):
                            aid = name[:-5]
                            if aid not in known and \
                                    now - st.st_mtime > self._idle_ttl:
                                try:
                                    os.unlink(name, dir_fd=staging_fd)
                                except FileNotFoundError:
                                    pass
                                else:
                                    removed += 1
                        elif name not in known:
                            if now - st.st_mtime > self._idle_ttl:
                                _rmtree_at(staging_fd, name)
                                removed += 1
            with _scan_root(self.data_dir, "live", expected=self._root_id) as live_fd:
                if live_fd is not None:
                    try:
                        live_entries = os.listdir(live_fd)
                    except OSError:
                        live_entries = []
                    for name in live_entries:
                        if _halted():
                            return removed
                        cur = self._db.execute("SELECT id FROM artifacts")
                        known = {r["id"] for r in cur.fetchall()}
                        if name not in known:
                            _rmtree_at(live_fd, name)
                            removed += 1
            return removed

    # ------------------------------------------------------------ reconcile
    def reconcile(self) -> None:
        self._ensure_open()
        """Map every crash window to ready-or-resumable (§6.2/§6.3)."""
        with self._lock:
            self._ensure_open()
            cur = self._db.execute("SELECT * FROM artifacts")
            rows = [_row_to_dict(r) for r in cur.fetchall()]
            for row in rows:
                row["manifest"] = json.loads(row.pop("manifest_json"))
            for item in rows:
                aid = item["id"]
                # R11: an uploading row that owns a live tree is a lost-P5
                # anomaly — adopt it only if fully verified AND durable:
                # actual live/ + data_dir fsyncs before a transactional
                # ready commit. On fsync/commit failure retain the
                # recoverable uploading (unserved) for a later retry.
                if item["state"] == "uploading" and \
                        os.path.lexists(self._live_dir(aid)):
                    if self._live_complete(item) and \
                            self._verify_hashes(item, self._live_dir(aid)):
                        try:
                            self._fsync_live_parents(aid)
                        except (StorageError, OSError, sqlite3.Error):
                            continue
                        self._db.execute("BEGIN IMMEDIATE")
                        try:
                            self._db.execute(
                                "UPDATE artifacts SET state='ready' "
                                "WHERE id=?", (aid,))
                            self._db.execute("DELETE FROM receipts "
                                             "WHERE artifact_id=?", (aid,))
                            self._fire_failpoint("ready_commit")
                            self._db.execute("COMMIT")
                        except Exception:
                            try:
                                self._db.execute("ROLLBACK")
                            except sqlite3.Error:
                                pass
                            continue
                        self._remove_sidecar(aid)
                        self._remove_payload_at("staging", aid)
                        continue
                    self._remove_payload_at("live", aid)
                    self._db.execute("DELETE FROM receipts WHERE "
                                     "artifact_id=?", (aid,))
                if item["state"] == "uploading":
                    # Tampered topology must not kill startup: the row stays
                    # uploading and unservable until an operator repairs it.
                    try:
                        self._ensure_staging_topology(item)
                    except StorageError:
                        pass
                # §6.2/R1: a receipt is valid only if the staged bytes at
                # its exact range hash-match; anything else is MISSING.
                if item["state"] in ("uploading", "publishing"):
                    for entry in item["manifest"]:
                        if entry["kind"] != "file":
                            continue
                        receipts = self._receipt_rows_locked(aid,
                                                             entry["path"])
                        for off, ln, sha in receipts:
                            if not self._receipt_bytes_valid_at(
                                    self.data_dir, aid, entry["path"],
                                    off, ln, sha,
                                    expected=self._root_id):
                                self._db.execute(
                                    "DELETE FROM receipts WHERE artifact_id=? "
                                    "AND path=? AND offset=?",
                                    (aid, entry["path"], off))
                        receipts = self._receipt_rows_locked(aid,
                                                             entry["path"])
                        max_end = 0
                        for off, ln, _sha in receipts:
                            max_end = max(max_end, off + ln)
                        max_end = min(max_end, entry["size"])
                        # R13: truncate via the no-follow leaf fd; a symlink
                        # anywhere in the chain fails closed and touches
                        # nothing external.
                        try:
                            with self._payload_leaf(
                                    self.data_dir,
                                    ["staging", aid, "tree"],
                                    entry["path"],
                                    write=True,
                                    expected=self._root_id) as (fd, _parent):
                                if os.fstat(fd).st_size > max_end:
                                    os.ftruncate(fd, max_end)
                                    os.fsync(fd)
                        except (StorageError, OSError):
                            pass
                # §6.3 crash-window table (shared with inline recovery).
                if item["state"] == "publishing":
                    fresh = self._get_locked(aid)
                    assert fresh is not None
                    self._recover_publishing_locked(fresh)
                elif item["state"] == "ready":
                    # R13: remnant cleanup relative to the validated staging
                    # root (never through a symlinked parent).
                    try:
                        with _resolve_parent(self.data_dir,
                                           ["staging"], expected=self._root_id) as (staging_fd,
                                                             _fds):
                            try:
                                os.unlink(aid + ".json", dir_fd=staging_fd)
                            except FileNotFoundError:
                                pass
                            _rmtree_at(staging_fd, aid)
                    except StorageError:
                        pass
            # live trees with no artifact row are never served. R9: the
            # enumeration, fresh-row validation, and deletion all stay
            # within lifecycle exclusion and ownership: a close cannot
            # release the claim while this cleanup is active (it blocks on
            # the lock, retaining ownership on timeout), so a successor
            # cannot publish a tree this scan then deletes from a stale set.
            cur = self._db.execute("SELECT id FROM artifacts")
            known = {r["id"] for r in cur.fetchall()}
            with _scan_root(self.data_dir, "live",
                            expected=self._root_id) as live_fd:
                if live_fd is not None:
                    try:
                        live_entries = os.listdir(live_fd)
                    except OSError:
                        live_entries = []
                    for name in live_entries:
                        if name not in known:
                            _rmtree_at(live_fd, name)

    def _ensure_open(self) -> None:
        # Fail-closed use-after-close: never touch a released store.
        if getattr(self, "_closed", False) or self._db is None:
            raise StorageError("unavailable", "store closed")
        # R9: fail closed before any DB/filesystem work if the physical
        # root changed (retargeted alias is harmless via canonical path;
        # a replaced root is detected here and in _resolve_parent).
        if getattr(self, "_root_id", None) is not None:
            self._assert_root_identity()

    def close(self, _timeout: float = 30.0) -> None:
        # Governor R7 invariant: on bounded-shutdown timeout fail fast with
        # a clear error BUT retain claim+storage until workers are safe or
        # the process dies (the OS then releases the socket claim).
        # Ownership is never released while application work can still run.
        locked = self._lock.acquire(timeout=_timeout)
        if not locked:
            raise StorageError("unavailable",
                               "storage busy: close deferred, owner retained")
        try:
            # Idempotent only once fully cleaned up; a failed close below
            # keeps _closed set (admission stays closed) with the handle
            # and claim preserved, so a later close retries cleanup without
            # reopening operation admission.
            if getattr(self, "_closed", False) and self._db is None:
                return
            self._closed = True
            # R9-sqlite-root-lifetime: bind shutdown to the pinned root.
            # Verify (read-only open+fstat, no mutation); on mismatch the
            # OLD handle still closes fd-based below, never resolving the
            # replacement path, so no checkpoint/sidecar cleanup touches B.
            # The PINNED claim digest differs from B, so its release below
            # is safe. No path-based work happens on the mismatch path.
            try:
                self._assert_root_identity()
            except StorageError:
                pass
            if self._db is not None:
                try:
                    self._db.close()
                except sqlite3.Error as exc:
                    # R9-close-failure: preserve the handle and the claim
                    # until database closure is confirmed; report
                    # unavailable so a subsequent close can finish cleanup.
                    raise StorageError(
                        "unavailable",
                        "storage close failed; ownership retained") from exc
                self._db = None
            self._release_claim()
        finally:
            try:
                self._lock.release()
            except RuntimeError:
                pass

    def __enter__(self) -> "ArtifactStore":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # ------------------------------------------------------- test-only hooks
    def _set_state_for_test(self, aid: str, state: str) -> None:
        with self._lock:
            self._ensure_open()
            self._db.execute("UPDATE artifacts SET state=? WHERE id=?",
                             (state, aid))

    def _inject_receipt_for_test(self, aid: str, path: str, offset: int,
                                 length: int, sha: str) -> None:
        with self._lock:
            self._ensure_open()
            self._db.execute(
                "INSERT OR REPLACE INTO receipts(artifact_id,path,offset,"
                "length,sha256) VALUES(?,?,?,?,?)",
                (aid, path, offset, length, sha))

    def _simulate_rename_for_test(self, aid: str) -> None:
        with self._lock:
            self._ensure_open()
            item = self._get_locked(aid)
            assert item is not None
        os.rename(self._staging_tree(aid), self._live_dir(aid))

    def _test_init_artifact(self, aid: str, user_id: str, token_id: str,
                            kind: str, files_raw: Any) -> dict[str, Any]:
        entries, total = D.validate_manifest(files_raw, kind, self._limits())
        now = self._now()
        manifest_json = json.dumps([{"path": e.path, "kind": e.kind,
                                     **({"size": e.size, "sha256": e.sha256}
                                        if e.kind == "file" else {})}
                                    for e in entries])
        with self._lock:
            self._ensure_open()
            self._db.execute(
                "INSERT INTO artifacts(id,name,kind,visibility,"
                "created_by_user,created_by_token,created_at,created_at_s,"
                "expires_at,expires_at_s,state,total_bytes,file_count,"
                "reserved_bytes,ext_pwd_hash,last_activity_at,manifest_json)"
                " VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (aid, "t", kind, "internal", user_id, token_id,
                 D.format_time(float(int(now))), float(int(now)), None, None,
                 "uploading", total, len(entries), total, None, now,
                 manifest_json))
        out = self.get_artifact(aid)
        assert out is not None
        self._ensure_staging_topology(out)
        return out

    def _receipt_tracker_for_test(self, aid: str) -> "_SqliteReceiptView":
        return _SqliteReceiptView(self, aid)


class _SqliteReceiptView:
    """Narrow receipt-tracker view over one artifact (dual-test target)."""

    def __init__(self, store: ArtifactStore, aid: str):
        self._store = store
        self._aid = aid

    def record(self, _aid: str, path: str, offset: int, length: int,
               sha: str) -> None:
        with self._store._lock:
            for off, _ln, existing in self._store._receipt_rows_locked(
                    self._aid, path):
                if off == offset and existing != sha:
                    raise KeyError("conflict")
            self._store._db.execute(
                "INSERT OR IGNORE INTO receipts(artifact_id,path,offset,"
                "length,sha256) VALUES(?,?,?,?,?)",
                (self._aid, path, offset, length, sha))

    def received(self, _aid: str, path: str) -> int:
        with self._store._lock:
            cur = self._store._db.execute(
                "SELECT offset,length FROM receipts WHERE artifact_id=? "
                "AND path=?", (self._aid, path))
            return sum(r["length"] for r in cur.fetchall())

    def ranges(self, _aid: str, path: str) -> list[tuple[int, int]]:
        with self._store._lock:
            cur = self._store._db.execute(
                "SELECT offset,length FROM receipts WHERE artifact_id=? "
                "AND path=? ORDER BY offset", (self._aid, path))
            return [(r["offset"], r["offset"] + r["length"])
                    for r in cur.fetchall()]


class MemoryArtifactStore:
    """In-memory receipt tracker implementing the narrow dual-test interface."""

    def __init__(self) -> None:
        self._rows: dict[tuple[str, str, int], tuple[int, str]] = {}

    def record(self, aid: str, path: str, offset: int, length: int,
               sha: str) -> None:
        key = (aid, path, offset)
        if key in self._rows and self._rows[key][1] != sha:
            raise KeyError("conflict")
        self._rows[key] = (length, sha)

    def received(self, aid: str, path: str) -> int:
        return sum(length for (a, p, _o), (length, _s) in self._rows.items()
                   if a == aid and p == path)

    def ranges(self, aid: str, path: str) -> list[tuple[int, int]]:
        return sorted((off, off + length)
                      for (a, p, off), (length, _s) in self._rows.items()
                      if a == aid and p == path)
