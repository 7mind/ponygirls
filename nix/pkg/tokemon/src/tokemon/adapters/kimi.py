"""Kimi For Coding plan usage.

Checked against a live account (2026-10-02) and the response handling of
kimi-cli's ``/usage`` command (MoonshotAI/kimi-cli, ui/shell/usage.py).
The cloud endpoint now returns both shapes; either may be absent:

    GET /usages
        usage: {limit, used | remaining, resetTime, name?}        # weekly summary
        limits: [{window: {duration, timeUnit: "TIME_UNIT_MINUTE" | ...},
                  detail: {limit, used | remaining, resetTime, name?}}, ...]
        usages: {limit_5h, limit_7d, limit_month_code, limit_month_total:
                 {used_ratio: 0..1, reset_time}, ...}

``used_ratio`` is a fraction (kimi-code ``parseQuotaEntry``). Absolute
``usage`` / ``limits`` rows win over a same-duration ratio: Moonshot has
shipped responses where ``used_ratio`` stays 0 while that window is exhausted
(MoonshotAI/kimi-code#3951). Counts in the absolute rows carry no unit.

OAuth access tokens are refreshed the way pi does it (pi-ai auth/oauth/kimi-coding.ts):

    POST https://auth.kimi.com/api/oauth/token
        form: client_id, grant_type=refresh_token, refresh_token
        {access_token, refresh_token, expires_in}

pi requires the rotated refresh token and stores ``expires`` as now plus
``expires_in``, with no skew. ``KIMI_CODE_OAUTH_HOST`` or ``KIMI_OAUTH_HOST``
overrides the auth host, matching pi.
"""

from __future__ import annotations

import os
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Mapping

from tokemon.adapters.common import (
    bearer_headers,
    get_json,
    humanize_seconds,
    optional_float,
    parse_datetime_string,
    require_object,
    top_level_keys,
)
from tokemon.credentials import Credential
from tokemon.quota import QuotaFetchError, QuotaSnapshot, QuotaWindow
from tokemon.token_refresh import RefreshedToken, TokenRefreshError
from tokemon.transport import Transport, TransportError

KIMI_API = "https://api.kimi.com/coding/v1"
USAGES_PATH = "/usages"
ME_PATH = "/me"
KIMI_OAUTH_HOST = "https://auth.kimi.com"
KIMI_OAUTH_TOKEN_PATH = "/api/oauth/token"
# The public OAuth client pi logs in to Kimi Code with.
KIMI_OAUTH_CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098"

SUMMARY_LABEL = "weekly"
WEEKLY_DURATION = "7d"
RESET_TIME_KEYS = ("resetTime", "reset_time", "resetAt", "reset_at")
PERCENT_SCALE = 100.0
SECONDS_PER_TIME_UNIT: Mapping[str, int] = {
    "TIME_UNIT_MINUTE": 60,
    "TIME_UNIT_HOUR": 3600,
    "TIME_UNIT_DAY": 86400,
}
# (response keys, label, duration already covered by an absolute row).
# Snake_case is what api.kimi.com returns; the others are the daemon schema's
# camelCase names (kimi-code managed-usage.ts).
RATIO_WINDOWS: tuple[tuple[tuple[str, ...], str, str | None], ...] = (
    (("limit_5h", "limit5h"), "5h", "5h"),
    (("limit_7d", "limit7d"), "weekly (7d)", WEEKLY_DURATION),
    (("limit_month_code", "month_code", "monthCode"), "monthly (code)", None),
    (("limit_month_total", "month_total", "monthTotal"), "monthly (membership)", None),
)


def _window(name: str, detail: Mapping[str, Any]) -> QuotaWindow | None:
    limit = optional_float(detail.get("limit"))
    used = optional_float(detail.get("used"))
    if used is None:
        remaining = optional_float(detail.get("remaining"))
        if remaining is not None and limit is not None:
            used = limit - remaining
    if used is None and limit is None:
        return None
    resets = [parse_datetime_string(detail.get(key)) for key in RESET_TIME_KEYS]
    return QuotaWindow(
        name=name,
        used=used,
        limit=limit,
        unit="units",
        resets_at=next((reset for reset in resets if reset is not None), None),
    )


def _limit_duration(item: Mapping[str, Any]) -> str | None:
    window = item.get("window")
    if not isinstance(window, Mapping):
        return None
    duration = optional_float(window.get("duration"))
    unit_seconds = SECONDS_PER_TIME_UNIT.get(str(window.get("timeUnit")))
    if not duration or unit_seconds is None:
        return None
    label = humanize_seconds(duration * unit_seconds)
    return label or None


def _limit_label(item: Mapping[str, Any], index: int) -> str:
    duration = _limit_duration(item)
    if duration:
        return f"limit ({duration})"
    return f"limit #{index + 1}"


def _ratio_window(name: str, entry: Mapping[str, Any]) -> QuotaWindow | None:
    ratio = optional_float(entry.get("used_ratio"))
    if ratio is None:
        ratio = optional_float(entry.get("usedRatio"))
    if ratio is None:
        return None
    resets = [parse_datetime_string(entry.get(key)) for key in RESET_TIME_KEYS]
    return QuotaWindow(
        name=name,
        used=ratio * PERCENT_SCALE,
        limit=PERCENT_SCALE,
        unit="%",
        resets_at=next((reset for reset in resets if reset is not None), None),
    )


