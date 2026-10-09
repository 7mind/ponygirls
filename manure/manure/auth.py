"""Haystack-compatible token/password/grant codec (no network, no globals).

Token codec: 32 random bytes -> 43-char canonical unpadded base64url.
Files hold the 43 chars plus at most one final LF. Digests are SHA-256
hex; comparisons are constant-time. Generation never touches argv/logs;
callers must keep plaintext out of logs (allowlisted logging only).
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass

__all__ = [
    "TOKEN_RE",
    "HASH_RE",
    "HEXDIGEST_RE",
    "is_canonical_token",
    "generate_token",
    "generate_external_password",
    "generate_grant",
    "generate_artifact_id",
    "sha256_hex",
    "verify_token",
    "verify_hash",
    "load_token_file",
    "load_hash_file",
    "parse_cookies",
    "AuthError",
]

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")
HASH_RE = re.compile(r"^[0-9a-f]{64}$")
HEXDIGEST_RE = HASH_RE
_GRANT_RE = TOKEN_RE
_ARTIFACT_ID_RE = re.compile(r"^[0-9a-f]{32}$")


def is_canonical_token(text: object) -> bool:
    """R17: exact ASCII canonical unpadded base64url of exactly 32 bytes.

    The 43-char shape alone is insufficient (e.g. 42 'A's + 'B' carries
    non-zero pad bits and is not a canonical encoding). A value counts as
    a token only if it decodes to 32 bytes AND re-encodes identically.
    No whitespace normalization is ever applied.
    """
    if not isinstance(text, str):
        return False
    if not TOKEN_RE.fullmatch(text):
        return False
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, binascii.Error):
        return False
    if len(raw) != 32:
        return False
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii") == text


class AuthError(ValueError):
    """Raised for malformed token/hash files (caller maps to startup failure)."""


def generate_token() -> str:
    """Return a fresh 43-char canonical unpadded base64url token."""
    raw = secrets.token_bytes(32)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def generate_external_password() -> str:
    """External passwords use the same 43-char codec as bearer tokens."""
    return generate_token()


def generate_grant() -> str:
    """Fresh random single-use handoff value (never the password)."""
    return generate_token()


def generate_content_grant() -> str:
    """Fresh random content-grant cookie value bound server-side."""
    return generate_token()


def generate_artifact_id() -> str:
    """128-bit CSPRNG artifact id: 32 lowercase hex chars (DNS-safe)."""
    return secrets.token_hex(16)


def sha256_hex(value: str | bytes) -> str:
    if isinstance(value, str):
        value = value.encode("utf-8")
    return hashlib.sha256(value).hexdigest()


def verify_token(candidate: str, expected_hex: str) -> bool:
    """Constant-time check of a bearer token against a stored hex digest."""
    try:
        candidate_hex = sha256_hex(candidate)
    except Exception:
        return False
    return hmac.compare_digest(candidate_hex, expected_hex.lower())


def verify_hash(candidate: str, expected_hex: str) -> bool:
    """Constant-time check for external passwords (plaintext never stored)."""
    return verify_token(candidate, expected_hex)


def load_token_file(path: str) -> str:
    """Strict haystack byte rule: canonical 43-char token plus at most
    one final LF (R17: decode/re-encode equality enforced)."""
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw.endswith(b"\n"):
        raw = raw[:-1]
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise AuthError("token file %s: non-ascii bytes" % path) from exc
    if not is_canonical_token(text):
        raise AuthError("token file %s: must hold exactly one canonical "
                        "43-char token plus at most one final LF" % path)
    return text


def load_hash_file(path: str) -> str:
    """Strict haystack digest rule: 64 lowercase hex + at most one LF.

    No stripping, no case folding, no CRLF: anything else fails closed.
    """
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw.endswith(b"\n"):
        raw = raw[:-1]
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError as exc:
        raise AuthError("hash file %s: non-ascii bytes" % path) from exc
    if not HASH_RE.fullmatch(text):
        raise AuthError("hash file %s: must hold exactly 64 lowercase hex "
                        "chars plus at most one final LF" % path)
    return text


def parse_cookies(header_value: str | None) -> dict[str, str]:
    """Parse a Cookie header into {name: value} (first wins, no decoding).

    R17: credential values are preserved exactly (no whitespace or quote
    normalization); padded/quoted bearer-adjacent values therefore fail
    canonical validation instead of authenticating.
    """
    out: dict[str, str] = {}
    if not header_value:
        return out
    for part in header_value.split(";"):
        name, sep, value = part.partition("=")
        name = name.strip()
        if not sep or not name or name in out:
            continue
        out[name] = value
    return out


@dataclass(frozen=True)
class TokenIdentity:
    user_id: str
    user_type: str
    token_id: str
