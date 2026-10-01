"""Refresh expired pi OAuth access tokens and write them back to ``auth.json``.

Refresh tokens can be single-use, so a refreshed token pair must be persisted
where pi reads it, under the lock pi itself takes for the same operation.  pi
guards ``auth.json`` with proper-lockfile: the lock is the directory
``auth.json.lock``, created with mkdir; its holder keeps the directory's mtime
fresh, and a lock whose mtime is older than the stale threshold may be removed
and retaken (pi 0.99.1 core/auth-storage.js: 30 s for its async refresh path,
proper-lockfile's 10 s default for its sync writers).
"""

from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Mapping, Protocol

from tokemon.credentials import Credential, CredentialError, CredentialStore, credential_from_pi_entry
from tokemon.transport import Transport

LOCK_SUFFIX = ".lock"
LOCK_STALE_SECONDS = 30.0
LOCK_HEARTBEAT_SECONDS = 2.0
LOCK_WAIT_SECONDS = 10.0
LOCK_POLL_SECONDS = 0.05
AUTH_FILE_MODE = 0o600
TEMP_SUFFIX = ".tokemon-tmp"
MILLISECONDS_PER_SECOND = 1000


class TokenRefreshError(RuntimeError):
    """An expired access token could not be refreshed or persisted."""


@dataclass(frozen=True)
class RefreshedToken:
    access: str
    refresh: str
    expires_at: datetime


class TokenEndpoint(Protocol):
    def refresh(self, refresh_token: str, transport: Transport, now: datetime) -> RefreshedToken: ...


class ExpiredTokenPolicy(Protocol):
    """Decides which credential a quota query uses when the stored one has expired."""

    def current(
        self, provider_id: str, credential: Credential, transport: Transport, now: datetime
    ) -> Credential: ...


class KeepExpiredTokens:
    """Read-only policy: query with the stored token, whatever its expiry."""

    def current(
        self, provider_id: str, credential: Credential, transport: Transport, now: datetime
    ) -> Credential:
        return credential


def _keep_lock_fresh(lock: Path, released: threading.Event) -> None:
    while not released.wait(LOCK_HEARTBEAT_SECONDS):
        try:
            os.utime(lock)
        except OSError:
            return


@contextmanager
def auth_file_lock(path: Path, wait_seconds: float) -> Iterator[None]:
    lock = path.with_name(path.name + LOCK_SUFFIX)
    deadline = time.monotonic() + wait_seconds
    while True:
        try:
            lock.mkdir()
            break
        except FileExistsError:
            pass
        try:
            age = time.time() - lock.stat().st_mtime
        except FileNotFoundError:
            continue
        if age > LOCK_STALE_SECONDS:
            try:
                lock.rmdir()
            except FileNotFoundError:
                pass
            continue
        if time.monotonic() >= deadline:
            raise TokenRefreshError(f"{path}: locked by another process")
        time.sleep(LOCK_POLL_SECONDS)
    released = threading.Event()
    heartbeat = threading.Thread(target=_keep_lock_fresh, args=(lock, released), daemon=True)
    heartbeat.start()
    try:
        yield
    finally:
        released.set()
        heartbeat.join()
        try:
            lock.rmdir()
        except FileNotFoundError:
            pass


def _read_auth(path: Path) -> dict[str, Any]:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise TokenRefreshError(f"{path}: unreadable JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise TokenRefreshError(f"{path}: expected a JSON object")
    return parsed


def _write_auth(path: Path, auth: Mapping[str, Any]) -> None:
    target = Path(os.path.realpath(path))
    temp = target.with_name(target.name + TEMP_SUFFIX)
    descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, AUTH_FILE_MODE)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(auth, indent=2))
    os.replace(temp, target)


def _with_token(auth: Mapping[str, Any], store: CredentialStore, token: RefreshedToken) -> dict[str, Any]:
    entry = {
        **auth[store.entry],
        "type": "oauth",
        "access": token.access,
        "refresh": token.refresh,
        "expires": int(token.expires_at.timestamp() * MILLISECONDS_PER_SECOND),
    }
    return {**auth, store.entry: entry}


class RefreshExpiredTokens:
    """Refreshes an expired pi OAuth token through its provider's token endpoint
    and persists the new pair to every ``auth.json`` entry holding the old one."""

    def __init__(self, endpoints: Mapping[str, TokenEndpoint], lock_wait_seconds: float) -> None:
        self._endpoints = endpoints
        self._lock_wait_seconds = lock_wait_seconds

    def current(
        self, provider_id: str, credential: Credential, transport: Transport, now: datetime
    ) -> Credential:
        endpoint = self._endpoints.get(provider_id)
        if (
            endpoint is None
            or not credential.stores
            or credential.refresh_token is None
            or not credential.is_expired(now)
        ):
            return credential
        primary, *copies = credential.stores
        with auth_file_lock(primary.path, self._lock_wait_seconds):
            auth = _read_auth(primary.path)
            entry = auth.get(primary.entry)
            if not isinstance(entry, dict):
                raise TokenRefreshError(f"{primary.path}: entry {primary.entry!r} is gone")
            try:
                stored = credential_from_pi_entry(provider_id, entry, primary)
            except CredentialError as exc:
                raise TokenRefreshError(str(exc)) from exc
            if stored.secret != credential.secret or stored.refresh_token is None:
                # pi refreshed or replaced the login since discovery read it
                return replace(stored, stores=credential.stores)
            token = endpoint.refresh(stored.refresh_token, transport, now)
            _write_auth(primary.path, _with_token(auth, primary, token))
        for copy in copies:
            with auth_file_lock(copy.path, self._lock_wait_seconds):
                auth = _read_auth(copy.path)
                entry = auth.get(copy.entry)
                if isinstance(entry, dict) and entry.get("access") == credential.secret:
                    _write_auth(copy.path, _with_token(auth, copy, token))
        return replace(credential, secret=token.access, refresh_token=token.refresh, expires_at=token.expires_at)
