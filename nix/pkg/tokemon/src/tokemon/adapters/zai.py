"""Z.AI GLM Coding Plan quota (``/api/monitor/usage/quota/limit``).

Auth quirk (from zai-org/zai-coding-plugins): the Authorization header carries
the bare token — no ``Bearer`` prefix.  Error envelope observed live
(2026-09-29): ``{code: 500, msg, success: false}`` — e.g. an account without a
GLM Coding Plan reports ``msg = "当前用户不存在coding plan"``; that is account
state, surfaced as a snapshot note.

The official ``query-usage.mjs``
post-processor reads ``data.limits[]`` items by ``type`` (TOKENS_LIMIT,
TIME_LIMIT = monthly MCP) with ``percentage``, ``currentValue`` (used) and
``usage`` (the limit).  The remaining fields are taken from CodexBar's z.ai
parser (steipete/CodexBar, Plugins/zai.js): ``remaining``; the window length as
``number`` × ``unit`` (1 = day, 3 = hour, 5 = minute, 6 = week), which tells a
plan's 5-hour token limit from its weekly one; ``nextResetTime`` (epoch ms);
and the CREDIT_LIMIT type of credit-metered plans. ``data.level`` is the plan
name (observed live 2026-10-02, ``"lite"``). The coding-plan API key is not
allowed to read customer info, so there is no login to show.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    epoch_millis_to_datetime,
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

ZAI_API = "https://api.z.ai/api/monitor/usage/quota"
LIMIT_PATH = "/limit"

MCP_LIMIT_TYPE = "TIME_LIMIT"
MCP_LIMIT_LABEL = "MCP (1mo)"
LIMIT_LABELS: Mapping[str, str] = {
    "TOKENS_LIMIT": "tokens",
    "CREDIT_LIMIT": "credits",
}
LIMIT_UNITS: Mapping[str, str] = {
    "TOKENS_LIMIT": "tokens",
    "CREDIT_LIMIT": "credits",
    MCP_LIMIT_TYPE: "calls",
}
WINDOW_UNIT_SECONDS: Mapping[int, int] = {1: 86400, 3: 3600, 5: 60, 6: 604800}


def _label(type_key: str, entry: Mapping[str, Any]) -> str:
    if type_key == MCP_LIMIT_TYPE:
        return MCP_LIMIT_LABEL
    label = LIMIT_LABELS.get(type_key, type_key or "quota")
    number = optional_int(entry.get("number"))
    unit_seconds = WINDOW_UNIT_SECONDS.get(optional_int(entry.get("unit")) or 0)
    return f"{label} ({humanize_seconds(number * unit_seconds)})" if number and unit_seconds is not None else label


class ZaiQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        headers = {
            "Authorization": credential.secret,
            "Accept-Language": "en-US,en",
            "Content-Type": "application/json",
        }
        _, payload = get_json(transport, f"{ZAI_API}{LIMIT_PATH}", headers)
        body = require_object(payload, "zai quota/limit")

        if body.get("success") is False:
            message = body.get("msg")
            return QuotaSnapshot(
                plan_name=None,
                identity=None,
                windows=(),
                note=str(message) if isinstance(message, str) else "account has no coding plan",
            )

        data = body.get("data")
        source = data if isinstance(data, dict) else body
        limits = source.get("limits")
        if not isinstance(limits, list) or not limits:
            raise QuotaFetchError(f"zai quota/limit: no limits list (keys: {top_level_keys(source)})")

        windows: list[QuotaWindow] = []
        for entry in limits:
            if not isinstance(entry, dict):
                continue
            window = self._window(entry)
            if window is not None:
                windows.append(window)
        if not windows:
            raise QuotaFetchError(f"zai quota/limit: no usable windows (keys: {top_level_keys(limits[0])})")
        level = source.get("level")
        plan_name = level if isinstance(level, str) and level else None
        return QuotaSnapshot(plan_name=plan_name, identity=None, windows=tuple(windows), note=None)

    def _window(self, entry: Mapping[str, Any]) -> QuotaWindow | None:
        limit_type = entry.get("type")
        type_key = str(limit_type) if isinstance(limit_type, str) else ""
        limit = optional_float(entry.get("usage"))
        used = optional_float(entry.get("currentValue"))
        if used is None and limit is not None:
            remaining = optional_float(entry.get("remaining"))
            used = limit - remaining if remaining is not None else None
        unit = LIMIT_UNITS.get(type_key, "units")
        if used is None or limit is None:
            percentage = optional_float(entry.get("percentage"))
            if percentage is None:
                return None
            used, limit, unit = percentage, 100.0, "%"
        return QuotaWindow(
            name=_label(type_key, entry),
            used=used,
            limit=limit,
            unit=unit,
            resets_at=epoch_millis_to_datetime(entry.get("nextResetTime")),
        )
