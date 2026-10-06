"""Render query results as the quota table shared by `once` and the TUI."""

from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping

from rich.console import Console
from rich.table import Table
from rich.text import Text

from tokemon.discovery import DEFAULT_PROFILE, YOLO_CONFIG_ROOT, Target
from tokemon.quota import QueryResult, QuotaWindow

LOW_WATER_FRACTION = 0.9
CURRENCY_SYMBOLS: Mapping[str, str] = {"USD": "$", "EUR": "€", "GBP": "£"}
BAR_WIDTH = 10
MASKED_LOGIN_PREFIX = 2
ROW_BAND_STYLE = "on grey11"


# Provider brand colours, nudged so neighbours stay distinct. Anthropic coral
# vs Xiaomi orange differ in lightness; Meta blue, Zhipu indigo, Qwen violet
# and Copilot fuchsia step around the blue-purple wheel; OpenAI emerald vs
# OpenRouter cyan differ by ~30 degrees; Vercel grey vs xAI off-white differ
# by lightness (both brands are monochrome).
PROVIDER_STYLES: Mapping[str, str] = {
    "anthropic": "#D97757",
    "openai-codex": "#10A37F",
    "openai-api-key": "#10A37F",
    "github-copilot": "#D946EF",
    "kimi-coding": "#B58900",
    "meta": "#0082FB",
    "minimax": "#EF4444",
    "minimax-cn": "#EF4444",
    "openrouter": "#06B6D4",
    "vercel-ai-gateway": "#9CA3AF",
    "xai": "#F8FAFC",
    "xai-management": "#F8FAFC",
    "zai": "#6366F1",
    "zai-coding-cn": "#6366F1",
    "xiaomi": "#FF6900",
    "xiaomi-token-plan-cn": "#FF6900",
    "xiaomi-token-plan-ams": "#FF6900",
    "xiaomi-token-plan-sgp": "#FF6900",
    "qwen-token-plan": "#7C3AED",
    "qwen-token-plan-cn": "#7C3AED",
}
# Family fallbacks for future provider ids (e.g. a new xiaomi-* plan), then a
# deterministic hash into neutrals for anything unknown.
_PROVIDER_PREFIX_STYLES: tuple[tuple[str, str], ...] = (
    ("xiaomi", "#FF6900"),
    ("qwen", "#7C3AED"),
    ("minimax", "#EF4444"),
    ("zai", "#6366F1"),
    ("openai", "#10A37F"),
    ("xai", "#F8FAFC"),
)
_FALLBACK_STYLES: tuple[str, ...] = (
    "cyan",
    "magenta",
    "green",
    "yellow",
    "blue",
    "bright_cyan",
    "bright_magenta",
    "bright_green",
)


def _provider_style(provider: str) -> str:
    """Distinct colour per provider, preferring the official brand hue."""
    if provider in PROVIDER_STYLES:
        return PROVIDER_STYLES[provider]
    for prefix, style in _PROVIDER_PREFIX_STYLES:
        if provider.startswith(prefix):
            return style
    digest = hashlib.md5(provider.encode("utf-8")).digest()[0]
    return _FALLBACK_STYLES[digest % len(_FALLBACK_STYLES)]


