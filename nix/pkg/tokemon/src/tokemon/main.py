"""tokemon CLI: one-shot table or auto-refreshing TUI."""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from rich.console import Console

from tokemon.discovery import discover_targets
from tokemon.polling import make_query
from tokemon.render import build_table
from tokemon.transport import UrllibTransport

DEFAULT_REFRESH_SECONDS = 300
DEFAULT_TIMEOUT_SECONDS = 15.0


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="tokemon",
        description="Token quota dashboard over yolo codex/claude profiles and pi provider credentials.",
    )
    parser.add_argument("--once", action="store_true", help="print the table once and exit")
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_REFRESH_SECONDS,
        metavar="SECONDS",
        help=f"auto-refresh interval (default {DEFAULT_REFRESH_SECONDS})",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        metavar="SECONDS",
        help=f"per-request HTTP timeout (default {DEFAULT_TIMEOUT_SECONDS:g})",
    )
    parser.add_argument(
        "--show-invalid",
        action="store_true",
        help="also list rows without quota data (errors, no quota endpoint); toggle with i in the TUI",
    )
    parser.add_argument(
        "--mask-logins",
        action="store_true",
        help="show only the first two characters of each login, the rest as stars",
    )
    parser.add_argument(
        "--mask-profiles",
        action="store_true",
        help="replace named yolo profile names with numbers, in the profile column and in paths",
    )
    parser.add_argument(
        "--home",
        type=Path,
        default=Path.home(),
        metavar="DIR",
        help="config home to walk (default: your home directory)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    console = Console()
    transport = UrllibTransport(timeout_seconds=args.timeout)
    if not discover_targets(args.home, os.environ):
        console.print(f"no codex or pi credentials found under {args.home}")
        return 1
    query = make_query(args.home, os.environ, transport)

    if args.once:
        results = query()
        now = datetime.now(timezone.utc)
        console.print(build_table(results, now, "one shot", args.show_invalid, args.mask_logins, args.mask_profiles))
        return 0

    from tokemon.tui import run_tui

    run_tui(query, args.interval, args.show_invalid, args.mask_logins, args.mask_profiles, console)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
