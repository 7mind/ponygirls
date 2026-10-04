"""Fullscreen TUI loop: render the quota table, auto-refresh on an interval."""

from __future__ import annotations

import queue
import sys
import termios
import threading
import time
from datetime import datetime, timezone
from typing import Callable

from rich.console import Console
from rich.live import Live

from tokemon.quota import QueryResult
from tokemon.render import build_table

COUNTDOWN_PERIOD_SECONDS = 1.0
WINDOW_TITLE = "tokemon"
# xterm title stack (XTWINOPS 22/23): save the shell's title, restore it on exit.
# Terminals without the stack ignore these, leaving the title as set.
PUSH_TITLE = "\x1b[22;0t"
POP_TITLE = "\x1b[23;0t"


def _key_reader(events: "queue.Queue[str]") -> Callable[[], None] | None:
    if not sys.stdin.isatty():
        return None
    fd = sys.stdin.fileno()
    original = termios.tcgetattr(fd)

    def restore() -> None:
        termios.tcsetattr(fd, termios.TCSADRAIN, original)

    import tty

    tty.setcbreak(fd)

    def read_keys() -> None:
        try:
            while True:
                char = sys.stdin.read(1)
                if not char:
                    return
                events.put(char)
        finally:
            restore()

    thread = threading.Thread(target=read_keys, daemon=True)
    thread.start()
    return restore


def _refresh_note(last_refresh: datetime, next_refresh: datetime, now: datetime, show_invalid: bool) -> str:
    remaining = max(0, int((next_refresh - now).total_seconds()))
    minutes, seconds = divmod(remaining, 60)
    return (
        f"updated {last_refresh.astimezone().strftime('%H:%M:%S')}"
        f" · next refresh in {minutes}:{seconds:02d}"
        f" · r refresh · i {'hide' if show_invalid else 'show'} invalid · q quit"
    )


def run_tui(
    query: Callable[[], list[QueryResult]],
    interval_seconds: int,
    show_invalid: bool,
    mask_logins: bool,
    mask_profiles: bool,
    console: Console,
) -> None:
    events: queue.Queue[str] = queue.Queue()
    restore_terminal = _key_reader(events)
    results: list[QueryResult] = []
    now = datetime.now(timezone.utc)
    last_refresh = now
    next_refresh = now
    if console.is_terminal:
        console.file.write(PUSH_TITLE)
        console.set_window_title(WINDOW_TITLE)
    try:
        with Live(console=console, screen=True, auto_refresh=False) as live:
            while True:
                results = query()
                last_refresh = datetime.now(timezone.utc)
                next_refresh = datetime.fromtimestamp(
                    last_refresh.timestamp() + interval_seconds, tz=timezone.utc
                )
                while True:
                    now = datetime.now(timezone.utc)
                    live.update(
                        build_table(
                            results,
                            now,
                            _refresh_note(last_refresh, next_refresh, now, show_invalid),
                            show_invalid,
                            mask_logins,
                            mask_profiles,
                            console.width if console.is_terminal else None,
                        ),
                        refresh=True,
                    )
                    if now >= next_refresh:
                        break
                    try:
                        char = events.get(timeout=COUNTDOWN_PERIOD_SECONDS)
                    except queue.Empty:
                        continue
                    if char in ("q", "Q", "\x03", "\x1b"):
                        return
                    if char in ("r", "R"):
                        break
                    if char in ("i", "I"):
                        show_invalid = not show_invalid
    except KeyboardInterrupt:
        # cbreak keeps ISIG, so Ctrl+C arrives as SIGINT rather than "\x03": quit like q.
        return
    finally:
        if console.is_terminal:
            console.file.write(POP_TITLE)
            console.file.flush()
        if restore_terminal is not None:
            restore_terminal()
