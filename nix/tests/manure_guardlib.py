"""Shared release-guard functions (owned helper, narrow).

Single source of truth for the fatal release gates of the manure-vm test,
delivered into the guest with nix/tests/manure-privacy-check.py.

Conventions (match the derivations byte-for-byte in spirit):
- every check raises GuardFailed naming the violated invariant;
- `*_text` helpers operate on captured output (suite logs, file bodies);
- skips are NEVER acceptable in required legs (fail, naming the skip);
- expected-negative inner output ('Ran 1 FAILED', tracebacks) must NOT
  false-fail outer verdicts: verdicts read structured results (exit
  codes, result objects, counts), never FAILED/ERROR substrings.
Stdlib only.
"""
from __future__ import annotations


class GuardFailed(Exception):
    """A release gate fired for its intended reason."""


def check_canaries_absent(body: str, canaries: list[str]) -> None:
    """Sanitized-log gate: none of the canaries may appear. Seeded canaries
    must be caught (negative control proves the gate is live)."""
    for canary in canaries:
        if canary in body:
            raise GuardFailed(f"canary leaked: {canary}")


def check_sanitized_path_present(access_log: str, path_prefix: str) -> None:
    """Positive observability: the query-less request path must be logged
    (sanitized observability retained — privacy is never shown by absence
    of canaries alone)."""
    if path_prefix not in access_log:
        raise GuardFailed(f"sanitized path absent from access log: {path_prefix}")


def check_exact_status(code_text: str, expected: int) -> None:
    """Exact HTTP status from `curl -w '%{http_code}'` (no trailing newline
    assumed; stripped). Transport failures surface as `000`/empty and fail
    here — a status CLASS check (e.g. any 3 digits) would bless them."""
    if code_text.strip() != str(expected):
        raise GuardFailed(f"expected HTTP {expected}, got {code_text.strip()!r}")


def check_artifact_ids_equal(first: str, second: str) -> None:
    """Resume must continue the SAME artifact (interrupted init id equals
    resumed publish id)."""
    if not first or first != second:
        raise GuardFailed(f"artifact id mismatch: {first!r} vs {second!r}")


def check_token_mount_ro(token_path: str, cache_dir: str) -> None:
    """Contributed-RO attribution for the adapter's token bind: the token
    must READ (presence), an O_WRONLY open must fail with EROFS (mount
    denial — never mode denial, since the fixture guarantees an
    owner-writable token), and the RW cache side must accept and release
    a probe write (contrast control proving the denial comes from the
    mount, not the environment). Errno retained in every refusal."""
    import errno as _errno
    import os as _os
    from pathlib import Path as _Path

    try:
        data = _Path(token_path).read_bytes()
    except OSError as exc:
        raise GuardFailed(f"token unreadable: {exc}")
    if len(data) == 0:
        raise GuardFailed("token empty")
    probe = _Path(cache_dir) / ".guardlib-write-probe"
    try:
        probe.write_text("x")
        probe.unlink()
    except OSError as exc:
        raise GuardFailed(f"cache not writable (contrast broken): {exc}")
    try:
        fd = _os.open(token_path, _os.O_WRONLY)
    except OSError as exc:
        if exc.errno != _errno.EROFS:
            raise GuardFailed(
                f"token write denied without mount errno: errno={exc.errno}"
            )
        print(
            f"TOKEN-WRITE-DENIED-OK errno={exc.errno} "
            f"({_errno.errorcode.get(exc.errno)})",
            flush=True,
        )
        return
    _os.close(fd)
    raise GuardFailed("token write SUCCEEDED under RO bind (mount not enforcing)")
