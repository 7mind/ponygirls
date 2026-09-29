"""MiniMax token plan remaining quota (``/v1/token_plan/remains``).

Schema pinned against live responses (2026-09-29): ``{model_remains: null,
base_resp: {status_code: 0, status_msg: "success"}}`` — ``model_remains`` is
null when the account has no active token plan, surfaced as a snapshot note.
The non-null shape is not publicly documented and could not be observed from
the available accounts; the parser below handles per-model entries with
used/limit/remaining fields and fails loudly on anything else.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    epoch_seconds_to_datetime,
    get_json,
    optional_float,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

MINIMAX_API = "https://api.minimax.io/v1"
REMAINS_PATH = "/token_plan/remains"


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
        if isinstance(remains, dict):
            entries = list(remains.items())
        elif isinstance(remains, list):
            entries = [(None, item) for item in remains]
        else:
            raise QuotaFetchError(f"minimax token_plan/remains: unexpected model_remains type {type(remains).__name__}")

        windows: list[QuotaWindow] = []
        for model_name, entry in entries:
            if not isinstance(entry, dict):
                continue
            used = optional_float(entry.get("used"))
            limit = optional_float(entry.get("limit") or entry.get("total"))
            remaining = optional_float(entry.get("remains") or entry.get("remaining"))
            if used is None and remaining is not None and limit is not None:
                used = limit - remaining
            if used is None and limit is None:
                continue
            name = entry.get("model") or entry.get("model_name") or model_name or "token plan"
            windows.append(
                QuotaWindow(
                    name=str(name),
                    used=used,
                    limit=limit,
                    unit="tokens",
                    resets_at=epoch_seconds_to_datetime(
                        entry.get("resets_at") or entry.get("reset_at") or entry.get("reset_time")
                    ),
                )
            )
        if not windows:
            raise QuotaFetchError(
                f"minimax token_plan/remains: entries carry no used/limit fields (keys: {top_level_keys(entries[0][1])})"
            )
        return QuotaSnapshot(plan_name=None, identity=None, windows=tuple(windows), note=None)
