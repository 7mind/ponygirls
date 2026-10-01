"""MiniMax token plan remaining quota (``/v1/token_plan/remains``).

Schema pinned against live responses (2026-09-29): ``{model_remains: null,
base_resp: {status_code: 0, status_msg: "success"}}`` — ``model_remains`` is
null when the account has no active token plan, surfaced as a snapshot note.

The non-null shape is not publicly documented and could not be observed from
the available accounts; it is taken from CodexBar's parser (steipete/CodexBar,
MiniMaxModelRemains / MiniMaxUsageFetcher), one entry per model lane:

    {model_name, start_time, end_time, remains_time,              # epoch ms
     current_interval_total_count, current_interval_usage_count,
     current_interval_remaining_percent, current_interval_status,
     current_weekly_total_count, current_weekly_usage_count,
     current_weekly_remaining_percent, current_weekly_status,
     weekly_start_time, weekly_end_time, weekly_remains_time}

Despite the name, ``*_usage_count`` is the REMAINING quota.  A lane the plan
does not include reports status 3 with zero counts and is omitted; a lane with
no counts but a remaining percentage is shown as a percentage.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    epoch_millis_to_datetime,
    get_json,
    humanize_seconds,
    optional_float,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

MINIMAX_API = "https://api.minimax.io/v1"
REMAINS_PATH = "/token_plan/remains"

STATUS_NOT_IN_PLAN = 3


def _window(
    model: str, total: Any, remaining: Any, remaining_percent: Any, status: Any, start: Any, end: Any
) -> QuotaWindow | None:
    starts_at = epoch_millis_to_datetime(start)
    resets_at = epoch_millis_to_datetime(end)
    name = model
    if starts_at is not None and resets_at is not None:
        name = f"{model} ({humanize_seconds((resets_at - starts_at).total_seconds())})"
    limit = optional_float(total)
    left = optional_float(remaining)
    if limit is not None and limit > 0 and left is not None:
        return QuotaWindow(name=name, used=limit - left, limit=limit, unit="requests", resets_at=resets_at)
    percent_left = optional_float(remaining_percent)
    if percent_left is not None and status != STATUS_NOT_IN_PLAN:
        return QuotaWindow(name=name, used=100.0 - percent_left, limit=100.0, unit="%", resets_at=resets_at)
    return None


def _model_windows(entry: Mapping[str, Any]) -> list[QuotaWindow]:
    model = entry.get("model_name")
    name = model if isinstance(model, str) and model else "token plan"
    windows = [
        _window(
            name,
            entry.get("current_interval_total_count"),
            entry.get("current_interval_usage_count"),
            entry.get("current_interval_remaining_percent"),
            entry.get("current_interval_status"),
            entry.get("start_time"),
            entry.get("end_time"),
        ),
        _window(
            name,
            entry.get("current_weekly_total_count"),
            entry.get("current_weekly_usage_count"),
            entry.get("current_weekly_remaining_percent"),
            entry.get("current_weekly_status"),
            entry.get("weekly_start_time"),
            entry.get("weekly_end_time"),
        ),
    ]
    return [window for window in windows if window is not None]


class MinimaxQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{MINIMAX_API}{REMAINS_PATH}", bearer_headers(credential))
        body = require_object(payload, "minimax token_plan/remains")

        base_resp = body.get("base_resp")
        if isinstance(base_resp, dict) and base_resp.get("status_code") not in (0, None):
            message = base_resp.get("status_msg")
            raise QuotaFetchError(f"minimax token_plan/remains: {message}")

        remains = body.get("model_remains")
        if remains is None:
            return QuotaSnapshot(plan_name=None, identity=None, windows=(), note="no active token plan")
        if not isinstance(remains, list):
            raise QuotaFetchError(f"minimax token_plan/remains: unexpected model_remains type {type(remains).__name__}")

        windows = [window for entry in remains if isinstance(entry, dict) for window in _model_windows(entry)]
        if not windows:
            raise QuotaFetchError(
                f"minimax token_plan/remains: entries carry no quota counts (keys: {top_level_keys(remains[0] if remains else None)})"
            )
        return QuotaSnapshot(plan_name=None, identity=None, windows=tuple(windows), note=None)
