"""OpenAI Codex (ChatGPT plan) quota via the authenticated backend usage endpoint.

Schema pinned against a live ``GET /wham/usage`` response (2026-09-29):

    rate_limit: {allowed, limit_reached,
                 primary_window: {used_percent, limit_window_seconds,
                                  reset_after_seconds, reset_at},
                 secondary_window: <same> | null}
    code_review_rate_limit: <window> | null
    additional_rate_limits: [{limit_name, metered_feature,
                              rate_limit: <as rate_limit> | null}, ...] | null
    credits: {has_credits, unlimited, overage_limit_reached, balance: "0", ...}
    spend_control: {reached, individual_limit}
    rate_limit_reset_credits: {available_count, applicable_available_count}
    plan_type, model_usage, promo, ...

``additional_rate_limits`` was null in the live response; its shape is the Codex
CLI's own model (openai/codex, AdditionalRateLimitDetails).
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    epoch_seconds_to_datetime,
    get_json,
    humanize_seconds,
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


def _window(name: str, node: Any, exhausted: bool | None) -> QuotaWindow | None:
    if not isinstance(node, Mapping):
        return None
    used_percent = optional_float(node.get("used_percent"))
    if used_percent is None:
        return None
    window_seconds = optional_float(node.get("limit_window_seconds"))
    label = f"{name} ({humanize_seconds(window_seconds)})" if window_seconds else name
    return QuotaWindow(
        name=label,
        used=used_percent,
        limit=100.0,
        unit="%",
        resets_at=epoch_seconds_to_datetime(node.get("reset_at")),
        exhausted=exhausted,
    )


def _status_windows(primary_name: str, secondary_name: str, status: Any) -> list[QuotaWindow]:
    """The windows of one rate-limit status ({limit_reached, primary_window, secondary_window})."""
    if not isinstance(status, Mapping):
        return []
    limit_reached = status.get("limit_reached") is True
    windows = [
        _window(primary_name, status.get("primary_window"), limit_reached or None),
        _window(secondary_name, status.get("secondary_window"), None),
    ]
    return [window for window in windows if window is not None]


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
        if isinstance(rate_limit, dict) and rate_limit.get("allowed") is False:
            notes.append("not allowed")
        windows.extend(_status_windows("primary", "secondary", rate_limit))
        code_review = body.get("code_review_rate_limit")
        if isinstance(code_review, dict):
            window = _window("code review", code_review, None)
            if window is not None:
                windows.append(window)
        additional = body.get("additional_rate_limits")
        if isinstance(additional, list):
            for details in additional:
                if not isinstance(details, dict):
                    continue
                limit_name = details.get("limit_name")
                name = limit_name if isinstance(limit_name, str) and limit_name else "additional"
                windows.extend(_status_windows(name, name, details.get("rate_limit")))

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
                        unit="credits",
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
