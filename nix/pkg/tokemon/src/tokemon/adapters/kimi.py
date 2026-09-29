"""Kimi For Coding plan usage.

Response schema pinned against the live endpoint at build time; the parser is
deliberately explicit and fails loudly on unrecognized shapes.
"""

from __future__ import annotations

from typing import Any

from tokemon.adapters.common import bearer_headers, epoch_seconds_to_datetime, get_json, optional_float, require_object, top_level_keys
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

KIMI_API = "https://api.kimi.com/coding/v1"
USAGES_PATH = "/usages"


class KimiQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{KIMI_API}{USAGES_PATH}", bearer_headers(credential))
        body = require_object(payload, "kimi usages")
        entries = body.get("data")
        if entries is None:
            entries = body.get("usages")
        if not isinstance(entries, list) or not entries:
            raise QuotaFetchError(f"kimi usages: no usage list (top-level keys: {top_level_keys(body)})")

        windows: list[QuotaWindow] = []
        for entry in entries:
            data = require_object(entry, "kimi usage entry")
            used = optional_float(data.get("used"))
            limit = optional_float(data.get("limit"))
            if used is None and limit is None:
                continue
            name = data.get("name") or data.get("type") or data.get("period") or "quota"
            unit = data.get("unit")
            windows.append(
                QuotaWindow(
                    name=str(name),
                    used=used,
                    limit=limit,
                    unit=str(unit) if isinstance(unit, str) and unit else "tokens",
                    resets_at=epoch_seconds_to_datetime(data.get("resets_at") or data.get("reset_at")),
                )
            )
        if not windows:
            raise QuotaFetchError(f"kimi usages: entries carry no used/limit fields (keys: {top_level_keys(entries[0])})")
        return QuotaSnapshot(plan_name=None, identity=None, windows=tuple(windows), note=None)
