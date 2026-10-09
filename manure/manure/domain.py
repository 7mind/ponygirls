"""Typed domain: config, validation, schemas, error codes (no I/O, no globals).

Pure helpers only. Filesystem/network access lives in storage.py/server.py.
"""

from __future__ import annotations

import base64
import binascii
import json
import posixpath
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

__all__ = [
    "ERROR_STATUS",
    "MAX_TTL_S",
    "RESERVED_TOP_SEGMENTS",
    "DomainError",
    "TokenRef",
    "UserConfig",
    "ServerConfig",
    "ManifestEntry",
    "format_time",
    "parse_time",
    "validate_manifest_path",
    "validate_manifest",
    "validate_ttl_seconds",
    "encode_cursor",
    "decode_cursor",
    "error_envelope",
    "session_cookie_name",
    "grant_cookie_name",
]

MAX_TTL_S = 31536000
RESERVED_TOP_SEGMENTS = ("__manure", "api")

ERROR_STATUS: dict[str, int] = {
    "bad-envelope": 400,
    "invalid-path": 400,
    "invalid-manifest": 400,
    "invalid-range": 400,
    "invalid-ttl": 400,
    "invalid-visibility": 400,
    "bad-host": 400,
    "ambiguous-credentials": 400,
    "unauthorized": 401,
    "password-required": 401,
    "password-invalid": 401,
    "grant-required": 401,
    "grant-invalid": 403,
    "grant-expired": 403,
    "session-not-owned": 403,
    "forbidden": 403,
    "tls-required": 403,
    "not-found": 404,
    "dashboard-disabled": 404,
    "chunk-conflict": 409,
    "state-conflict": 409,
    "hash-mismatch": 409,
    "incomplete-upload": 409,
    "expired": 410,
    "too-large": 413,
    "quota-exceeded": 413,
    "session-limit": 429,
    "rate-limited": 429,
    "unavailable": 503,
}

_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_ARTIFACT_RE = re.compile(r"^[0-9a-f]{32}$")
_DRIVE_RE = re.compile(r"^[A-Za-z]:")
_SUFFIX_LABEL = r"[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?"
_SUFFIX_RE = re.compile(r"^%s(\.%s)*$" % (_SUFFIX_LABEL, _SUFFIX_LABEL))


def _is_loopback_host(host: str) -> bool:
    host = (host or "").lower()
    return host in ("127.0.0.1", "::1", "localhost") or host.endswith(
        ".localhost")


def _is_loopback_suffix(suffix: str) -> bool:
    suffix = (suffix or "").lower()
    return suffix == "localhost" or suffix.endswith(".localhost")


class DomainError(ValueError):
    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code
        self.status = ERROR_STATUS.get(code, 400)
        self.message = message or code


@dataclass(frozen=True)
class TokenRef:
    id: str
    hash_file: str


@dataclass(frozen=True)
class UserConfig:
    id: str
    type: str
    tokens: tuple[TokenRef, ...]
    display_name: str = ""


@dataclass(frozen=True)
class ManifestEntry:
    path: str
    kind: str  # "file" | "dir"
    size: int = 0
    sha256: str = ""


_DEFAULTS: dict[str, Any] = {
    "listen_address": "127.0.0.1",
    "port": 47329,
    "loopback_dev": False,
    "trusted_proxies": ["127.0.0.1/32", "::1/128"],
    "dashboard_dir": "package",
    "unlock_shell_dir": "package",
    "users": [],
    "storage_quota_bytes": 21474836480,
    "chunk_bytes": 1048576,
    "max_file_bytes": 536870912,
    "max_artifact_bytes": 2147483648,
    "max_files_per_artifact": 10000,
    "max_request_body_bytes": 4194304,
    "max_list_limit": 200,
    "max_connections": 128,
    "request_timeout_s": 30,
    "max_sessions_per_user": 10,
    "max_sessions_global": 1000,
    "max_grants_per_artifact": 10000,
    "rate_map_max_entries": 4096,
    "rate_limit_per_min": 600,
    "unlock_rate_per_min": 10,
    "login_rate_per_min_per_ip": 10,
    "sweep_interval_s": 300,
    "incomplete_session_ttl_s": 86400,
    "grant_ttl_s": 86400,
    "one_time_grant_ttl_s": 60,
}

