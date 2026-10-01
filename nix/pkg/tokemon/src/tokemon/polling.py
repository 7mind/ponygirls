"""Fan out quota queries over all discovered targets with per-row isolation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping

from tokemon.adapters import adapter_for
from tokemon.discovery import Target, discover_targets, join_unique
from tokemon.quota import QueryResult, RateLimit, RateLimitedError
from tokemon.token_refresh import ExpiredTokenPolicy
from tokemon.transport import Transport

MAX_QUERY_WORKERS = 8


def query_target(target: Target, transport: Transport, tokens: ExpiredTokenPolicy) -> QueryResult:
    now = datetime.now(timezone.utc)
    if target.credential is None:
        return QueryResult(
            target=target, snapshot=None, error=target.note or "no credential", fetched_at=now, rate_limit=None
        )
    try:
        credential = tokens.current(target.provider, target.credential, transport, now)
        target = replace(target, credential=credential)
        snapshot = adapter_for(target.provider).fetch(credential, transport)
    except RateLimitedError as exc:
        return QueryResult(
            target=target, snapshot=None, error=str(exc), fetched_at=now, rate_limit=RateLimit(exc.retry_at)
        )
    except Exception as exc:  # per-row isolation: one bad adapter must not kill the dashboard
        return QueryResult(
            target=target, snapshot=None, error=f"{type(exc).__name__}: {exc}", fetched_at=now, rate_limit=None
        )
    return QueryResult(target=target, snapshot=snapshot, error=None, fetched_at=now, rate_limit=None)


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
            rate_limit=None,
        )
    return out


def _query_targets(targets: list[Target], transport: Transport, tokens: ExpiredTokenPolicy) -> list[QueryResult]:
    if not targets:
        return []
    with ThreadPoolExecutor(max_workers=min(MAX_QUERY_WORKERS, len(targets))) as executor:
        futures = [executor.submit(query_target, target, transport, tokens) for target in targets]
        return [future.result() for future in futures]


TargetKey = tuple[str, str, str]


def _target_key(target: Target) -> TargetKey:
    return (target.source, target.provider, target.label)


class RetryAwareQuery:
    """One refresh: re-walk ``home`` (so added/removed profiles and rewritten
    credential files are picked up), query every target except those still
    inside a Retry-After window from their last HTTP 429, whose previous
    result is carried forward unchanged until that window passes."""

    def __init__(
        self,
        home: Path,
        environ: Mapping[str, str],
        transport: Transport,
        clock: Callable[[], datetime],
        tokens: ExpiredTokenPolicy,
    ) -> None:
        self._home = home
        self._environ = environ
        self._transport = transport
        self._clock = clock
        self._tokens = tokens
        self._previous: dict[TargetKey, QueryResult] = {}

    def __call__(self) -> list[QueryResult]:
        now = self._clock()
        due: list[Target] = []
        held: list[QueryResult] = []
        for target in discover_targets(self._home, self._environ):
            previous = self._previous.get(_target_key(target))
            retry_at = previous.rate_limit.retry_at if previous is not None and previous.rate_limit else None
            if previous is not None and retry_at is not None and retry_at > now:
                held.append(previous)
            else:
                due.append(target)
        results = _query_targets(due, self._transport, self._tokens) + held
        self._previous = {_target_key(result.target): result for result in results}
        return coalesce_by_identity(results)


def make_query(
    home: Path,
    environ: Mapping[str, str],
    transport: Transport,
    clock: Callable[[], datetime],
    tokens: ExpiredTokenPolicy,
) -> Callable[[], list[QueryResult]]:
    return RetryAwareQuery(home, environ, transport, clock, tokens)
