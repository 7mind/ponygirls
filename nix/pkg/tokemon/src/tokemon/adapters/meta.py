"""Meta Muse subscription quota via the Muse Code key-mint endpoint.

pi's ``meta`` provider logs in with an RFC 8628 device-code flow against
auth.meta.com; the resulting identity token (``dca:...``, stored as
``refresh``) is not accepted for inference, so pi exchanges it for a Model
API key (``access``, about a day lifetime) via the Muse Code key-mint
endpoint (pi-ai auth/oauth/meta.ts):

    POST https://api.meta.ai/muse-code/key
        Authorization: Bearer <dca: identity token>, x-api-version: 1.0.0, body {}
        {api_key, base_url, require_payment?, is_subs_active?, subs_usage?,
         user_email?, user_full_name?, subs_tier_id?, subs_tier_name?, ...}

The same response carries the subscription quota, read the way the
@ikuma.cloud/pix-usage pi extension's ``parseMuseUsage`` reads it:

    subs_usage: {window: {window_duration_mins, used_percent, resets_at},
                 weekly: {used_percent, resets_at}}

``resets_at`` is epoch seconds. ``subs_usage`` may be absent while the
rolling window is idle. ``require_payment`` means the account has no payment
method; a missing ``is_subs_active`` means no active Muse subscription for
the login. The login column is ``user_email`` (falling back to
``user_full_name``) and the plan column is ``subs_tier_name`` (e.g. "Muse
Code High Usage"); all three were confirmed present in a live 200 response. The identity token itself is not renewable (auth.meta.com
answers grant_type=refresh_token with 404 and issues no refresh_token), so
a 401/403 from mint means the session is dead and the user must sign in
again (``/login meta`` in pi).

The quota check mints as a side effect, so it is a single POST with no
retry: the endpoint is aggressively rate-limited (a 429 is surfaced so the
next refresh backs off), and pi re-mints on expiry itself. API keys
(``META_API_KEY``) are pay-as-you-go with no quota surface and are reported
with a note, like the Claude adapter does.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

from tokemon.adapters.common import (
    epoch_seconds_to_datetime,
    humanize_seconds,
    optional_float,
    parse_retry_after,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential, CredentialKind
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow, RateLimitedError
from tokemon.token_refresh import RefreshedToken, TokenRefreshError
from tokemon.transport import Transport, TransportError

MUSE_KEY_URL = "https://api.meta.ai/muse-code/key"
API_VERSION = "1.0.0"
# A minted Model API key lives about a day (pi-ai auth/oauth/meta.ts).
API_KEY_LIFETIME = timedelta(hours=24)
# Device-code identity tokens look like ``dca:<opaque>``; anything else is
# not a Meta subscription login (cf. pix-usage's museAuthorization check).
IDENTITY_PATTERN = re.compile(r"dca:\S+")

HTTP_TOO_MANY_REQUESTS = 429


def _mint_headers(identity_token: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {identity_token}",
        "x-api-version": API_VERSION,
    }


def _mint(transport: Transport, identity_token: str) -> tuple[int, Any, str | None]:
    """One key-mint call; returns (status, parsed body or None, retry-after)."""
    response = transport.request("POST", MUSE_KEY_URL, _mint_headers(identity_token), b"{}")
    try:
        body = response.json()
    except TransportError:
        body = None
    return response.status, body, response.retry_after


def _window(name: str, node: Any, context: str) -> QuotaWindow:
    if not isinstance(node, Mapping):
        raise QuotaFetchError(f"meta {context}: {name} is not an object (keys: {top_level_keys(node)})")
    used = optional_float(node.get("used_percent"))
    if used is None:
        raise QuotaFetchError(f"meta {context}: {name} has no used_percent (keys: {top_level_keys(node)})")
    return QuotaWindow(
        name=name,
        used=used,
        limit=100.0,
        unit="%",
        resets_at=epoch_seconds_to_datetime(node.get("resets_at")),
    )


def _primary_label(window: Mapping[str, Any]) -> str:
    minutes = optional_float(window.get("window_duration_mins"))
    if minutes is not None and minutes > 0:
        return f"primary ({humanize_seconds(minutes * 60)})"
    return "primary"


class MetaQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        if credential.kind is not CredentialKind.OAUTH:
            return QuotaSnapshot(plan_name=None, identity=None, windows=(), note="API key: no plan quota endpoint")
        identity = credential.refresh_token
        if not isinstance(identity, str) or IDENTITY_PATTERN.fullmatch(identity) is None:
            raise QuotaFetchError("meta usage needs Pi's device-code OAuth login (dca: identity) — run /login meta")
        status, payload, retry_after = _mint(transport, identity)
        if status == HTTP_TOO_MANY_REQUESTS:
            raise RateLimitedError(MUSE_KEY_URL, parse_retry_after(retry_after, datetime.now(timezone.utc)))
        if status == 401 or status == 403:
            raise QuotaFetchError(
                f"meta session expired (HTTP {status}) — run /login meta to sign in again"
            )
        if status != 200:
            raise QuotaFetchError(f"HTTP {status} from {MUSE_KEY_URL}")
        body = require_object(payload, "meta muse-code/key")

        if body.get("require_payment") is True:
            raise QuotaFetchError("meta Muse requires a payment method; finish setup at dev.meta.ai")
        if body.get("is_subs_active") is not True:
            raise QuotaFetchError("meta Muse: no active subscription for this login")
        subs = body.get("subs_usage")
        if subs is None:
            return QuotaSnapshot(
                plan_name=None, identity=None, windows=(), note="subscription usage not reported yet"
            )
        if not isinstance(subs, Mapping):
            raise QuotaFetchError(f"meta muse-code/key: subs_usage is not an object (keys: {top_level_keys(body)})")
        primary = subs.get("window")
        weekly = subs.get("weekly")
        if not isinstance(primary, Mapping) or not isinstance(weekly, Mapping):
            raise QuotaFetchError(
                f"meta muse-code/key: subs_usage has no window/weekly pair (keys: {top_level_keys(subs)})"
            )
        email = body.get("user_email")
        name = body.get("user_full_name")
        identity = email if isinstance(email, str) and email else name if isinstance(name, str) and name else None
        tier = body.get("subs_tier_name")
        return QuotaSnapshot(
            plan_name=tier if isinstance(tier, str) and tier else None,
            identity=identity,
            windows=(
                _window(_primary_label(primary), primary, "subs_usage.window"),
                _window("weekly (7d)", weekly, "subs_usage.weekly"),
            ),
            note=None,
        )


class MetaTokenEndpoint:
    def refresh(self, refresh_token: str, transport: Transport, now: datetime) -> RefreshedToken:
        # The identity token is kept: mint only rotates the inference key.
        status, body, _ = _mint(transport, refresh_token)
        if status == 401 or status == 403:
            raise TokenRefreshError(
                f"Meta session expired (HTTP {status}) — run /login meta to sign in again"
            )
        if status != 200:
            raise TokenRefreshError(f"Meta API key mint failed (HTTP {status})")
        if not isinstance(body, Mapping):
            raise TokenRefreshError("Meta token refresh: response is not a JSON object")
        api_key = body.get("api_key")
        if not isinstance(api_key, str) or not api_key:
            action = body.get("action_url")
            hint = f" Complete setup at {action}" if isinstance(action, str) and action else ""
            raise TokenRefreshError(f"Meta did not issue an API key.{hint} (keys: {top_level_keys(body)})")
        return RefreshedToken(access=api_key, refresh=refresh_token, expires_at=now + API_KEY_LIFETIME)