_REQUIRED = ("data_dir", "api_origin", "content_suffix")
_KNOWN = frozenset(list(_DEFAULTS.keys()) + list(_REQUIRED))


@dataclass(frozen=True)
class ServerConfig:
    listen_address: str = "127.0.0.1"
    port: int = 47329
    data_dir: str = ""
    api_origin: str = ""
    content_suffix: str = ""
    loopback_dev: bool = False
    trusted_proxies: tuple[str, ...] = ("127.0.0.1/32", "::1/128")
    dashboard_dir: Optional[str] = "package"
    unlock_shell_dir: Optional[str] = "package"
    users: tuple[UserConfig, ...] = ()
    storage_quota_bytes: int = 21474836480
    chunk_bytes: int = 1048576
    max_file_bytes: int = 536870912
    max_artifact_bytes: int = 2147483648
    max_files_per_artifact: int = 10000
    max_request_body_bytes: int = 4194304
    max_list_limit: int = 200
    max_connections: int = 128
    request_timeout_s: int = 30
    max_sessions_per_user: int = 10
    max_sessions_global: int = 1000
    max_grants_per_artifact: int = 10000
    rate_map_max_entries: int = 4096
    rate_limit_per_min: int = 600
    unlock_rate_per_min: int = 10
    login_rate_per_min_per_ip: int = 10
    sweep_interval_s: int = 300
    incomplete_session_ttl_s: int = 86400
    grant_ttl_s: int = 86400
    one_time_grant_ttl_s: int = 60

    def __post_init__(self) -> None:
        # Single fail-closed validator shared by JSON loading and direct
        # dataclass construction (R12): coerce structural aliases, then
        # enforce declared types, identity uniqueness, valid origins and
        # suffixes, production TLS, and loopback-only development.
        users = self._coerce_users(self.users)
        object.__setattr__(self, "users", users)
        proxies = self.trusted_proxies
        if isinstance(proxies, list):
            object.__setattr__(self, "trusted_proxies", tuple(proxies))
        self._validate()

    @staticmethod
    def _coerce_users(raw: Any) -> tuple[UserConfig, ...]:
        if isinstance(raw, list):
            raw = tuple(raw)
        if not isinstance(raw, tuple):
            raise DomainError("bad-envelope", "users: list required")
        out: list[UserConfig] = []
        for entry in raw:
            if isinstance(entry, UserConfig):
                out.append(entry)
                continue
            if not isinstance(entry, dict):
                raise DomainError("bad-envelope", "users: bad entry")
            tokens = entry.get("tokens")
            if not isinstance(tokens, (list, tuple)):
                raise DomainError("bad-envelope", "users: bad token refs")
            refs = []
            for tok in tokens:
                if isinstance(tok, TokenRef):
                    refs.append(tok)
                    continue
                if (not isinstance(tok, dict) or not tok.get("id")
                        or not tok.get("hashFile")):
                    raise DomainError("bad-envelope", "users: bad token ref")
                refs.append(TokenRef(id=tok["id"],
                                     hash_file=tok["hashFile"]))
            out.append(UserConfig(id=entry.get("id", ""),
                                  type=entry.get("type", ""),
                                  tokens=tuple(refs),
                                  display_name=entry.get("displayName", "")))
        return tuple(out)

    def _validate(self) -> None:
        bad = lambda msg: DomainError("bad-envelope", msg)  # noqa: E731
        if not isinstance(self.listen_address, str) or not self.listen_address:
            raise bad("listen_address: non-empty string required")
        if isinstance(self.port, bool) or not isinstance(self.port, int) \
                or not 0 <= self.port <= 65535:
            raise bad("port: int 0..65535 required")
        for key in ("data_dir", "api_origin", "content_suffix"):
            value = getattr(self, key)
            if not isinstance(value, str) or not value:
                raise bad("%s: non-empty string required" % key)
        if type(self.loopback_dev) is not bool:  # reject truthy "false"
            raise bad("loopback_dev: boolean required")
        origin = self._validate_origin(self.api_origin)
        self._validate_suffix(self.content_suffix)
        if not self.loopback_dev:
            if origin["scheme"] != "https":
                raise bad("production api_origin must be https:")
        elif not _is_loopback_host(origin["host"]):
            # R12: the development exception is loopback-only regardless of
            # scheme — remote https + loopback_dev would otherwise accept
            # plain backend requests with non-Secure dev cookies.
            raise bad("loopback_dev requires a loopback api host")
        if self.loopback_dev and not _is_loopback_suffix(
                self.content_suffix):
            raise bad("loopback_dev requires a loopback content suffix")
        for key in ("dashboard_dir", "unlock_shell_dir"):
            value = getattr(self, key)
            if value is not None and \
                    (not isinstance(value, str) or not value):
                raise bad("%s: non-empty string or null" % key)
        if not isinstance(self.trusted_proxies, (list, tuple)):
            raise bad("trusted_proxies: list of CIDRs required")
        import ipaddress as _ip
        for cidr in self.trusted_proxies:
            if not isinstance(cidr, str):
                raise bad("trusted_proxies: CIDR strings required")
            try:
                _ip.ip_network(cidr, strict=False)
            except ValueError as exc:
                raise bad("trusted_proxies: bad CIDR %r" % (cidr,)) from exc
        if not self.users:
            raise bad("users: at least one required")
        seen_users: set[str] = set()
        for user in self.users:
            if not isinstance(user, UserConfig):
                raise bad("users: bad entry")
            if not isinstance(user.id, str) or not user.id:
                raise bad("users: non-empty id required")
            if user.id in seen_users:
                raise bad("users: duplicate user id")
            seen_users.add(user.id)
            if user.type not in ("human", "agent"):
                raise bad("users: bad type")
            if not user.tokens:
                raise bad("users: at least one token required")
            seen_tokens: set[str] = set()
            for token in user.tokens:
                if not isinstance(token, TokenRef):
                    raise bad("users: bad token ref")
                if not isinstance(token.id, str) or not token.id:
                    raise bad("users: non-empty token id required")
                if token.id in seen_tokens:
                    raise bad("users: duplicate token id")
                seen_tokens.add(token.id)
                if not isinstance(token.hash_file, str) or \
                        not token.hash_file:
                    raise bad("users: non-empty hashFile required")
            if not isinstance(user.display_name, str):
                raise bad("users: bad displayName")
        ints = ("storage_quota_bytes", "max_file_bytes",
                "max_artifact_bytes", "max_files_per_artifact",
                "max_request_body_bytes", "max_list_limit",
                "max_connections", "request_timeout_s",
                "max_sessions_per_user", "max_sessions_global",
                "max_grants_per_artifact", "rate_map_max_entries",
                "rate_limit_per_min", "unlock_rate_per_min",
                "login_rate_per_min_per_ip", "sweep_interval_s",
                "incomplete_session_ttl_s", "grant_ttl_s",
                "one_time_grant_ttl_s")
        for key in ints:
            value = getattr(self, key)
            if isinstance(value, bool) or not isinstance(value, int) \
                    or value < 1:
                raise bad("%s: positive int required" % key)
        chunk = self.chunk_bytes
        if isinstance(chunk, bool) or not isinstance(chunk, int) \
                or not 262144 <= chunk <= 4194304:
            raise bad("chunk_bytes must be 256 KiB..4 MiB")

    @staticmethod
    def _validate_origin(value: str) -> dict[str, str]:
        import urllib.parse as _up
        try:
            parts = _up.urlsplit(value)
        except ValueError as exc:
            raise DomainError("bad-envelope",
                              "api_origin: bad origin") from exc
        if parts.scheme not in ("http", "https"):
            raise DomainError("bad-envelope",
                              "api_origin: http(s) scheme required")
        host = (parts.hostname or "")
        if not host or parts.username or parts.password:
            raise DomainError("bad-envelope",
                              "api_origin: bare host required")
        if parts.query or parts.fragment or parts.path not in ("", "/"):
            raise DomainError("bad-envelope",
                              "api_origin: origin only, no path")
        return {"scheme": parts.scheme, "host": host.lower()}

    @staticmethod
    def _validate_suffix(value: str) -> None:
        if len(value) > 253 or not _SUFFIX_RE.fullmatch(value):
            raise DomainError("bad-envelope",
                              "content_suffix: bad DNS suffix")

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "ServerConfig":
        if not isinstance(raw, dict):
            raise DomainError("bad-envelope", "config must be an object")
        unknown = sorted(set(raw.keys()) - _KNOWN)
        if unknown:
            raise DomainError("bad-envelope",
                              "unknown config keys: %s" % ",".join(unknown))
        merged: dict[str, Any] = dict(_DEFAULTS)
        merged.update(raw)
        # __post_init__ performs all fail-closed validation.
        return cls(
            listen_address=merged["listen_address"], port=merged["port"],
            data_dir=merged["data_dir"], api_origin=merged["api_origin"],
            content_suffix=merged["content_suffix"],
            loopback_dev=merged["loopback_dev"],
            trusted_proxies=merged["trusted_proxies"],
            dashboard_dir=merged["dashboard_dir"],
            unlock_shell_dir=merged["unlock_shell_dir"],
            users=merged["users"],
            storage_quota_bytes=merged["storage_quota_bytes"],
            chunk_bytes=merged["chunk_bytes"],
            max_file_bytes=merged["max_file_bytes"],
            max_artifact_bytes=merged["max_artifact_bytes"],
            max_files_per_artifact=merged["max_files_per_artifact"],
            max_request_body_bytes=merged["max_request_body_bytes"],
            max_list_limit=merged["max_list_limit"],
            max_connections=merged["max_connections"],
            request_timeout_s=merged["request_timeout_s"],
            max_sessions_per_user=merged["max_sessions_per_user"],
            max_sessions_global=merged["max_sessions_global"],
            max_grants_per_artifact=merged["max_grants_per_artifact"],
            rate_map_max_entries=merged["rate_map_max_entries"],
            rate_limit_per_min=merged["rate_limit_per_min"],
            unlock_rate_per_min=merged["unlock_rate_per_min"],
            login_rate_per_min_per_ip=merged["login_rate_per_min_per_ip"],
            sweep_interval_s=merged["sweep_interval_s"],
            incomplete_session_ttl_s=merged["incomplete_session_ttl_s"],
            grant_ttl_s=merged["grant_ttl_s"],
            one_time_grant_ttl_s=merged["one_time_grant_ttl_s"],
        )

    @classmethod
    def from_json_file(cls, path: str) -> "ServerConfig":
        with open(path, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
        if not isinstance(raw, dict):
            raise DomainError("bad-envelope", "config root must be an object")
        return cls.from_dict(raw)


# ------------------------------------------------------------------ time

def format_time(epoch_seconds: float) -> str:
    dt = datetime.fromtimestamp(epoch_seconds, tz=timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(value: str) -> float:
    try:
        dt = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as exc:
        raise DomainError("bad-envelope", "bad timestamp") from exc
    return dt.replace(tzinfo=timezone.utc).timestamp()


# ------------------------------------------------------------------ paths

def validate_manifest_path(path: str) -> None:
    """Enforce §5.3 relative-POSIX rules; raises DomainError(invalid-path)."""
    if not isinstance(path, str) or not path:
        raise DomainError("invalid-path", "empty path")
    if len(path) > 1024:
        raise DomainError("invalid-path", "path too long")
    if "\x00" in path:
        raise DomainError("invalid-path", "NUL in path")
    # R2: control characters (incl. CR/LF) can never reach response headers.
    if any(ord(ch) < 0x20 or ord(ch) == 0x7f for ch in path):
        raise DomainError("invalid-path", "control character in path")
    if "\\" in path:
        raise DomainError("invalid-path", "backslash in path")
    if path.startswith("/") or _DRIVE_RE.match(path):
        raise DomainError("invalid-path", "not a relative POSIX path")
    if posixpath.normpath(path) != path:
        raise DomainError("invalid-path", "non-normalized path")
    if path in (".", ".."):
        raise DomainError("invalid-path", "dot path")
    segments = path.split("/")
    if len(segments) > 64:
        raise DomainError("invalid-path", "path too deep")
    for seg in segments:
        if seg in ("", ".", ".."):
            raise DomainError("invalid-path", "dot segment")
    if segments[0] in RESERVED_TOP_SEGMENTS:
        raise DomainError("invalid-path", "reserved top segment")


def _entry_from_dict(raw: dict[str, Any]) -> ManifestEntry:
    if not isinstance(raw, dict):
        raise DomainError("invalid-manifest", "entry must be an object")
    path = raw.get("path")
    kind = raw.get("kind")
    if kind not in ("file", "dir"):
        raise DomainError("invalid-manifest", "bad entry kind")
    if not isinstance(path, str):
        raise DomainError("invalid-manifest", "bad entry path")
    try:
        validate_manifest_path(path)
    except DomainError as exc:
        if exc.code == "invalid-path":
            raise
        raise DomainError("invalid-manifest", exc.message)
    if kind == "dir":
        if "size" in raw or "sha256" in raw:
            raise DomainError("invalid-path",
                              "dir entry carries only path+kind")
        return ManifestEntry(path=path, kind="dir")
    size = raw.get("size")
    sha = raw.get("sha256")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise DomainError("invalid-manifest", "bad file size")
    if not isinstance(sha, str) or not _SHA_RE.fullmatch(sha):
        raise DomainError("invalid-manifest", "bad file sha256")
    return ManifestEntry(path=path, kind="file", size=size, sha256=sha)


def validate_manifest(raw_entries: Any, kind: str, limits: ServerConfig
                      ) -> tuple[list[ManifestEntry], int]:
    """Validate an init manifest; returns (entries, total_bytes)."""
    if kind not in ("file", "dir"):
        raise DomainError("invalid-manifest", "bad artifact kind")
    if not isinstance(raw_entries, list):
        raise DomainError("invalid-manifest", "files must be a list")
    if len(raw_entries) > limits.max_files_per_artifact:
        raise DomainError("invalid-manifest", "too many entries")
    entries = [_entry_from_dict(e) for e in raw_entries]
    seen: set[str] = set()
    for entry in entries:
        if entry.path in seen:
            raise DomainError("invalid-manifest", "duplicate path")
        seen.add(entry.path)
    files = [e for e in entries if e.kind == "file"]
    if kind == "file":
        if len(files) != 1 or len(entries) != 1:
            raise DomainError("invalid-manifest",
                              "kind=file holds exactly one file")
    for entry in entries:
        if entry.kind != "file":
            continue
        if entry.size > limits.max_file_bytes:
            raise DomainError("invalid-manifest", "file too large")
        for other in entries:
            if other.path == entry.path:
                continue
            if other.path.startswith(entry.path + "/"):
                raise DomainError("invalid-manifest",
                                  "file/descendant conflict")
    total = sum(e.size for e in files)
    if total > limits.max_artifact_bytes:
        raise DomainError("invalid-manifest", "artifact too large")
    return entries, total


# ------------------------------------------------------------------ misc

def validate_ttl_seconds(value: Any) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise DomainError("invalid-ttl", "expires_in_s must be int or null")
    if not 60 <= value <= MAX_TTL_S:
        raise DomainError("invalid-ttl", "ttl out of range 60..31536000")
    return value


def encode_cursor(created_at: str, artifact_id: str) -> str:
    raw = json.dumps([created_at, artifact_id]).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def decode_cursor(cursor: str) -> tuple[str, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        pair = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")))
        if (not isinstance(pair, list) or len(pair) != 2
                or not all(isinstance(x, str) for x in pair)):
            raise ValueError("bad cursor shape")
        return pair[0], pair[1]
    except (ValueError, binascii.Error) as exc:
        raise DomainError("bad-envelope", "bad cursor") from exc


def error_envelope(code: str, message: str = "") -> bytes:
    return json.dumps({"error": {"code": code,
                                 "message": message or code}}).encode()


def session_cookie_name(loopback_dev: bool) -> str:
    return "manure-dev" if loopback_dev else "__Host-manure"


def grant_cookie_name(loopback_dev: bool) -> str:
    return "mgrant-dev" if loopback_dev else "__Host-mgrant"


def valid_artifact_id(value: str) -> bool:
    return bool(_ARTIFACT_RE.fullmatch(value or ""))
