"""OpenAI Codex (ChatGPT plan) quota via the authenticated backend usage endpoint.

Schema pinned against a live ``GET /wham/usage`` response (2026-09-29):

    rate_limit: {allowed, limit_reached,
                 primary_window: {used_percent, limit_window_seconds,
                                  reset_after_seconds, reset_at},
                 secondary_window: <same> | null}
    code_review_rate_limit: <window> | null
    additional_rate_limits: {name: <window>, ...} | null
    credits: {has_credits, unlimited, overage_limit_reached, balance: "0", ...}
    spend_control: {reached, individual_limit}
    rate_limit_reset_credits: {available_count, applicable_available_count}
    plan_type, model_usage, promo, ...
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    epoch_seconds_to_datetime,
    get_json,
    optional_float,
    optional_int,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

CHATGPT_BACKEND_API = "https://chatgpt.com/backend-api"
USAGE_PATH = "/wham/usage"


def _humanize_seconds(seconds: float | None) -> str:
    if seconds is None:
        return ""
    if seconds % 86400 == 0:
        return f"{int(seconds // 86400)}d"
    if seconds % 3600 == 0:
        return f"{int(seconds // 3600)}h"
    return f"{int(seconds // 60)}m"


def _window(name: str, node: Any, exhausted: bool | None) -> QuotaWindow | None:
    if not isinstance(node, Mapping):
        return None
    used_percent = optional_float(node.get("used_percent"))
    if used_percent is None:
        return None
    window_seconds = optional_float(node.get("limit_window_seconds"))
    label = f"{name} ({_humanize_seconds(window_seconds)})" if window_seconds else name
    return QuotaWindow(
        name=label,
        used=used_percent,
        limit=100.0,
        unit="%",
        resets_at=epoch_seconds_to_datetime(node.get("reset_at")),
        exhausted=exhausted,
    )


class CodexQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        headers = bearer_headers(credential)
        if credential.account_id is not None:
            headers["ChatGPT-Account-Id"] = credential.account_id
        _, payload = get_json(transport, f"{CHATGPT_BACKEND_API}{USAGE_PATH}", headers)
        body = require_object(payload, "codex usage")

        windows: list[QuotaWindow] = []
        notes: list[str] = []

        rate_limit = body.get("rate_limit")
        if isinstance(rate_limit, dict):
            limit_reached = rate_limit.get("limit_reached") is True
            if rate_limit.get("allowed") is False:
                notes.append("not allowed")
            primary = _window("primary", rate_limit.get("primary_window"), limit_reached or None)
            if primary is not None:
                windows.append(primary)
            secondary = _window("secondary", rate_limit.get("secondary_window"), None)
            if secondary is not None:
                windows.append(secondary)
        code_review = body.get("code_review_rate_limit")
        if isinstance(code_review, dict):
            window = _window("code review", code_review, None)
            if window is not None:
                windows.append(window)
        additional = body.get("additional_rate_limits")
        if isinstance(additional, dict):
            for name, node in sorted(additional.items()):
                if isinstance(node, dict):
                    window = _window(str(name), node, None)
                    if window is not None:
                        windows.append(window)

        credits = body.get("credits")
        if isinstance(credits, dict):
            balance = optional_float(credits.get("balance"))
            unlimited = credits.get("unlimited") is True
            if balance is not None or unlimited:
                windows.append(
                    QuotaWindow(
                        name="credits",
                        used=None,
                        limit=balance,
                        unit="USD",
                        resets_at=None,
                        unlimited=unlimited,
                    )
                )

        reset_credits = body.get("rate_limit_reset_credits")
        if isinstance(reset_credits, dict):
            available = optional_int(reset_credits.get("available_count"))
            if available is not None:
                notes.append(f"reset credits: {available}")

        if not windows:
            raise QuotaFetchError(f"codex usage: no recognizable quota data (top-level keys: {top_level_keys(body)})")

        plan_type = body.get("plan_type")
        email = body.get("email")
        return QuotaSnapshot(
            plan_name=str(plan_type) if isinstance(plan_type, str) else None,
            identity=str(email) if isinstance(email, str) else None,
            windows=tuple(windows),
            note=" · ".join(notes) if notes else None,
        )
