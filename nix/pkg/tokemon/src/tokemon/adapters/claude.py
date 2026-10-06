"""Claude subscription (Claude Code / claude.ai OAuth) quota via the OAuth usage endpoint.

Only OAuth access tokens work here; Anthropic API keys have no plan quota and
are reported with a note.  Schemas pinned against live responses (2026-09-29):

    GET /api/oauth/usage:
        limits: [{kind: "session" | "weekly_all" | "weekly_scoped",
                  group, percent, severity, resets_at, is_active,
                  scope: {model: {id, display_name}, surface} | null}, ...]
        five_hour, seven_day, seven_day_opus, ...: {utilization, resets_at, ...} | null
        spend: {enabled, disabled_reason,
                used: {amount_minor, currency, exponent}, limit: <same> | null, ...}
        extra_usage, ...
    GET /api/oauth/profile:
        account: {email, ...}
        organization: {organization_type, rate_limit_tier, ...}

The per-window top-level keys include opaque codenames that change over time,
so windows are read from the ``limits`` list, which names them explicitly.
``spend`` is extra usage beyond the plan, billed in the account's currency: a
row while enabled, a note while blocked for a reason other than empty credits
(``disabled_reason``). Out of credits means nothing to spend, so nothing shows.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
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
from tokemon.token_refresh import RefreshedToken, TokenRefreshError
from tokemon.transport import Transport, TransportError

ANTHROPIC_OAUTH_API = "https://api.anthropic.com/api/oauth"
USAGE_PATH = "/usage"
PROFILE_PATH = "/profile"

# Claude Code 2.1.285 refreshes with JSON POST to TOKEN_URL (function Gce):
# {grant_type, refresh_token, client_id, scope}. The scope list is HXe() with
# PLUGINS_SCOPE_REGISTERED set. expires_in is seconds; a missing refresh_token
# means the old one was not rotated. The stored expiry is the server's, not
# skewed: writing an early expiry would make Claude Code refresh early too.
CLAUDE_OAUTH_TOKEN_URL = "https://platform.claude.com/v1/oauth/token"
CLAUDE_OAUTH_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
CLAUDE_OAUTH_SCOPES = (
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
    "user:plugins",
)

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


def _money(node: Any) -> tuple[float, str] | None:
    if not isinstance(node, Mapping):
        return None
    amount_minor = optional_float(node.get("amount_minor"))
    exponent = optional_float(node.get("exponent"))
    currency = node.get("currency")
    if amount_minor is None or exponent is None or not isinstance(currency, str):
        return None
    return amount_minor / 10**exponent, currency


# ``disabled_reason`` values that mean the account simply has no extra-usage
# credits: nothing to spend, nothing to show, so no note. Any other reason
# means extra usage exists but is blocked, which stays visible as one note.
_NO_EXTRA_CREDIT_REASONS = frozenset({"out_of_credits"})


def _extra_usage(spend: Any) -> tuple[QuotaWindow | None, str | None]:
    """Return (window, note) for the extra-usage spend object."""
    if not isinstance(spend, Mapping):
        return None, None
    if spend.get("enabled") is not True:
        reason = spend.get("disabled_reason")
        if isinstance(reason, str) and reason and reason not in _NO_EXTRA_CREDIT_REASONS:
            return None, f"extra usage off: {reason}"
        return None, None
    used = _money(spend.get("used"))
    if used is None:
        return None, None
    limit = _money(spend.get("limit"))
    window = QuotaWindow(
        name="extra usage",
        used=used[0],
        limit=limit[0] if limit is not None else None,
        unit=used[1],
        resets_at=None,
    )
    return window, None


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

        extra_window, note = _extra_usage(usage.get("spend"))
        if extra_window is not None:
            present = (*present, extra_window)

        account = profile.get("account")
        organization = profile.get("organization")
        email = account.get("email") if isinstance(account, Mapping) else None
        plan = organization.get("organization_type") if isinstance(organization, Mapping) else None
        return QuotaSnapshot(
            plan_name=plan if isinstance(plan, str) else None,
            identity=email if isinstance(email, str) else None,
            windows=present,
            note=note,
        )


def _oauth_error(body: Any) -> str:
    if not isinstance(body, Mapping):
        return ""
    error = body.get("error")
    if isinstance(error, str) and error:
        description = body.get("error_description")
        if isinstance(description, str) and description:
            return f": {error}: {description}"
        return f": {error}"
    if isinstance(error, Mapping):
        message = error.get("message")
        if isinstance(message, str) and message:
            return f": {message}"
    return ""


class ClaudeTokenEndpoint:
    def refresh(self, refresh_token: str, transport: Transport, now: datetime) -> RefreshedToken:
        payload = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CLAUDE_OAUTH_CLIENT_ID,
            "scope": " ".join(CLAUDE_OAUTH_SCOPES),
        }
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        response = transport.request(
            "POST", CLAUDE_OAUTH_TOKEN_URL, headers, json.dumps(payload).encode("utf-8")
        )
        try:
            body = response.json()
        except TransportError:
            body = None
        if response.status != 200:
            detail = _oauth_error(body)
            raise TokenRefreshError(
                f"Claude token refresh rejected (HTTP {response.status}{detail}) — log in to Claude Code again"
            )
        if not isinstance(body, Mapping):
            raise TokenRefreshError("Claude token refresh: response is not a JSON object")
        access = body.get("access_token")
        if not isinstance(access, str) or not access:
            raise TokenRefreshError(f"Claude token refresh: no access_token (keys: {top_level_keys(body)})")
        seconds = optional_float(body.get("expires_in"))
        if seconds is None or seconds <= 0:
            raise TokenRefreshError(f"Claude token refresh: invalid expires_in {body.get('expires_in')!r}")
        rotated = body.get("refresh_token")
        return RefreshedToken(
            access=access,
            refresh=rotated if isinstance(rotated, str) and rotated else refresh_token,
            expires_at=now + timedelta(seconds=seconds),
        )
