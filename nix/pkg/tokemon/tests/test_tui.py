"""TUI loop exit behaviour over the public run_tui entry (BA)."""

from __future__ import annotations

import io
import unittest
from datetime import datetime, timedelta

from rich.console import Console

from tokemon.tui import _refresh_note, run_tui


def _interrupting_query():
    raise KeyboardInterrupt


class TuiTests(unittest.TestCase):
    def test_ctrl_c_exits_cleanly(self):
        console = Console(file=io.StringIO(), width=120)
        run_tui(_interrupting_query, 60, False, False, False, console)

    def test_sets_and_restores_terminal_title(self):
        output = io.StringIO()
        console = Console(file=output, width=120, force_terminal=True)
        run_tui(_interrupting_query, 60, False, False, False, console)
        written = output.getvalue()
        push = written.find("\x1b[22;0t")
        title = written.find("\x1b]0;tokemon\x07")
        pop = written.find("\x1b[23;0t")
        self.assertTrue(0 <= push < title < pop, repr(written))

    def test_leaves_title_alone_when_not_a_terminal(self):
        output = io.StringIO()
        console = Console(file=output, width=120)
        run_tui(_interrupting_query, 60, False, False, False, console)
        self.assertNotIn("tokemon", output.getvalue())

    def test_title_note_reads_like_the_pane_title(self):
        refreshed = datetime(2026, 9, 29, 21, 1, 44).astimezone()
        due = refreshed + timedelta(seconds=300)
        now = refreshed + timedelta(seconds=49)
        self.assertEqual(
            _refresh_note(refreshed, due, now, False),
            "updated 21:01 · refresh in 4:11 · r refresh · i show invalid · q quit",
        )
        self.assertIn(" · i hide invalid · ", _refresh_note(refreshed, due, now, True))


if __name__ == "__main__":
    unittest.main()
