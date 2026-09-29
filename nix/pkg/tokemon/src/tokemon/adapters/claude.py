"""Claude subscription (Claude Code / claude.ai OAuth) quota via the OAuth usage endpoint.

Only OAuth access tokens work here; Anthropic API keys have no plan quota and
are reported with a note.  Schemas pinned against live responses (2026-09-29):

    GET /api/oauth/usage:
        limits: [{kind: "session" | "weekly_all" | "weekly_scoped",
                  group, percent, severity, resets_at, is_active,
                  scope: {model: {id, display_name}, surface} | null}, ...]
        five_hour, seven_day, seven_day_opus, ...: {utilization, resets_at, ...} | null
        extra_usage, spend, ...
    GET /api/oauth/profile:
        account: {email, ...}
        organization: {organization_type, rate_limit_tier, ...}

The per-window top-level keys include opaque codenames that change over time,
so windows are read from the ``limits`` list, which names them explicitly.
"""

from __future__ import annotations

from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    get_json,
    optional_float,
    parse_datetime_string,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.transport import Transport

ANTHROPIC_OAUTH_API = "https://api.anthropic.com/api/oauth"
USAGE_PATH = "/usage"
PROFILE_PATH = "/profile"

LIMIT_KIND_LABELS: Mapping[str, str] = {
    "session": "session (5h)",
    "weekly_all": "weekly (7d)",
    "weekly_scoped": "weekly (7d)",
}


def _scope_label(scope: Any) -> str | None:
    if not isinstance(scope, Mapping):
        return None
    model = scope.get("model")
    if isinstance(model, Mapping) and isinstance(model.get("display_name"), str):
        return model["display_name"]
    surface = scope.get("surface")
    return surface if isinstance(surface, str) else None


def _limit_window(node: Any) -> QuotaWindow | None:
    if not isinstance(node, Mapping):
        return None
    percent = optional_float(node.get("percent"))
    kind = node.get("kind")
    if percent is None or not isinstance(kind, str):
        return None
    name = LIMIT_KIND_LABELS.get(kind, kind)
    scope = _scope_label(node.get("scope"))
    if scope is not None:
        name = f"{name} {scope}"
    return QuotaWindow(
        name=name,
        used=percent,
        limit=100.0,
        unit="%",
        resets_at=parse_datetime_string(node.get("resets_at")),
    )


class ClaudeQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        if credential.kind is not CredentialKind.OAUTH:
            return QuotaSnapshot(plan_name=None, identity=None, windows=(), note="API key: no plan quota endpoint")
        headers = bearer_headers(credential)
        _, usage_payload = get_json(transport, f"{ANTHROPIC_OAUTH_API}{USAGE_PATH}", headers)
        usage = require_object(usage_payload, "claude usage")
        _, profile_payload = get_json(transport, f"{ANTHROPIC_OAUTH_API}{PROFILE_PATH}", headers)
        profile = require_object(profile_payload, "claude profile")

        limits = usage.get("limits")
        parsed = [_limit_window(node) for node in limits] if isinstance(limits, list) else []
        present = tuple(window for window in parsed if window is not None)
        if not present:
            raise QuotaFetchError(f"claude usage: no recognizable quota data (top-level keys: {top_level_keys(usage)})")

        account = profile.get("account")
        organization = profile.get("organization")
        email = account.get("email") if isinstance(account, Mapping) else None
        plan = organization.get("organization_type") if isinstance(organization, Mapping) else None
        return QuotaSnapshot(
            plan_name=plan if isinstance(plan, str) else None,
            identity=email if isinstance(email, str) else None,
            windows=present,
            note=None,
        )