def _fmt_amount(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    if unit == "%":
        return f"{value:.1f}%"
    if unit in CURRENCY_SYMBOLS:
        return f"{CURRENCY_SYMBOLS[unit]}{value:.2f}"
    if unit == "requests":
        return str(int(value))
    if unit == "credits":
        return str(round(value))
    absolute = abs(value)
    for threshold, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if absolute >= threshold:
            return f"{value / threshold:.1f}{suffix}"
    return str(int(value))


def _fmt_used_limit(window: QuotaWindow) -> str:
    if window.unlimited:
        return "unlimited"
    if window.used is None and window.limit is None:
        return "—"
    if window.unit == "%" and window.used is not None:
        return f"{window.used:.0f}%"
    if window.limit is None:
        return _fmt_amount(window.used, window.unit)
    if window.used is None:
        return _fmt_amount(window.limit, window.unit)
    return f"{_fmt_amount(window.used, window.unit)} / {_fmt_amount(window.limit, window.unit)}"


def _bar(window: QuotaWindow) -> str:
    if window.unlimited or window.used is None or window.limit is None or window.limit <= 0:
        return "—"
    fraction = min(window.used / window.limit, 1.0)
    filled = round(fraction * BAR_WIDTH)
    return "█" * filled + "░" * (BAR_WIDTH - filled)


def _fmt_resets(window: QuotaWindow, now: datetime) -> str:
    if window.resets_at is None:
        return "—"
    delta = window.resets_at - now
    seconds = int(delta.total_seconds())
    if seconds <= 0:
        return "reset due"
    minutes, _ = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours >= 24:
        days, hours = divmod(hours, 24)
        return f"{days}d {hours}h"
    return f"{hours}h {minutes:02d}m"


def _rate_limited_status(retry_at: datetime | None, now: datetime) -> str:
    if retry_at is None:
        return "rate limited (429) · retry next refresh"
    seconds = int((retry_at - now).total_seconds())
    if seconds <= 0:
        return "rate limited (429) · retry due"
    minutes, seconds = divmod(seconds, 60)
    return f"rate limited (429) · retry in {minutes}m {seconds:02d}s"


def _window_state(window: QuotaWindow) -> tuple[str, str]:
    """Per-window quota state without result-level suffixes."""
    exhausted = window.exhausted is True
    fraction = None
    if window.used is not None and window.limit is not None and window.limit > 0:
        fraction = window.used / window.limit
        exhausted = exhausted or fraction >= 1.0
    if exhausted:
        return "EXHAUSTED", "bold red"
    if window.unlimited:
        return "unlimited", "dim"
    if fraction is not None and fraction >= LOW_WATER_FRACTION:
        return "low", "yellow"
    return "ok", "green"


def _status(result: QueryResult, window: QuotaWindow | None, now: datetime) -> tuple[str, str]:
    """Return (text, style)."""
    if result.rate_limit is not None:
        return _rate_limited_status(result.rate_limit.retry_at, now), "yellow"
    if result.error is not None:
        return result.error, "bold red"
    parts: list[str] = []
    style = "green"
    if window is not None:
        label, style = _window_state(window)
        parts.append(label)
        if result.snapshot is not None and result.snapshot.note is not None:
            parts.append(result.snapshot.note)
    elif result.snapshot is not None and result.snapshot.note is not None:
        parts.append(result.snapshot.note)
        style = "dim"
    else:
        parts.append("ok")
    credential = result.target.credential
    if credential is not None and credential.is_expired(now):
        parts.append("auth expired")
        style = "bold red"
    return " · ".join(parts), style


def _status_column(result: QueryResult, windows: list[QuotaWindow | None], now: datetime, mask: ProfileMask):
    # Result-level suffixes (plan notes, expired auth) are shown once on the
    # first line so multi-window rows stay compact; per-window ok/low/
    # EXHAUSTED stays on every line.
    if result.rate_limit is not None or result.error is not None:
        text = Text()
        for index, window in enumerate(windows):
            if index:
                text.append("\n")
            status_text, status_style = _status(result, window, now)
            text.append(mask.text(status_text), style=status_style)
        return text
    suffixes: list[str] = []
    if result.snapshot is not None and result.snapshot.note is not None:
        suffixes.append(mask.text(result.snapshot.note))
    expired = result.target.credential is not None and result.target.credential.is_expired(now)
    if expired:
        suffixes.append("auth expired")
    text = Text()
    for index, window in enumerate(windows):
        if index:
            text.append("\n")
        if window is None:
            if result.snapshot is not None and result.snapshot.note is not None:
                if index == 0:
                    text.append(" · ".join(suffixes), style="bold red" if expired else "dim")
                else:
                    text.append("—", style="dim")
            else:
                status_text, status_style = _status(result, window, now)
                text.append(mask.text(status_text), style=status_style)
            continue
        label, style = _window_state(window)
        if index == 0 and suffixes:
            label = " · ".join([label, *suffixes])
            if expired:
                style = "bold red"
        text.append(label, style=style)
    return text


def _stacked_cells(windows: list[QuotaWindow | None], now: datetime) -> tuple[str, str, str, str]:
    names: list[str] = []
    used_limits: list[str] = []
    bars: list[str] = []
    resets: list[str] = []
    for window in windows:
        if window is None:
            names.append("—")
            used_limits.append("—")
            bars.append("—")
            resets.append("—")
        else:
            names.append(window.name)
            used_limits.append(_fmt_used_limit(window))
            bars.append(_bar(window))
            resets.append(_fmt_resets(window, now))
    return "\n".join(names), "\n".join(used_limits), "\n".join(bars), "\n".join(resets)


def _is_shown_by_default(result: QueryResult) -> bool:
    """Rows with quota data, and rate-limited rows (a valid, temporary answer
    whose retry countdown matters), are shown; other errors are hidden."""
    return result.rate_limit is not None or (result.snapshot is not None and bool(result.snapshot.windows))


def _mask_login(login: str) -> str:
    return login[:MASKED_LOGIN_PREFIX] + "*" * max(len(login) - MASKED_LOGIN_PREFIX, 0)


@dataclass(frozen=True)
class ProfileMask:
    """Replaces named yolo profiles with stable numbers, both as profile names
    and as the ``.config/yolo/NAME`` segment of any path in rendered text.
    An empty mapping renders everything verbatim."""

    numbers: Mapping[str, int]

    @staticmethod
    def unmasked() -> ProfileMask:
        return ProfileMask({})

    @staticmethod
    def numbering(results: list[QueryResult]) -> ProfileMask:
        names = sorted(
            {name for result in results for name in result.target.profile.split(", ")} - {DEFAULT_PROFILE}
        )
        return ProfileMask({name: index for index, name in enumerate(names, start=1)})

    def profile(self, profiles: str) -> str:
        return ", ".join(str(self.numbers.get(name, name)) for name in profiles.split(", "))

    def text(self, text: str) -> str:
        if not self.numbers:
            return text
        root = re.escape("/" + YOLO_CONFIG_ROOT.as_posix() + "/")
        names = "|".join(re.escape(name) for name in sorted(self.numbers, key=len, reverse=True))
        return re.sub(
            f"({root})({names})(?=/|$|[\\s,:])",
            lambda match: match.group(1) + str(self.numbers[match.group(2)]),
            text,
        )


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _hidden_caption(hidden: list[QueryResult]) -> str | None:
    if not hidden:
        return None
    errors = sum(1 for result in hidden if result.error is not None)
    parts = []
    if errors:
        parts.append(_plural(errors, "error"))
    if len(hidden) - errors:
        parts.append(f"{len(hidden) - errors} without quota data")
    return f"{_plural(len(hidden), 'row')} hidden: {', '.join(parts)}"


# (header, add_column kwargs). Provider is first: rows sort by it and its
# name carries a brand colour. The cell also lists the config paths, which
# are hidden first on narrow terminals before any column is dropped.
_COLUMNS: tuple[tuple[str, dict], ...] = (
    ("Provider", {}),
    ("Profile", {"no_wrap": True}),
    ("Src", {"no_wrap": True}),
    ("Login", {"no_wrap": True}),
    ("Plan", {"no_wrap": True}),
    ("Window", {"no_wrap": True}),
    ("Used / limit", {"no_wrap": True, "justify": "right"}),
    ("Usage", {"no_wrap": True}),
    ("Resets", {"no_wrap": True, "justify": "right"}),
    ("Status", {}),
)
# Optional columns in drop order: descriptive first, functional last. Status
# carries ok/low/EXHAUSTED, error text, and rate-limit countdowns, so it is
# hidden only when nothing else fits.
_DROP_ORDER = ("Plan", "Provider", "Status")
# Width the probe console measures content at; rich caps a measurement at
# the console width, so the probe must be wider than any real terminal.
MEASURE_WIDTH = 10**6
_MEASURE_CONSOLE = Console(file=io.StringIO(), width=MEASURE_WIDTH)


def _content_width(table: Table) -> int:
    """Unconstrained content width of an assembled table."""
    return _MEASURE_CONSOLE.measure(table).maximum


def _assemble(
    title: str, caption: str | None, visible: list[int], rows: list[tuple[list, str | None]]
) -> Table:
    table = Table(title=title, caption=caption, expand=True, show_lines=True)
    for index in visible:
        header, kwargs = _COLUMNS[index]
        table.add_column(header, **kwargs)
    for cells, style in rows:
        table.add_row(*[cells[index] for index in visible], style=style)
    return table


def _sort_key(result: QueryResult) -> tuple[str, str, str, str, str]:
    """Primary sort is (provider, login); the rest break ties deterministically."""
    login = ""
    if result.snapshot is not None and result.snapshot.identity:
        login = result.snapshot.identity
    target = result.target
    return (
        target.provider.lower(),
        login.lower(),
        target.profile.lower(),
        target.source.lower(),
        target.label.lower(),
    )


def _provider_cell(target: Target, mask: ProfileMask, compact: bool) -> Text:
    """Provider name in its brand colour; paths dimmed, or hidden when compact."""
    cell = Text()
    cell.append(target.provider, style=_provider_style(target.provider))
    if not compact:
        for label in target.label.split(", "):
            cell.append("\n")
            cell.append(mask.text(label), style="dim")
    return cell


def build_table(
    results: list[QueryResult],
    now: datetime,
    refresh_note: str,
    show_invalid: bool,
    mask_logins: bool,
    mask_profiles: bool,
    width: int | None = None,
) -> Table:
    """Render results; rows without quota windows (other than rate-limited
    rows) are omitted unless ``show_invalid`` and summarized in the table
    caption instead. Rows sort by (provider, login). With
    ``mask_logins`` each login keeps its first two characters, the rest starred.
    With ``mask_profiles`` named profiles are numbered over all ``results`` (so
    hiding rows never renumbers them) and masked in paths too.
    With ``width`` (terminal columns) provider paths are hidden first; then
    optional columns are hidden until the table fits, least critical first:
    Plan, then Provider, then Status; the caption names the hidden paths and
    columns. ``None`` keeps every column and path."""
    mask = ProfileMask.numbering(results) if mask_profiles else ProfileMask.unmasked()
    shown = results if show_invalid else [result for result in results if _is_shown_by_default(result)]
    hidden = [] if show_invalid else [result for result in results if not _is_shown_by_default(result)]
    caption = _hidden_caption(hidden)

    ordered = sorted(shown, key=_sort_key)

    def make_rows(compact: bool) -> list[tuple[list, str | None]]:
        rows: list[tuple[list, str | None]] = []
        for group_index, result in enumerate(ordered):
            # One rich row per account group; window sub-lines are stacked inside
            # the cells so multi-line rows band and pad as one block instead of
            # leaving blank lines between windows.
            row_style = ROW_BAND_STYLE if group_index % 2 == 1 else None
            target = result.target
            plan = ""
            identity = ""
            windows: list[QuotaWindow | None] = [None]
            if result.snapshot is not None:
                plan = result.snapshot.plan_name or ""
                identity = result.snapshot.identity or ""
                if mask_logins:
                    identity = _mask_login(identity)
                if result.snapshot.windows:
                    windows = list(result.snapshot.windows)
            names, used_limits, bars, resets = _stacked_cells(windows, now)
            rows.append(
                (
                    [
                        _provider_cell(target, mask, compact),
                        mask.profile(target.profile),
                        target.source,
                        identity,
                        plan,
                        names,
                        used_limits,
                        bars,
                        resets,
                        _status_column(result, windows, now, mask),
                    ],
                    row_style,
                )
            )
        return rows

    rows = make_rows(False)
    visible = list(range(len(_COLUMNS)))
    droppable = [index for name in _DROP_ORDER for index, (header, _) in enumerate(_COLUMNS) if header == name]
    dropped: list[str] = []
    compact = False
    while True:
        table = _assemble(f"tokemon \u2014 token quotas \u00b7 {refresh_note}", caption, visible, rows)
        if width is None or _content_width(table) <= width or (compact and not droppable):
            break
        if not compact:
            compact = True
            rows = make_rows(True)
            continue
        dropped.append(_COLUMNS[droppable.pop(0)][0])
        visible = [index for index in visible if _COLUMNS[index][0] not in dropped]
    notes: list[str] = []
    if caption:
        notes.append(caption)
    if compact and "Provider" not in dropped:
        notes.append("provider paths hidden")
    if dropped:
        notes.append(f"columns hidden: {', '.join(dropped)}")
    if notes:
        table.caption = " \u00b7 ".join(notes)
    return table
