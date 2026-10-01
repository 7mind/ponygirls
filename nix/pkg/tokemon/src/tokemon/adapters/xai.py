"""xAI quota: Grok subscription pool (OAuth) and developer-platform prepaid credit.

xAI has three credential kinds with disjoint quota surfaces:

- OAuth (SuperGrok / X Premium login; pi provider ``xai``):
  the Grok CLI's billing proxy.  Undocumented; schema taken from the CLI's own
  serde model (xai-org/grok-build, extensions/billing.rs) and checked against a
  live unified-billing response (2026-10-01):

      GET cli-chat-proxy.grok.com/v1/billing?format=credits
          config: {creditUsagePercent, currentPeriod: {type, start, end},
                   onDemandCap: {val}, onDemandUsed: {val}, prepaidBalance: {val},
                   monthlyLimit: {val}, used: {val}, billingPeriodEnd,  # deprecated
                   history: [...]} | absent

  ``val`` is USD cents.  The response is proto3 JSON, which omits zero-valued
  scalars: a zero amount arrives as ``{}`` and an untouched pool carries no
  ``creditUsagePercent``.  ``prepaidBalance`` is stored as negative cents (the
  CLI displays its absolute value) and is shown whenever the account reports
  it, zero included; on-demand spend is shown only under a non-zero cap.

- Inference API key (``XAI_API_KEY``): api.x.ai has no quota endpoint.
  ``GET api.x.ai/v1/api-key`` reports only the key's name and blocked state.

- Management key (``XAI_MANAGEMENT_API_KEY``): the documented Management API.
  The prepaid ledger is inverted (a $10 top-up is ``"-1000"``), so the balance
  is the negated total:

      GET management-api.x.ai/auth/management-keys/validation
          {teamId, scope, scopeId, name, ...}
      GET management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance
          {changes: [...], total: {val: "<cents>"}}

OAuth access tokens are refreshed the way pi does it (pi-ai auth/oauth/xai.ts):

      POST auth.x.ai/oauth2/token  (form: grant_type=refresh_token, client_id, refresh_token)
          {access_token, refresh_token?, expires_in?}

``refresh_token`` is omitted when xAI does not rotate it.
"""

from __future__ import annotations

import urllib.parse
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
from tokemon.quota import QuotaAdapter, QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.token_refresh import RefreshedToken, TokenRefreshError
from tokemon.transport import Transport, TransportError

GROK_CLI_PROXY_API = "https://cli-chat-proxy.grok.com/v1"
BILLING_CREDITS_PATH = "/billing?format=credits"
# Static client marker and version the Grok CLI sends with the OAuth bearer token.
GROK_CLI_TOKEN_AUTH = "xai-grok-cli"
GROK_CLI_VERSION = "0.2.101"

XAI_OAUTH_TOKEN_URL = "https://auth.x.ai/oauth2/token"
# The public OAuth client pi and the Grok CLI both log in with.
XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
DEFAULT_TOKEN_LIFETIME = timedelta(hours=1)
# pi stores the expiry this much early so a token never dies mid-request.
TOKEN_REFRESH_SKEW = timedelta(minutes=5)

XAI_API = "https://api.x.ai/v1"
API_KEY_PATH = "/api-key"

XAI_MANAGEMENT_API = "https://management-api.x.ai"
MANAGEMENT_KEY_VALIDATION_PATH = "/auth/management-keys/validation"
MANAGEMENT_KEY_ENV = "XAI_MANAGEMENT_API_KEY"
TEAM_SCOPE = "SCOPE_TEAM"

CENTS_PER_USD = 100.0

USAGE_PERIOD_LABELS: Mapping[str, str] = {
    "USAGE_PERIOD_TYPE_WEEKLY": "weekly",
    "USAGE_PERIOD_TYPE_MONTHLY": "monthly",
}
DEFAULT_USAGE_PERIOD_LABEL = "usage"

API_KEY_BLOCK_FLAGS: Mapping[str, str] = {
    "team_blocked": "team blocked",
    "api_key_blocked": "key blocked",
    "api_key_disabled": "key disabled",
}


def _usd(node: Any) -> float | None:
    """A proto3 ``Cent`` message as USD; ``None`` when the message is absent."""
    if not isinstance(node, Mapping):
        return None
    cents = optional_float(node.get("val"))
    return (cents if cents is not None else 0.0) / CENTS_PER_USD


def _pool_window(config: Mapping[str, Any]) -> QuotaWindow | None:
    period = config.get("currentPeriod")
    if isinstance(period, Mapping):
        used_percent = optional_float(config.get("creditUsagePercent"))
        return QuotaWindow(
            name=USAGE_PERIOD_LABELS.get(str(period.get("type")), DEFAULT_USAGE_PERIOD_LABEL),
            used=used_percent if used_percent is not None else 0.0,
            limit=100.0,
            unit="%",
            resets_at=parse_datetime_string(period.get("end")),
        )
    monthly_limit = _usd(config.get("monthlyLimit"))
    if monthly_limit is None:
        return None
    used = _usd(config.get("used"))
    return QuotaWindow(
        name="monthly credits",
        used=used if used is not None else 0.0,
        limit=monthly_limit,
        unit="USD",
        resets_at=parse_datetime_string(config.get("billingPeriodEnd")),
    )


class GrokSubscriptionQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        headers = bearer_headers(credential)
        headers["X-XAI-Token-Auth"] = GROK_CLI_TOKEN_AUTH
        headers["x-grok-client-version"] = GROK_CLI_VERSION
        _, payload = get_json(transport, f"{GROK_CLI_PROXY_API}{BILLING_CREDITS_PATH}", headers)
        body = require_object(payload, "grok billing")
        config = body.get("config")
        if not isinstance(config, Mapping) or not config:
            return QuotaSnapshot(plan_name=None, identity=None, windows=(), note="no Grok subscription billing config")

        pool = _pool_window(config)
        if pool is None:
            raise QuotaFetchError(f"grok billing: no recognizable quota data (config keys: {top_level_keys(config)})")
        windows = [pool]
        on_demand_cap = _usd(config.get("onDemandCap"))
        if on_demand_cap is not None and on_demand_cap > 0:
            on_demand_used = _usd(config.get("onDemandUsed"))
            windows.append(
                QuotaWindow(
                    name="on-demand",
                    used=on_demand_used if on_demand_used is not None else 0.0,
                    limit=on_demand_cap,
                    unit="USD",
                    resets_at=None,
                )
            )
        prepaid = _usd(config.get("prepaidBalance"))
        if prepaid is not None:
            windows.append(QuotaWindow(name="prepaid", used=None, limit=abs(prepaid), unit="USD", resets_at=None))
        return QuotaSnapshot(plan_name=None, identity=None, windows=tuple(windows), note=None)


class XaiInferenceKeyStatus:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{XAI_API}{API_KEY_PATH}", bearer_headers(credential))
        body = require_object(payload, "xai api-key")
        notes = [label for flag, label in API_KEY_BLOCK_FLAGS.items() if body.get(flag) is True]
        notes.append(f"API key: no quota endpoint (prepaid balance needs {MANAGEMENT_KEY_ENV})")
        name = body.get("name")
        return QuotaSnapshot(
            plan_name=None,
            identity=name if isinstance(name, str) and name else None,
            windows=(),
            note=" · ".join(notes),
        )


class XaiQuota:
    """pi stores either credential kind under the one ``xai`` provider id."""

    def __init__(self) -> None:
        self._by_kind: Mapping[CredentialKind, QuotaAdapter] = {
            CredentialKind.OAUTH: GrokSubscriptionQuota(),
            CredentialKind.API_KEY: XaiInferenceKeyStatus(),
        }

    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        return self._by_kind[credential.kind].fetch(credential, transport)


class XaiManagementQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        headers = bearer_headers(credential)
        _, validation_payload = get_json(transport, f"{XAI_MANAGEMENT_API}{MANAGEMENT_KEY_VALIDATION_PATH}", headers)
        key = require_object(validation_payload, "xai management key")
        team_id = key.get("teamId")
        if not isinstance(team_id, str) or not team_id:
            team_id = key.get("scopeId") if key.get("scope") == TEAM_SCOPE else None
        if not isinstance(team_id, str) or not team_id:
            raise QuotaFetchError(f"xai management key: not scoped to a team (scope: {key.get('scope')!r})")

        _, balance_payload = get_json(
            transport, f"{XAI_MANAGEMENT_API}/v1/billing/teams/{team_id}/prepaid/balance", headers
        )
        balance = require_object(balance_payload, "xai prepaid balance")
        total = balance.get("total")
        ledger_cents = optional_float(total.get("val")) if isinstance(total, Mapping) else None
        if ledger_cents is None:
            raise QuotaFetchError(f"xai prepaid balance: no total (top-level keys: {top_level_keys(balance)})")
        name = key.get("name")
        return QuotaSnapshot(
            plan_name=None,
            identity=name if isinstance(name, str) and name else None,
            windows=(
                QuotaWindow(name="prepaid", used=None, limit=-ledger_cents / CENTS_PER_USD, unit="USD", resets_at=None),
            ),
            note=None,
        )


def _oauth_error(body: Any) -> str:
    if not isinstance(body, Mapping):
        return ""
    parts = [body.get("error"), body.get("error_description")]
    return ": " + ": ".join(part for part in parts if isinstance(part, str) and part) if any(parts) else ""


class XaiTokenEndpoint:
    def refresh(self, refresh_token: str, transport: Transport, now: datetime) -> RefreshedToken:
        form = {"grant_type": "refresh_token", "client_id": XAI_OAUTH_CLIENT_ID, "refresh_token": refresh_token}
        headers = {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}
        response = transport.request("POST", XAI_OAUTH_TOKEN_URL, headers, urllib.parse.urlencode(form).encode("ascii"))
        try:
            body = response.json()
        except TransportError:
            body = None
        if response.status != 200:
            raise TokenRefreshError(
                f"xAI token refresh rejected (HTTP {response.status}{_oauth_error(body)}) — log in to xAI again in pi"
            )
        if not isinstance(body, Mapping):
            raise TokenRefreshError("xAI token refresh: response is not a JSON object")
        access = body.get("access_token")
        if not isinstance(access, str) or not access:
            raise TokenRefreshError(f"xAI token refresh: no access_token (keys: {top_level_keys(body)})")
        rotated = body.get("refresh_token")
        lifetime = DEFAULT_TOKEN_LIFETIME
        if "expires_in" in body:
            seconds = optional_float(body["expires_in"])
            if seconds is None or seconds <= 0:
                raise TokenRefreshError(f"xAI token refresh: invalid expires_in {body['expires_in']!r}")
            lifetime = timedelta(seconds=seconds)
        return RefreshedToken(
            access=access,
            refresh=rotated if isinstance(rotated, str) and rotated else refresh_token,
            expires_at=now + lifetime - TOKEN_REFRESH_SKEW,
        )
