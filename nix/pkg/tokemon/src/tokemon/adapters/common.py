"""Shared helpers for quota adapters."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError
from tokemon.transport import HttpResponse, Transport


def bearer_headers(credential: Credential) -> dict[str, str]:
    return {"Authorization": f"Bearer {credential.secret}"}


def get_json(transport: Transport, url: str, headers: Mapping[str, str]) -> tuple[HttpResponse, Any]:
    response = transport.request("GET", url, headers, None)
    if response.status == 401 or response.status == 403:
        raise QuotaFetchError(f"auth rejected (HTTP {response.status}) — credential expired or revoked?")
    if response.status != 200:
        raise QuotaFetchError(f"HTTP {response.status} from {url}")
    return response, response.json()


def require_object(payload: Any, context: str) -> Mapping[str, Any]:
    if not isinstance(payload, dict):
        raise QuotaFetchError(f"{context}: expected a JSON object, got {type(payload).__name__}")
    return payload


def optional_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def optional_int(value: Any) -> int | None:
    parsed = optional_float(value)
    return int(parsed) if parsed is not None else None


def parse_datetime_string(value: Any) -> datetime | None:
    """Parse ISO date/datetime strings (e.g. ``2026-10-01``) into UTC datetimes."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def epoch_seconds_to_datetime(value: Any) -> datetime | None:
    seconds = optional_float(value)
    if seconds is None or seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


def top_level_keys(payload: Any) -> str:
    if isinstance(payload, dict):
        return ", ".join(sorted(str(key) for key in payload.keys()))
    return type(payload).__name__
