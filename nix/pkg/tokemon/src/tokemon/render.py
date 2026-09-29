"""Render query results as the quota table shared by `once` and the TUI."""

from __future__ import annotations

from datetime import datetime, timezone

from rich.table import Table

from tokemon.quota import QueryResult, QuotaWindow

LOW_WATER_FRACTION = 0.9
BAR_WIDTH = 10
ROW_BAND_STYLE = "on grey11"


def _fmt_amount(value: float | None, unit: str) -> str:
    if value is None:
        return "—"
    if unit == "%":
        return f"{value:.1f}%"
    if unit == "USD":
        return f"${value:.2f}"
    if unit == "requests":
        return str(int(value))
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


def _status(result: QueryResult, window: QuotaWindow | None, now: datetime) -> tuple[str, str]:
    """Return (text, style)."""
    if result.error is not None:
        return result.error, "bold red"
    parts: list[str] = []
    style = "green"
    if window is not None:
        exhausted = window.exhausted is True
        fraction = None
        if window.used is not None and window.limit is not None and window.limit > 0:
            fraction = window.used / window.limit
            exhausted = exhausted or fraction >= 1.0
        if exhausted:
            parts.append("EXHAUSTED")
            style = "bold red"
        elif window.unlimited:
            parts.append("unlimited")
            style = "dim"
        elif fraction is not None and fraction >= LOW_WATER_FRACTION:
            parts.append("low")
            style = "yellow"
        else:
            parts.append("ok")
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


def _status_column(result: QueryResult, windows: list[QuotaWindow | None], now: datetime):
    from rich.text import Text

    text = Text()
    for index, window in enumerate(windows):
        if index:
            text.append("\n")
        status_text, status_style = _status(result, window, now)
        text.append(status_text, style=status_style)
    return text


def _has_quota_data(result: QueryResult) -> bool:
    return result.snapshot is not None and bool(result.snapshot.windows)


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


def build_table(results: list[QueryResult], now: datetime, refresh_note: str, show_invalid: bool) -> Table:
    """Render results; rows without quota windows are omitted unless
    ``show_invalid`` and summarized in the table caption instead."""
    shown = results if show_invalid else [result for result in results if _has_quota_data(result)]
    hidden = [] if show_invalid else [result for result in results if not _has_quota_data(result)]
    table = Table(
        title=f"tokemon — token quotas · {refresh_note}",
        caption=_hidden_caption(hidden),
        expand=True,
    )
    table.add_column("Profile", no_wrap=True)
    table.add_column("Src", no_wrap=True)
    table.add_column("Provider")
    table.add_column("Login", no_wrap=True)
    table.add_column("Plan", no_wrap=True)
    table.add_column("Window", no_wrap=True)
    table.add_column("Used / limit", no_wrap=True, justify="right")
    table.add_column("Usage", no_wrap=True)
    table.add_column("Resets", no_wrap=True, justify="right")
    table.add_column("Status")

    ordered = sorted(
        shown,
        key=lambda r: (r.target.profile, r.target.source, r.target.provider, r.target.label),
    )
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
            if result.snapshot.windows:
                windows = list(result.snapshot.windows)
        names, used_limits, bars, resets = _stacked_cells(windows, now)
        table.add_row(
            target.profile,
            target.source,
            target.provider + "\n" + "\n".join(target.label.split(", ")),
            identity,
            plan,
            names,
            used_limits,
            bars,
            resets,
            _status_column(result, windows, now),
            style=row_style,
        )
    return table