def _named_ratio_entry(usages: Mapping[str, Any], keys: tuple[str, ...]) -> Mapping[str, Any] | None:
    for key in keys:
        entry = usages.get(key)
        if isinstance(entry, Mapping):
            return entry
    return None


def _ratio_windows(usages: Mapping[str, Any], covered: set[str]) -> list[QuotaWindow]:
    windows: list[QuotaWindow] = []
    consumed: set[str] = set()
    for keys, label, duration in RATIO_WINDOWS:
        consumed.update(keys)
        if duration is not None and duration in covered:
            continue
        entry = _named_ratio_entry(usages, keys)
        if entry is None:
            continue
        window = _ratio_window(label, entry)
        if window is not None:
            windows.append(window)
    for key in sorted(str(name) for name in usages):
        if key in consumed:
            continue
        entry = usages.get(key)
        if not isinstance(entry, Mapping):
            continue
        window = _ratio_window(key.replace("_", " "), entry)
        if window is not None:
            windows.append(window)
    return windows


class KimiQuota:
    def fetch(self, credential: Credential, transport: Transport) -> QuotaSnapshot:
        _, payload = get_json(transport, f"{KIMI_API}{USAGES_PATH}", bearer_headers(credential))
        body = require_object(payload, "kimi usages")

        windows: list[QuotaWindow] = []
        covered: set[str] = set()
        usage = body.get("usage")
        if isinstance(usage, Mapping):
            summary = _window(SUMMARY_LABEL, usage)
            if summary is not None:
                windows.append(summary)
                covered.add(WEEKLY_DURATION)
        limits = body.get("limits")
        if isinstance(limits, list):
            for index, item in enumerate(limits):
                if not isinstance(item, Mapping):
                    continue
                detail = item.get("detail")
                window = _window(_limit_label(item, index), detail if isinstance(detail, Mapping) else item)
                if window is not None:
                    windows.append(window)
                    duration = _limit_duration(item)
                    if duration:
                        covered.add(duration)
        usages = body.get("usages")
        if isinstance(usages, Mapping):
            windows.extend(_ratio_windows(usages, covered))
        if not windows:
            raise QuotaFetchError(f"kimi usages: no recognizable quota data (top-level keys: {top_level_keys(body)})")
        identity, plan_name = _account(credential, transport)
        return QuotaSnapshot(plan_name=plan_name, identity=identity, windows=tuple(windows), note=None)


def _account(credential: Credential, transport: Transport) -> tuple[str | None, str | None]:
    """Login and plan from ``GET /me``. A failure here must not hide a usage snapshot."""
    try:
        _, payload = get_json(transport, f"{KIMI_API}{ME_PATH}", bearer_headers(credential))
    except (QuotaFetchError, TransportError):
        return None, None
    if not isinstance(payload, Mapping):
        return None, None
    email = payload.get("email")
    nickname = payload.get("nickname")
    identity = email if isinstance(email, str) and email else nickname if isinstance(nickname, str) and nickname else None
    level = payload.get("user_level_name")
    plan = level if isinstance(level, str) and level else None
    return identity, plan


def _oauth_host() -> str:
    override = os.environ.get("KIMI_CODE_OAUTH_HOST") or os.environ.get("KIMI_OAUTH_HOST")
    return (override or KIMI_OAUTH_HOST).rstrip("/")


def _oauth_error(body: Any) -> str:
    if not isinstance(body, Mapping):
        return ""
    error = body.get("error")
    description = body.get("error_description")
    parts = [part for part in (error, description) if isinstance(part, str) and part]
    return ": " + ": ".join(parts) if parts else ""


class KimiTokenEndpoint:
    def refresh(self, refresh_token: str, transport: Transport, now: datetime) -> RefreshedToken:
        form = {
            "client_id": KIMI_OAUTH_CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        headers = {"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"}
        url = f"{_oauth_host()}{KIMI_OAUTH_TOKEN_PATH}"
        response = transport.request("POST", url, headers, urllib.parse.urlencode(form).encode("ascii"))
        try:
            body = response.json()
        except TransportError:
            body = None
        if response.status != 200:
            raise TokenRefreshError(
                f"Kimi token refresh rejected (HTTP {response.status}{_oauth_error(body)}) — log in to Kimi Code again in pi"
            )
        if not isinstance(body, Mapping):
            raise TokenRefreshError("Kimi token refresh: response is not a JSON object")
        access = body.get("access_token")
        rotated = body.get("refresh_token")
        seconds = optional_float(body.get("expires_in"))
        if not isinstance(access, str) or not access or not isinstance(rotated, str) or not rotated:
            raise TokenRefreshError(f"Kimi token refresh: missing token fields (keys: {top_level_keys(body)})")
        if seconds is None or seconds <= 0:
            raise TokenRefreshError(f"Kimi token refresh: invalid expires_in {body.get('expires_in')!r}")
        return RefreshedToken(access=access, refresh=rotated, expires_at=now + timedelta(seconds=seconds))
