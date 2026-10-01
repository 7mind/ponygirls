"""OpenRouter account credit and per-key limits.

Schemas pinned against live responses (2026-10-01):

    GET /key
        data: {label, limit, limit_remaining, limit_reset, usage, usage_daily, ...,
               is_free_tier, free_model_daily_requests: {used, limit, remaining},
               rate_limit: {requests: -1, ...}}        # deprecated, always -1
    GET /credits
        data: {total_credits, total_usage}

``usage`` is the key's own lifetime spend and ``limit`` its optional spending
cap, reset per ``limit_reset`` (a period name such as "monthly", not a time);
the account balance is ``total_credits - total_usage``.  The API reference
reserves ``/credits`` for management keys, though it answered a regular key
here; a refusal is reported in the note and the key's own rows are kept.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import bearer_headers, get_json, optional_float, require_object, top_level_keys
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow, RateLimitedError
from tokemon.transport import Transport

OPENROUTER_API = "https://openrouter.ai/api/v1"
KEY_PATH = "/key"
CREDITS_PATH = "/credits"


def _credits_window(payload: Any) -> QuotaWindow:
    envelope = require_object(payload, "openrouter credits")
    data = require_object(envelope.get("data"), "openrouter credits data")
    total_credits = optional_float(data.get("total_credits"))
    total_usage = optional_float(data.get("total_usage"))
    if total_credits is None or total_usage is None:
        raise QuotaFetchError(f"openrouter credits: no totals (keys: {top_level_keys(data)})")
    return QuotaWindow(name="credits", used=total_usage, limit=total_credits, unit="USD", resets_at=None)


def _key_windows(data: Mapping[str, Any]) -> list[QuotaWindow]:
    windows: list[QuotaWindow] = []
    limit = optional_float(data.get("limit"))
    if limit is not None:
        reset = data.get("limit_reset")
        name = f"key limit ({reset})" if isinstance(reset, str) and reset else "key limit"
        windows.append(
            QuotaWindow(name=name, used=optional_float(data.get("usage")), limit=limit, unit="USD", resets_at=None)
        )
    free = data.get("free_model_daily_requests")
    if isinstance(free, Mapping):
        free_limit = optional_float(free.get("limit"))
        if free_limit is not None:
            windows.append(
                QuotaWindow(
                    name="free models (1d)",
                    used=optional_float(free.get("used")),
                    limit=free_limit,
                    unit="requests",
                    resets_at=None,
                )
            )
    return windows


class OpenRouterQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        headers = bearer_headers(credential)
        _, key_payload = get_json(transport, f"{OPENROUTER_API}{KEY_PATH}", headers)
        envelope = require_object(key_payload, "openrouter key")
        data = require_object(envelope.get("data"), "openrouter key data")

        windows: list[QuotaWindow] = []
        note = None
        try:
            _, credits_payload = get_json(transport, f"{OPENROUTER_API}{CREDITS_PATH}", headers)
            windows.append(_credits_window(credits_payload))
        except RateLimitedError:
            raise
        except QuotaFetchError as exc:
            note = f"account credits unavailable: {exc}"
        windows.extend(_key_windows(data))

        if not windows:
            raise QuotaFetchError(f"openrouter key: no quota data ({note}; keys: {top_level_keys(data)})")
        label = data.get("label")
        return QuotaSnapshot(
            plan_name=None,
            identity=str(label) if isinstance(label, str) else None,
            windows=tuple(windows),
            note=note,
        )
