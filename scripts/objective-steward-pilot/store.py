"""Single-document pilot persistence; no inference inside a transaction."""
from dataclasses import dataclass
from pathlib import Path
import sqlite3
from typing import Protocol

MAX_STATE_BYTES = 4 * 1024 * 1024

class Conflict(RuntimeError):
    pass

@dataclass(frozen=True)
class Stored:
    revision: int
    payload: bytes | None

class Store(Protocol):
    def read(self) -> Stored: ...
    def commit(self, expected: int, payload: bytes) -> int: ...
    def close(self) -> None: ...

class MemoryStore:
    def __init__(self):
        self.value = Stored(0, None)

    def read(self) -> Stored:
        return self.value

    def commit(self, expected: int, payload: bytes) -> int:
        if len(payload) > MAX_STATE_BYTES:
            raise ValueError("state bound exceeded")
        if self.value.revision != expected:
            raise Conflict("store revision conflict")
        self.value = Stored(expected + 1, payload)
        return self.value.revision

    def close(self) -> None:
        pass

class SqliteStore:
    def __init__(self, path: Path, access: str):
        if access not in ("read", "write"):
            raise ValueError("invalid store access")
        self.access = access
        if access == "read":
            self.connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5, isolation_level=None)
        else:
            self.connection = sqlite3.connect(path, timeout=5, isolation_level=None)
            self.connection.execute("PRAGMA journal_mode=WAL")
            self.connection.execute("CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload BLOB)")
            self.connection.execute("INSERT OR IGNORE INTO state VALUES (1,0,NULL)")

    def read(self) -> Stored:
        row = self.connection.execute("SELECT revision,payload FROM state WHERE id=1").fetchone()
        if row is None:
            raise RuntimeError("state row missing")
        return Stored(row[0], row[1])

    def commit(self, expected: int, payload: bytes) -> int:
        if len(payload) > MAX_STATE_BYTES:
            raise ValueError("state bound exceeded")
        if self.access != "write":
            raise PermissionError("read-only store")
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            changed = self.connection.execute("UPDATE state SET revision=revision+1,payload=? WHERE id=1 AND revision=?", (payload, expected)).rowcount
            if changed != 1:
                raise Conflict("store revision conflict")
            self.connection.execute("COMMIT")
        except BaseException:
            self.connection.execute("ROLLBACK")
            raise
        return expected + 1

    def close(self) -> None:
        self.connection.close()
