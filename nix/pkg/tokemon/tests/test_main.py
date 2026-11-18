"""One-shot output over the public main entry: the table obeys the width
rules when piped (BA). The providers used here need no network."""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rich.cells import cell_len

from tokemon.main import main

ALL_HEADERS = {"Provider", "Profile", "Src", "Login", "Plan", "Window", "Used / limit", "Usage", "Resets", "Status"}
NEVER_HIDDEN = {"Provider", "Profile", "Window", "Used / limit", "Status"}


def _once(columns: int) -> list[str]:
    """`tokemon --once --show-invalid` piped, with COLUMNS set."""
    with tempfile.TemporaryDirectory() as tmp:
        agent = Path(tmp) / ".pi" / "agent"
        agent.mkdir(parents=True)
        # xiaomi has no quota endpoint; a models.json provider has no stored credential.
        (agent / "auth.json").write_text(json.dumps({"xiaomi": {"type": "api_key", "key": "k"}}))
        (agent / "models.json").write_text(json.dumps({"providers": {"zai": {}}}))
        output = io.StringIO()
        # Provider keys in the ambient environment would add real, networked targets.
        environ = {"COLUMNS": str(columns), "HOME": tmp}
        with mock.patch.dict(os.environ, environ, clear=True), contextlib.redirect_stdout(output):
            status = main(["--once", "--show-invalid", "--no-refresh-tokens", "--home", tmp])
    assert status == 0, status
    return [line.rstrip() for line in output.getvalue().splitlines()]


def _cells(line: str) -> list[str]:
    return re.split(r"\s{2,}", line.strip())


class OnceOutputTests(unittest.TestCase):
    def test_piped_output_is_a_plain_table_at_the_width_of_columns(self):
        self.assertEqual(
            _once(100),
            [
                "Provider  Profile  Window  Used / limit  Usage  Status",
                "xiaomi    default  —                  —  —      no quota endpoint",
                "zai       default  —                  —  —      models.json provider without stored credential",
                "hidden at this width: Src, Login, Plan, Resets",
            ],
        )

    def test_piped_output_hides_columns_instead_of_squeezing_them(self):
        for columns in (60, 80, 100, 140, 170):
            with self.subTest(columns=columns):
                lines = _once(columns)
                self.assertTrue(all(cell_len(line) <= columns for line in lines), lines)
                headers = _cells(lines[0])
                self.assertTrue(NEVER_HIDDEN <= set(headers) <= ALL_HEADERS, lines[0])
                self.assertEqual([_cells(line)[0] for line in lines if "default" in line], ["xiaomi", "zai"])
                self.assertTrue(any(line.startswith("xiaomi") and line.endswith("no quota endpoint") for line in lines), lines)


if __name__ == "__main__":
    unittest.main()
