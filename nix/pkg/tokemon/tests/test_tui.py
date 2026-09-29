"""TUI loop exit behaviour over the public run_tui entry (BA)."""

from __future__ import annotations

import io
import unittest

from rich.console import Console

from tokemon.tui import run_tui


def _interrupting_query():
    raise KeyboardInterrupt


class TuiTests(unittest.TestCase):
    def test_ctrl_c_exits_cleanly(self):
        console = Console(file=io.StringIO(), width=120)
        run_tui(_interrupting_query, 60, False, False, False, console)


if __name__ == "__main__":
    unittest.main()
