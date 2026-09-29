"""OpenRouter credit and rate-limit quota."""

from __future__ import annotations

from tokemon.adapters.common import (
    bearer_headers,
    epoch_seconds_to_datetime,
    get_json,
    optional_float,
    parse_datetime_string,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

OPENROUTER_API = "https://openrouter.ai/api/v1"
AUTH_KEY_PATH = "/auth/key"


class OpenRouterQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{OPENROUTER_API}{AUTH_KEY_PATH}", bearer_headers(credential))
        envelope = require_object(payload, "openrouter auth/key")
        data = require_object(envelope.get("data"), "openrouter auth/key data")

        windows: list[QuotaWindow] = []
        usage = optional_float(data.get("usage"))
        limit = optional_float(data.get("limit"))
        if usage is not None or limit is not None:
            resets_at = epoch_seconds_to_datetime(data.get("limit_reset"))
            if resets_at is None:
                resets_at = parse_datetime_string(data.get("limit_reset"))
            windows.append(QuotaWindow(name="credits", used=usage, limit=limit, unit="USD", resets_at=resets_at))

        rate_limit = data.get("rate_limit")
        if isinstance(rate_limit, dict):
            requests_used = optional_float(rate_limit.get("usage"))
            requests_limit = optional_float(rate_limit.get("limit"))
            interval = rate_limit.get("interval")
            name = f"requests/{interval}" if isinstance(interval, str) and interval else "requests"
            if requests_used is not None or requests_limit is not None:
                windows.append(QuotaWindow(name=name, used=requests_used, limit=requests_limit, unit="requests", resets_at=None))

        if not windows:
            raise QuotaFetchError(f"openrouter auth/key: no recognizable quota data (keys: {top_level_keys(data)})")
        label = data.get("label")
        return QuotaSnapshot(
            plan_name=None,
            identity=str(label) if isinstance(label, str) else None,
            windows=tuple(windows),
            note=None,
        )
