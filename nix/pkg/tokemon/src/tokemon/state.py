"""Cross-process query ledger in the XDG cache directory.

Text files lose the race between two tokemon processes: both read "not queried
yet", both call the endpoint. SQLite's ``BEGIN IMMEDIATE`` is the lock. The
file lives under ``$XDG_CACHE_HOME/tokemon`` when that variable is set,
``~/Library/Caches/tokemon`` on macOS otherwise, and ``~/.cache/tokemon``
everywhere else.
"""

from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Mapping

APP_CACHE_DIR_NAME = "tokemon"
STATE_DB_NAME = "state.sqlite"
CACHE_DIR_MODE = 0o700
STATE_FILE_MODE = 0o600
BUSY_TIMEOUT_MS = 5000
BUSY_TIMEOUT_SECONDS = BUSY_TIMEOUT_MS / 1000


def cache_dir(home: Path, platform: str, environ: Mapping[str, str]) -> Path:
    """Cache directory for this home. An empty ``XDG_CACHE_HOME`` counts as unset."""
    configured = environ.get("XDG_CACHE_HOME")
    if configured:
        return Path(configured) / APP_CACHE_DIR_NAME
    if platform == "darwin":
        return home / "Library" / "Caches" / APP_CACHE_DIR_NAME
    return home / ".cache" / APP_CACHE_DIR_NAME


def state_db_path(home: Path, platform: str, environ: Mapping[str, str]) -> Path:
    return cache_dir(home, platform, environ) / STATE_DB_NAME


def _rollback(connection: sqlite3.Connection) -> None:
    try:
        connection.execute("ROLLBACK")
    except sqlite3.Error:
        pass


def _utc(epoch: float) -> datetime:
    return datetime.fromtimestamp(epoch, tz=timezone.utc)


@dataclass(frozen=True)
class Claim:
    """Result of trying to take the next query slot for one endpoint and credential.

    ``proceed`` is true for the single caller that may hit the network. ``body``
    is the last HTTP 200, if one was stored. ``next_allowed_at`` is when another
    query becomes legal.
    """

    proceed: bool
    body: bytes | None
    next_allowed_at: datetime


class QueryLedger:
    """Last-query timestamps and the last successful response, keyed by endpoint
    and a hash of the credential — never the credential itself."""

    def __init__(self, path: Path, interval: timedelta) -> None:
        self._path = path
        self._interval = interval
        self._connect().close()

    def try_claim(self, endpoint: str, credential_key: str, now: datetime) -> Claim:
        """Reserve the slot if the previous query is old enough. The reservation
        is committed before the caller hits the network, so a second process
        blocks in ``BEGIN IMMEDIATE`` and then sees the reservation."""
        next_allowed = now + self._interval
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT next_allowed_at, body FROM endpoint_queries WHERE endpoint = ? AND credential_key = ?",
                (endpoint, credential_key),
            ).fetchone()
            if row is not None and _utc(row["next_allowed_at"]) > now:
                connection.execute("COMMIT")
                return Claim(proceed=False, body=row["body"], next_allowed_at=_utc(row["next_allowed_at"]))
            previous = row["body"] if row is not None else None
            connection.execute(
                """
                INSERT INTO endpoint_queries (endpoint, credential_key, queried_at, next_allowed_at, status, body)
                VALUES (?, ?, ?, ?, NULL, ?)
                ON CONFLICT (endpoint, credential_key) DO UPDATE SET
                    queried_at = excluded.queried_at,
                    next_allowed_at = excluded.next_allowed_at
                """,
                (endpoint, credential_key, now.timestamp(), next_allowed.timestamp(), previous),
            )
            connection.execute("COMMIT")
        except BaseException:
            _rollback(connection)
            raise
        finally:
            connection.close()
        return Claim(proceed=True, body=previous, next_allowed_at=next_allowed)

    def record(
        self,
        endpoint: str,
        credential_key: str,
        status: int,
        body: bytes | None,
        next_allowed_at: datetime,
        now: datetime,
    ) -> None:
        """Store the outcome. A non-200 does not replace a previously stored 200 body."""
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            previous = connection.execute(
                "SELECT body FROM endpoint_queries WHERE endpoint = ? AND credential_key = ?",
                (endpoint, credential_key),
            ).fetchone()
            kept = body if status == 200 and body else (previous["body"] if previous is not None else None)
            connection.execute(
                """
                INSERT INTO endpoint_queries (endpoint, credential_key, queried_at, next_allowed_at, status, body)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (endpoint, credential_key) DO UPDATE SET
                    queried_at = excluded.queried_at,
                    next_allowed_at = excluded.next_allowed_at,
                    status = excluded.status,
                    body = excluded.body
                """,
                (endpoint, credential_key, now.timestamp(), next_allowed_at.timestamp(), status, kept),
            )
            connection.execute("COMMIT")
        except BaseException:
            _rollback(connection)
            raise
        finally:
            connection.close()

    def _connect(self) -> sqlite3.Connection:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        os.chmod(self._path.parent, CACHE_DIR_MODE)
        connection = sqlite3.connect(self._path, timeout=BUSY_TIMEOUT_SECONDS, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS endpoint_queries (
                endpoint TEXT NOT NULL,
                credential_key TEXT NOT NULL,
                queried_at REAL NOT NULL,
                next_allowed_at REAL NOT NULL,
                status INTEGER,
                body BLOB,
                PRIMARY KEY (endpoint, credential_key)
            )
            """
        )
        os.chmod(self._path, STATE_FILE_MODE)
        return connection
