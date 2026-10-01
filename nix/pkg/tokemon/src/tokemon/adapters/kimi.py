"""Kimi For Coding plan usage.

Not checked against a live account.  Schema taken from the response handling
of kimi-cli's own ``/usage`` command (MoonshotAI/kimi-cli, ui/shell/usage.py):

    GET /usages
        usage: {limit, used | remaining, resetTime, name?}        # plan summary
        limits: [{window: {duration, timeUnit: "TIME_UNIT_MINUTE" | ...},
                  detail: {limit, used | remaining, resetTime, name?}}, ...]

Counts arrive as numbers or numeric strings and carry no unit; kimi-cli labels
the summary row "Weekly limit" and each limit by its window length.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    get_json,
    humanize_seconds,
    optional_float,
    parse_datetime_string,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

KIMI_API = "https://api.kimi.com/coding/v1"
USAGES_PATH = "/usages"

SUMMARY_LABEL = "weekly"
RESET_TIME_KEYS = ("resetTime", "reset_time", "resetAt", "reset_at")
SECONDS_PER_TIME_UNIT: Mapping[str, int] = {
    "TIME_UNIT_MINUTE": 60,
    "TIME_UNIT_HOUR": 3600,
    "TIME_UNIT_DAY": 86400,
}


def _window(name: str, detail: Mapping[str, Any]) -> QuotaWindow | None:
    limit = optional_float(detail.get("limit"))
    used = optional_float(detail.get("used"))
    if used is None:
        remaining = optional_float(detail.get("remaining"))
        if remaining is not None and limit is not None:
            used = limit - remaining
    if used is None and limit is None:
        return None
    resets = [parse_datetime_string(detail.get(key)) for key in RESET_TIME_KEYS]
    return QuotaWindow(
        name=name,
        used=used,
        limit=limit,
        unit="units",
        resets_at=next((reset for reset in resets if reset is not None), None),
    )


def _limit_label(item: Mapping[str, Any], index: int) -> str:
    window = item.get("window")
    if isinstance(window, Mapping):
        duration = optional_float(window.get("duration"))
        unit_seconds = SECONDS_PER_TIME_UNIT.get(str(window.get("timeUnit")))
        if duration and unit_seconds is not None:
            return f"limit ({humanize_seconds(duration * unit_seconds)})"
    return f"limit #{index + 1}"


class KimiQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{KIMI_API}{USAGES_PATH}", bearer_headers(credential))
        body = require_object(payload, "kimi usages")

        windows: list[QuotaWindow] = []
        usage = body.get("usage")
        if isinstance(usage, Mapping):
            summary = _window(SUMMARY_LABEL, usage)
            if summary is not None:
                windows.append(summary)
        limits = body.get("limits")
        if isinstance(limits, list):
            for index, item in enumerate(limits):
                if not isinstance(item, Mapping):
                    continue
                detail = item.get("detail")
                window = _window(_limit_label(item, index), detail if isinstance(detail, Mapping) else item)
                if window is not None:
                    windows.append(window)
        if not windows:
            raise QuotaFetchError(f"kimi usages: no recognizable quota data (top-level keys: {top_level_keys(body)})")
        return QuotaSnapshot(plan_name=None, identity=None, windows=tuple(windows), note=None)
