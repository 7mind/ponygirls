"""Fan out quota queries over all discovered targets with per-row isolation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from tokemon.adapters import adapter_for
from tokemon.discovery import Target, join_unique
from tokemon.quota import QueryResult
from tokemon.transport import Transport

MAX_QUERY_WORKERS = 8


def query_target(target: Target, transport: Transport) -> QueryResult:
    now = datetime.now(timezone.utc)
    if target.credential is None:
        return QueryResult(target=target, snapshot=None, error=target.note or "no credential", fetched_at=now)
    try:
        snapshot = adapter_for(target.provider).fetch(target.credential, transport)
    except Exception as exc:  # per-row isolation: one bad adapter must not kill the dashboard
        return QueryResult(target=target, snapshot=None, error=f"{type(exc).__name__}: {exc}", fetched_at=now)
    return QueryResult(target=target, snapshot=snapshot, error=None, fetched_at=now)


def coalesce_by_identity(results: list[QueryResult]) -> list[QueryResult]:
    """Merge query results that report the same provider account identity
    (e.g. one ChatGPT account reached via both ~/.codex and pi auth.json).
    Results without a reported identity are passed through unchanged."""
    out: list[QueryResult] = []
    position_by_key: dict[tuple[str, str], int] = {}
    for result in results:
        identity = result.snapshot.identity if result.snapshot is not None else None
        if identity is None:
            out.append(result)
            continue
        key = (result.target.provider, identity)
        position = position_by_key.get(key)
        if position is None:
            position_by_key[key] = len(out)
            out.append(result)
            continue
        prior = out[position]
        merged_target = Target(
            profile=join_unique(prior.target.profile, result.target.profile),
            source=join_unique(prior.target.source, result.target.source),
            provider=prior.target.provider,
            label=f"{prior.target.label}, {result.target.label}",
            credential=prior.target.credential,
            note=prior.target.note,
        )
        out[position] = QueryResult(
            target=merged_target,
            snapshot=prior.snapshot,
            error=None,
            fetched_at=prior.fetched_at,
        )
    return out


def query_all(targets: list[Target], transport: Transport) -> list[QueryResult]:
    if not targets:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_QUERY_WORKERS, len(targets))) as executor:
        futures = [executor.submit(query_target, target, transport) for target in targets]
        return coalesce_by_identity([future.result() for future in futures])
