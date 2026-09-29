"""Z.AI GLM Coding Plan quota (``/api/monitor/usage/quota/limit``).

Auth quirk (from zai-org/zai-coding-plugins): the Authorization header carries
the bare token — no ``Bearer`` prefix.  Error envelope observed live
(2026-09-29): ``{code: 500, msg, success: false}`` — e.g. an account without a
GLM Coding Plan reports ``msg = "当前用户不存在coding plan"``; that is account
state, surfaced as a snapshot note.  Success shape pinned from the official
``query-usage.mjs`` post-processor: ``data.limits[]`` items with
``type`` (TOKENS_LIMIT = 5h tokens, TIME_LIMIT = monthly MCP), ``percentage``,
``currentValue``, ``usage``.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import get_json, optional_float, require_object, top_level_keys
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

ZAI_API = "https://api.z.ai/api/monitor/usage/quota"
LIMIT_PATH = "/limit"

LIMIT_LABELS: Mapping[str, str] = {
    "TOKENS_LIMIT": "tokens (5h)",
    "TIME_LIMIT": "MCP (1mo)",
}
LIMIT_UNITS: Mapping[str, str] = {
    "TOKENS_LIMIT": "tokens",
    "TIME_LIMIT": "calls",
}


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
        return QuotaSnapshot(plan_name=None, identity=None, windows=tuple(windows), note=None)

    def _window(self, entry: Mapping[str, Any]) -> QuotaWindow | None:
        limit_type = entry.get("type")
        type_key = str(limit_type) if isinstance(limit_type, str) else ""
        used = optional_float(entry.get("currentValue"))
        limit = optional_float(entry.get("usage"))
        unit = LIMIT_UNITS.get(type_key, "units")
        if used is None and limit is None:
            percentage = optional_float(entry.get("percentage"))
            if percentage is None:
                return None
            used, limit, unit = percentage, 100.0, "%"
        return QuotaWindow(
            name=LIMIT_LABELS.get(type_key, type_key or "quota"),
            used=used,
            limit=limit,
            unit=unit,
            resets_at=None,
        )
