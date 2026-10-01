"""GitHub Copilot premium-request quota via ``/copilot_internal/user``.

Auth quirk (verified live, 2026-09-29): this endpoint authenticates with the
GitHub OAuth token (pi ``auth.json`` entry ``refresh``) — NOT the exchanged
Copilot session token in ``access``, which it rejects with 401 even when
freshly minted.  Response schema pinned against the live payload:

    {copilot_plan, access_type_sku, quota_reset_date, quota_reset_date_utc,
     quota_snapshots: {<scope>: {entitlement, remaining, credits_used,
                                 percent_remaining, unlimited, has_quota,
                                 quota_reset_at, overage_count,
                                 token_based_billing, ...}}}}

Since GitHub's move to usage-based billing (2026-06-01) the premium quota of a
``token_based_billing`` account counts GitHub AI Credits, not premium requests.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Mapping

from tokemon.adapters.common import (
    get_json,
    optional_float,
    parse_datetime_string,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

COPILOT_INTERNAL_API = "https://api.github.com/copilot_internal"
USER_PATH = "/user"

COPILOT_HEADERS = {
    "User-Agent": "GitHubCopilotChat/0.35.0",
    "Editor-Version": "vscode/1.107.0",
    "Editor-Plugin-Version": "copilot-chat/0.35.0",
    "Copilot-Integration-Id": "vscode-chat",
}

PREMIUM_SCOPE = "premium_interactions"
SCOPE_LABELS: Mapping[str, str] = {
    PREMIUM_SCOPE: "premium requests",
    "chat": "chat",
    "completions": "completions",
}


class CopilotQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        auth_token = credential.refresh_token or credential.secret
        headers = {
            "Authorization": f"Bearer {auth_token}",
            "Accept": "application/json",
            **COPILOT_HEADERS,
        }
        _, payload = get_json(transport, f"{COPILOT_INTERNAL_API}{USER_PATH}", headers)
        body = require_object(payload, "copilot /user")

        snapshots = body.get("quota_snapshots")
        if not isinstance(snapshots, dict) or not snapshots:
            raise QuotaFetchError(f"copilot /user: no quota_snapshots (keys: {top_level_keys(body)})")

        fallback_reset = self._reset_from_body(body)
        windows: list[QuotaWindow] = []
        for scope, detail in sorted(snapshots.items()):
            if not isinstance(detail, dict):
                continue
            windows.append(self._window(str(scope), detail, fallback_reset))

        access_type_sku = body.get("access_type_sku")
        plan = body.get("copilot_plan")
        login = body.get("login")
        plan_name = str(plan) if isinstance(plan, str) else None
        identity = str(login) if isinstance(login, str) else None
        note = str(access_type_sku) if isinstance(access_type_sku, str) else None
        return QuotaSnapshot(plan_name=plan_name, identity=identity, windows=tuple(windows), note=note)

    def _reset_from_body(self, body: Mapping[str, Any]) -> datetime | None:
        for key in ("quota_reset_date_utc", "quota_reset_date"):
            parsed = parse_datetime_string(body.get(key))
            if parsed is not None:
                return parsed
        return None

    def _window(self, scope: str, detail: Mapping[str, Any], fallback_reset: datetime | None) -> QuotaWindow:
        unlimited = detail.get("unlimited") is True
        entitlement = optional_float(detail.get("entitlement"))
        remaining = optional_float(detail.get("remaining"))
        used = None
        if entitlement is not None and remaining is not None:
            used = entitlement - remaining
        resets_at = None
        reset_epoch = optional_float(detail.get("quota_reset_at"))
        if reset_epoch is not None and reset_epoch > 0:
            resets_at = datetime.fromtimestamp(reset_epoch, tz=timezone.utc)
        else:
            resets_at = fallback_reset
        label = SCOPE_LABELS.get(scope, scope)
        unit = "requests"
        if scope == PREMIUM_SCOPE and detail.get("token_based_billing") is True:
            label, unit = "AI credits", "credits"
        return QuotaWindow(
            name=label,
            used=used,
            limit=entitlement,
            unit=unit,
            resets_at=resets_at,
            unlimited=unlimited,
        )
