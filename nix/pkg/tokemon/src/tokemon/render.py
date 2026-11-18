"""Render query results as the quota table shared by `once` and the TUI.

A plain table: a header line, then one line per quota window; an account's
further windows leave its first cells blank. On a narrow terminal the
provider's paths go first, then Status shortens to its state with one
qualifier, then columns are hidden: Src, Plan, Login, Resets, Usage.
Provider, Profile, Window, Used / limit and Status say which row this is and
how it is doing: they are never hidden, only cut cell by cell with an
ellipsis when even they do not fit. The pi `/tokemon` pane
(ponygirls-tokemon, src/table.ts) follows the same rules.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Callable, Mapping

from rich.cells import cell_len
from rich.console import Console, ConsoleOptions, RenderResult
from rich.text import Text

from tokemon.discovery import DEFAULT_PROFILE, YOLO_CONFIG_ROOT, Target
from tokemon.quota import QueryResult, QuotaWindow
from tokemon.pacing import CLAUDE_MIN_QUERY_INTERVAL

LOW_WATER_FRACTION = 0.9
CURRENCY_SYMBOLS: Mapping[str, str] = {"USD": "$", "EUR": "€", "GBP": "£"}
BAR_WIDTH = 10
MASKED_LOGIN_PREFIX = 2
ROW_BAND_STYLE = "on grey11"
# Joins the notes under the table, and a state with its qualifiers.
SEPARATOR = " \u00b7 "


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
        return f"{CURRENCY_SYMBOLS[unit]}{value:,.2f}"
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


def _retry_qualifier(retry_at: datetime | None, now: datetime) -> str | None:
    """The retry time as a status qualifier; None when the endpoint named no time."""
    if retry_at is None:
        return None
    seconds = int((retry_at - now).total_seconds())
    if seconds <= 0:
        return "retry due"
    if seconds < 60:
        return f"retry {seconds}s"
    hours, minutes = divmod(seconds // 60, 60)
    return f"retry {hours}h{minutes:02d}m" if hours else f"retry {minutes}m"


def _used_percent(window: QuotaWindow) -> int | None:
    """Whole percent of the limit used, or None without a known used and limit.
    Rounded as a percentage window's Used / limit cell is, so the two agree."""
    if window.unlimited or window.used is None or window.limit is None or window.limit <= 0:
        return None
    return max(0, round(window.used * 100 / window.limit))


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


@dataclass(frozen=True)
class _Stale:
    """A cached value past its refresh interval; ``minutes`` is None when its age is unknown."""

    minutes: int | None

    @property
    def full(self) -> str:
        return "stale · age unknown" if self.minutes is None else f"stale · {self.minutes}m old"

    @property
    def qualifier(self) -> str:
        """The marker as the pane writes it, for a status with room for one qualifier."""
        return "stale (age unknown)" if self.minutes is None else f"stale {self.minutes}m"


