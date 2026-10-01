"""Vercel AI Gateway credit balance.

Schema pinned against a live response (2026-10-01) and the documented REST
API (vercel.com/docs/ai-gateway, "Check credit balance"):

    GET /v1/credits
        {balance: "<USD>", total_used: "<USD>"}        # decimal strings

``balance`` is the team's remaining credit and ``total_used`` its lifetime
spend; there is no limit or reset, so spend is shown against their sum.
"""

from __future__ import annotations

from tokemon.adapters.common import bearer_headers, get_json, optional_float, require_object, top_level_keys
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

VERCEL_AI_GATEWAY_API = "https://ai-gateway.vercel.sh/v1"
CREDITS_PATH = "/credits"


class VercelGatewayQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{VERCEL_AI_GATEWAY_API}{CREDITS_PATH}", bearer_headers(credential))
        body = require_object(payload, "vercel credits")
        balance = optional_float(body.get("balance"))
        total_used = optional_float(body.get("total_used"))
        if balance is None or total_used is None:
            raise QuotaFetchError(f"vercel credits: no balance/total_used (keys: {top_level_keys(body)})")
        window = QuotaWindow(name="credits", used=total_used, limit=total_used + balance, unit="USD", resets_at=None)
        return QuotaSnapshot(plan_name=None, identity=None, windows=(window,), note=None)
