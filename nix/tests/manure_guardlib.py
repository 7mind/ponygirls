"""Shared release-guard functions (owned helper, narrow).

Single source of truth for the fatal release gates, called from BOTH the
Nix check derivations (nix/tests/manure-unittests.nix,
nix/tests/manure-browser.nix via PYTHONPATH) AND the negative/positive
fixtures in nix/tests/test_manure_release_guards.py. A gate fixed here is
fixed everywhere; a gate broken here fails everywhere — no duplicated
shapes to drift.

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


def check_sdk_package_json(sdk_dir: str) -> None:
    """The vendored SDK dir must carry package.json naming the official
    `@modelcontextprotocol/sdk` (explicit controller env points here; A4
    re-verifies at runtime). Missing file or wrong name fails naming it."""
    from pathlib import Path as _Path

    meta_path = _Path(sdk_dir) / "package.json"
    try:
        text = meta_path.read_text()
    except OSError:
        raise GuardFailed(f"vendored SDK package.json absent: {sdk_dir}")
    import json as _json

    try:
        name = _json.loads(text).get("name")
    except Exception:
        raise GuardFailed(f"vendored SDK package.json unparsable: {sdk_dir}")
    if name != "@modelcontextprotocol/sdk":
        raise GuardFailed(f"vendored dir is not the official SDK: {sdk_dir}")


def check_unittest_result_clean(*, total: int, skipped: list, errors: list, failures: list, unexpected: list) -> None:
    """Structured outer verdict for one unittest prefix (mirrors
    TextTestRunner result handling in the derivations). Skips fail naming
    themselves; errors/failures fail; unexpected successes fail (an
    expectedFailure that passes is spec drift, and unittest's own
    wasSuccessful() ignores them, so the gate must not); empty groups
    fail. Tracebacks printed by EXPECTED-negative inner tests never reach
    this verdict."""
    if total == 0:
        raise GuardFailed("empty test group")
    if skipped:
        raise GuardFailed(f"mandatory tests skipped: {skipped!r}")
    if unexpected:
        raise GuardFailed(f"unexpected successes (spec drift): {unexpected!r}")
    if errors or failures:
        raise GuardFailed(f"suite errored: errors={len(errors)} failures={len(failures)}")


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


def check_resume_reuse(status_path: str, journal_path: str) -> None:
    """Resume must send exactly the missing chunks: no retransmission of
    already-acknowledged ranges, no omission. Recomputes the missing set
    from the retained pre-resume upload-status with the client's own
    algorithm (chunk-aligned walk over receipted ranges; the client's
    put_chunk has no retry, so service-observed chunk PUTs equal the
    missing set exactly) and requires the cursor-bounded service journal
    to show exactly that many chunk PUTs. Receipts must be nonempty AND
    incomplete (a publish-only resume evidences no chunk reuse)."""
    from pathlib import Path as _Path
    import json as _json

    try:
        status = _json.loads(_Path(status_path).read_text())
        journal = _Path(journal_path).read_text()
    except OSError as exc:
        raise GuardFailed(f"resume evidence unreadable: {exc}")
    try:
        f0 = status["files"][0]
        size = int(f0["size"])
        received = int(f0["received_bytes"])
        ranges = [[int(a), int(b)] for a, b in f0.get("received_ranges", [])]
        chunk = int(status["chunk_bytes"])
    except (KeyError, TypeError, ValueError) as exc:
        raise GuardFailed(f"resume status schema unexpected: {exc}")
    if not 0 < received < size:
        raise GuardFailed(f"receipts not partial: received={received} size={size}")
    if not ranges:
        raise GuardFailed("no receipted ranges pre-resume")
    if chunk <= 0 or size <= 0:
        raise GuardFailed(f"nonsense sizes: size={size} chunk={chunk}")
    missing = 0
    off = 0
    while off < size:
        ln = min(chunk, size - off)
        if not any(a <= off and off + ln <= b for a, b in ranges):
            missing += 1
        off += ln
    total = -(-size // chunk)
    if missing == 0:
        raise GuardFailed("nothing missing pre-resume (publish-only, not chunk resume)")
    if missing >= total:
        raise GuardFailed(f"missing {missing} covers all {total} chunks (no reuse evidenced)")
    actual = journal.count("PUT chunks -> ")
    if actual != missing:
        raise GuardFailed(
            f"resume sent {actual} chunk PUTs, expected exactly {missing} "
            "(retransmission or omission)"
        )