def _stale(result: QueryResult, now: datetime) -> _Stale | None:
    if not result.cached and (result.snapshot is None or result.snapshot.fetched_at is None):
        return None
    if result.fetched_at is None:
        return _Stale(None)
    seconds = max(0, int((now - result.fetched_at).total_seconds()))
    if seconds < CLAUDE_MIN_QUERY_INTERVAL.total_seconds():
        return None
    return _Stale(seconds // 60)


@dataclass(frozen=True)
class _Cell:
    """One line of a cell and its style."""

    text: str
    style: str


@dataclass(frozen=True)
class _StatusText:
    """One wording of a status, and whether it shows the row's stale marker."""

    text: str
    stale: bool


@dataclass(frozen=True)
class _StatusLine:
    """A row's status: one line, never wrapped."""

    # Fullest first; the first that fits the column is shown, the last is cut when none does.
    forms: tuple[_StatusText, ...]
    # Cells the column must offer before another column is hidden for it.
    need: int
    # Cells the column must offer before any cell is cut.
    least: int
    style: str


def _plain(text: str) -> _StatusText:
    return _StatusText(text, False)


def _status_line(
    states: list[_StatusText], firm: list[_StatusText], loose: list[_StatusText], full: _StatusText, style: str
) -> _StatusLine:
    """A status from its parts. ``states`` are the state's own wordings,
    fullest first (``low 98%``, ``low``). ``firm`` qualifiers say what to do,
    when to look again or how far to trust the row (expired auth, the retry
    time, the stale marker): a column is hidden to keep the first of them.
    ``loose`` ones (a provider's note) show only in spare width. ``full`` is
    everything known, shown where it fits whole."""
    state = states[0]

    def qualify(qualifier: _StatusText) -> _StatusText:
        return _StatusText(f"{state.text}{SEPARATOR}{qualifier.text}", state.stale or qualifier.stale)

    forms: list[_StatusText] = []
    for form in [full, *map(qualify, firm), *map(qualify, loose), *states]:
        if all(form.text != other.text for other in forms):
            forms.append(form)
    need = cell_len(qualify(firm[0]).text if firm else state.text)
    return _StatusLine(tuple(forms), need, cell_len(states[-1].text), style)


def _unclaimed(line: _StatusLine) -> _StatusLine:
    """An error, or a provider's note standing for the state, claims no width:
    it takes the cells left over and is cut where they end."""
    return replace(line, need=0, least=0)


def _status_lines(
    result: QueryResult, windows: list[QuotaWindow | None], now: datetime, mask: ProfileMask
) -> list[_StatusLine]:
    """Per-window status lines. Result-level qualifiers (expired auth, the
    stale marker, a plan note) are shown once, on the first line; per-window
    ok/low/EXHAUSTED stays on every line."""
    if result.rate_limit is not None:
        retry = _retry_qualifier(result.rate_limit.retry_at, now)
        full = _plain(_rate_limited_status(result.rate_limit.retry_at, now))
        firm = [] if retry is None else [_plain(retry)]
        return [_status_line([_plain("rate limited")], firm, [], full, "yellow") for _ in windows]
    if result.error is not None:
        error = _plain(mask.text(result.error))
        return [_unclaimed(_status_line([error], [], [], error, "bold red")) for _ in windows]
    stale = _stale(result, now)
    note = mask.text(result.snapshot.note) if result.snapshot is not None and result.snapshot.note is not None else None
    expired = result.target.credential is not None and result.target.credential.is_expired(now)
    # Expired auth goes first (it needs a login), then the stale marker (whether the numbers can be trusted).
    firm = [_plain("auth expired")] if expired else []
    if stale is not None:
        firm.append(_StatusText(stale.qualifier, True))
    suffixes = [stale.full] if stale is not None else []
    if note is not None:
        suffixes.append(note)
    if expired:
        suffixes.append("auth expired")

    def everything(state: str | None) -> _StatusText:
        parts = suffixes if state is None else [state, *suffixes]
        return _StatusText(SEPARATOR.join(parts), stale is not None)

    lines: list[_StatusLine] = []
    for index, window in enumerate(windows):
        if window is None:
            if note is not None:
                # No quota windows: the provider's note stands for the state.
                style = "bold red" if expired else "dim"
                lines.append(_unclaimed(_status_line([_plain(note)], firm, [], everything(None), style)))
            else:
                style = "bold red" if expired else "yellow" if stale is not None else "green"
                lines.append(_status_line([_plain("ok")], firm, [], everything("ok"), style))
            continue
        label, style = _window_state(window)
        percent = _used_percent(window)
        states = [_plain(label)] if percent is None else [_plain(f"{label} {percent}%"), _plain(label)]
        if index > 0:
            lines.append(_status_line(states, [], [], states[0], style))
            continue
        if stale is not None:
            style = "yellow"
        if expired:
            style = "bold red"
        loose = [] if note is None else [_plain(note)]
        lines.append(_status_line(states, firm, loose, everything(states[0].text), style))
    return lines


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


@dataclass(frozen=True)
class _Column:
    header: str
    right_aligned: bool


# Provider is first: rows sort by it and its name carries a brand colour.
# The cell also lists the config paths, which are hidden first on narrow
# terminals before any column is hidden.
_COLUMNS: tuple[_Column, ...] = (
    _Column("Provider", False),
    _Column("Profile", False),
    _Column("Src", False),
    _Column("Login", False),
    _Column("Plan", False),
    _Column("Window", False),
    _Column("Used / limit", True),
    _Column("Usage", False),
    _Column("Resets", True),
    _Column("Status", False),
)
# Columns hidden on a narrow terminal, first to last. The others say which
# row this is and how it is doing.
_HIDE_ORDER = ("Src", "Plan", "Login", "Resets", "Usage")
# Which quota and its numbers: cut before who it is and how it is doing.
_CUT_FIRST = ("Window", "Used / limit")
_STATUS = len(_COLUMNS) - 1
_HEADER_WIDTHS = tuple(cell_len(column.header) for column in _COLUMNS)
_GAP = 2


@dataclass(frozen=True)
class _RowGroup:
    """The lines of one account: its cells by column, Status apart because
    its wording depends on the width left."""

    cells: tuple[tuple[_Cell, ...], ...]
    status: tuple[_StatusLine, ...]
    stale: bool
    band: bool


@dataclass(frozen=True)
class _Measured:
    """Column widths in cells, and the widths Status can settle for."""

    groups: list[_RowGroup]
    natural: tuple[int, ...]
    status_full: int
    status_need: int
    status_least: int


def _measure(groups: list[_RowGroup], whole_status: bool) -> _Measured:
    """With ``whole_status`` (the listing of invalid rows, read for its
    errors) columns are hidden for the full wording of each status, not for
    its short one."""
    statuses = [line for group in groups for line in group.status]

    def widest(pick: Callable[[_StatusLine], int]) -> int:
        return max([_HEADER_WIDTHS[_STATUS], *map(pick, statuses)])

    full = widest(lambda line: cell_len(line.forms[0].text))
    natural = tuple(
        max([_HEADER_WIDTHS[index], *(cell_len(cell.text) for group in groups for cell in group.cells[index])])
        for index in range(_STATUS)
    )
    need = full if whole_status else widest(lambda line: line.need)
    return _Measured(groups, natural, full, need, widest(lambda line: line.least))


def _table_width(visible: list[int], widths: list[int]) -> int:
    return sum(widths[index] for index in visible) + _GAP * (len(visible) - 1)


def _shrink(columns: list[int], visible: list[int], widths: list[int], floors: list[int], width: int) -> None:
    """Take cells from the widest of ``columns`` still above its floor (the
    leftmost of equals) until the visible columns fit."""
    for _ in range(_table_width(visible, widths) - width):
        candidates = [index for index in columns if widths[index] > floors[index]]
        if not candidates:
            return
        widths[max(candidates, key=lambda index: (widths[index], -index))] -= 1


def _arrange(measured: _Measured, width: int | None) -> tuple[list[int], list[int]]:
    """The visible columns and every column's width for ``width`` terminal
    cells (None: no limit)."""
    visible = list(range(len(_COLUMNS)))

    def with_status(status_width: int) -> list[int]:
        return [*measured.natural, status_width]

    if width is None or _table_width(visible, with_status(measured.status_full)) <= width:
        return visible, with_status(measured.status_full)
    for name in _HIDE_ORDER:
        if _table_width(visible, with_status(measured.status_need)) <= width:
            break
        visible = [index for index in visible if _COLUMNS[index].header != name]
    # Status takes the cells left over; each line shows its fullest wording that fits them.
    spare = width - _table_width(visible, with_status(0))
    if spare >= measured.status_least:
        return visible, with_status(min(spare, measured.status_full))
    # Nothing left to hide: cut the quota's details first, then names and states, and headers last.
    widths = with_status(measured.status_least)
    headers = list(_HEADER_WIDTHS)
    _shrink([index for index in visible if _COLUMNS[index].header in _CUT_FIRST], visible, widths, headers, width)
    _shrink(visible, visible, widths, headers, width)
    _shrink(visible, visible, widths, [1] * len(widths), width)
    return visible, widths


def _fit(cell: _Cell | None, column: _Column, width: int) -> Text:
    """A cell line cut or padded to exactly ``width`` cells."""
    text = Text()
    if cell is not None:
        text.append(cell.text, style=cell.style)
    text.truncate(width, overflow="ellipsis")
    padding = width - text.cell_len
    if column.right_aligned:
        text.pad_left(padding)
    else:
        text.pad_right(padding)
    return text


@dataclass(frozen=True)
class QuotaTable:
    """The rendered table: an optional title line, the header line and one
    line per window, and the notes naming what was left out."""

    title: Text | None
    headers: tuple[str, ...]
    lines: tuple[Text, ...]
    notes: tuple[str, ...]
    width: int

    def __rich_console__(self, console: Console, options: ConsoleOptions) -> RenderResult:
        if self.title is not None:
            yield self.title
        yield from self.lines
        if not self.notes:
            return
        # On one line, or one per line when that line would not fit.
        one_line = SEPARATOR.join(self.notes)
        for note in [one_line] if cell_len(one_line) <= options.max_width else self.notes:
            yield Text(note, style="dim")


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


def _provider_cell(target: Target, mask: ProfileMask, compact: bool) -> tuple[_Cell, ...]:
    """Provider name in its brand colour; paths dimmed on the lines below, or hidden when compact."""
    name = _Cell(target.provider, _provider_style(target.provider))
    if compact:
        return (name,)
    return (name, *(_Cell(mask.text(label), "dim") for label in target.label.split(", ")))


def build_table(
    results: list[QueryResult],
    now: datetime,
    refresh_note: str | None,
    show_invalid: bool,
    mask_logins: bool,
    mask_profiles: bool,
    width: int | None = None,
) -> QuotaTable:
    """Render results; rows without quota windows (other than rate-limited
    rows) are omitted unless ``show_invalid`` and counted in a note under the
    table instead. Rows sort by (provider, login). ``refresh_note`` follows
    the name on the title line; None leaves the title out. With
    ``mask_logins`` each login keeps its first two characters, the rest starred.
    With ``mask_profiles`` named profiles are numbered over all ``results`` (so
    hiding rows never renumbers them) and masked in paths too.
    With ``width`` (terminal columns) provider paths are hidden first; then
    Status shortens and columns are hidden until the table fits: Src, Plan,
    Login, Resets, Usage; a note names the hidden columns. Provider, Profile,
    Window, Used / limit and Status are never hidden. ``None`` keeps every
    column and path."""
    mask = ProfileMask.numbering(results) if mask_profiles else ProfileMask.unmasked()
    shown = results if show_invalid else [result for result in results if _is_shown_by_default(result)]
    hidden = [] if show_invalid else [result for result in results if not _is_shown_by_default(result)]
    ordered = sorted(shown, key=_sort_key)

    def make_groups(compact: bool) -> list[_RowGroup]:
        groups: list[_RowGroup] = []
        for group_index, result in enumerate(ordered):
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

            def per_window(text: Callable[[QuotaWindow], str]) -> tuple[_Cell, ...]:
                return tuple(_Cell("\u2014" if window is None else text(window), "") for window in windows)

            groups.append(
                _RowGroup(
                    cells=(
                        _provider_cell(target, mask, compact),
                        (_Cell(mask.profile(target.profile), ""),),
                        (_Cell(target.source, ""),),
                        (_Cell(identity, ""),),
                        (_Cell(plan, ""),),
                        per_window(lambda window: window.name),
                        per_window(_fmt_used_limit),
                        per_window(_bar),
                        per_window(lambda window: _fmt_resets(window, now)),
                    ),
                    status=tuple(_status_lines(result, windows, now, mask)),
                    stale=_stale(result, now) is not None,
                    # Every other account is banded, so its windows read as one block.
                    band=group_index % 2 == 1,
                )
            )
        return groups

    measured = _measure(make_groups(False), show_invalid)
    everything = list(range(len(_COLUMNS)))
    # The provider's paths go first: anything else that does not fit hides them.
    if width is not None and _table_width(everything, [*measured.natural, measured.status_full]) > width:
        measured = _measure(make_groups(True), show_invalid)
    visible, widths = _arrange(measured, width)
    table_width = _table_width(visible, widths)

    def line(cells: list[_Cell | None], band: bool) -> Text:
        text = Text(" " * _GAP).join(_fit(cell, _COLUMNS[index], widths[index]) for index, cell in zip(visible, cells))
        if band:
            text.stylize(ROW_BAND_STYLE)
        else:
            text.rstrip()
        # A console narrower than the table cuts its lines; it never wraps or squeezes them.
        text.no_wrap = True
        text.overflow = "ellipsis"
        return text

    lines = [line([_Cell(_COLUMNS[index].header, "dim") for index in visible], False)]
    stale_unmarked = 0
    for group in measured.groups:
        shown_status = [
            next((form for form in entry.forms if cell_len(form.text) <= widths[_STATUS]), entry.forms[-1])
            for entry in group.status
        ]
        if group.stale and not shown_status[0].stale:
            stale_unmarked += 1
        status_cells = tuple(_Cell(form.text, entry.style) for form, entry in zip(shown_status, group.status))
        cells = [*group.cells, status_cells]
        for row in range(max(len(cells[index]) for index in visible)):
            lines.append(line([cells[index][row] if row < len(cells[index]) else None for index in visible], group.band))

    dropped = [column.header for index, column in enumerate(_COLUMNS) if index not in visible]
    notes: list[str] = []
    if stale_unmarked:
        notes.append(f"\u26a0 {stale_unmarked} stale quota row(s)")
    caption = _hidden_caption(hidden)
    if caption:
        notes.append(caption)
    if dropped:
        notes.append(f"hidden at this width: {', '.join(dropped)}")
    title = None
    if refresh_note is not None:
        title = Text.assemble(("tokemon", "bold"), (f"{SEPARATOR}{refresh_note}", "dim"), no_wrap=True, overflow="ellipsis")
    return QuotaTable(title, tuple(_COLUMNS[index].header for index in visible), tuple(lines), tuple(notes), table_width)
