import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

from tmux_context import CONTEXT_ENVIRONMENT_VARIABLE, PANE_TITLE_PREVIEW_LENGTH, TmuxPane, capture_pane, notification_pane


class TmuxContextTests(unittest.TestCase):
    def test_snapshot_keeps_zero_and_normalizes_display_text(self):
        environment = {CONTEXT_ENVIRONMENT_VARIABLE: json.dumps({"index": 0, "title": " backend | 雪\n branch\tname\x00 "})}
        self.assertEqual(notification_pane(environment, "/must-not-run"), TmuxPane(0, "backend | 雪 branch name"))
        self.assertEqual(len(TmuxPane(2, "x" * (PANE_TITLE_PREVIEW_LENGTH + 1)).title), PANE_TITLE_PREVIEW_LENGTH)

    def test_explicit_unavailable_snapshot_does_not_query(self):
        environment = {CONTEXT_ENVIRONMENT_VARIABLE: "null", "TMUX": "/must-not-connect,1,0", "TMUX_PANE": "%1"}
        self.assertIsNone(notification_pane(environment, "/must-not-run"))

    def test_malformed_snapshots_are_not_silent_fallbacks(self):
        for value in ("", "not json", "[]", '{"index":0}', '{"index":true,"title":"pane"}',
                      '{"index":-1,"title":"pane"}', '{"index":0,"title":3}',
                      '{"index":0,"title":"pane","socket":"private"}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                notification_pane({CONTEXT_ENVIRONMENT_VARIABLE: value}, "/must-not-run")

    def test_no_pane_or_isolated_context_never_queries_active_pane(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / "calls"
            command = root / "tmux"
            command.write_text(f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(calls)!r}).write_text('called')\n")
            command.chmod(0o700)
            for target in ("", "active", "%1;other", "0"):
                environment = {"TMUX": "/fake,1,0", "TMUX_PANE": target}
                self.assertIsNone(capture_pane(environment, str(command)))
            self.assertIsNone(notification_pane({"SMIND_SANDBOXED": "1", "TMUX": "/fake,1,0", "TMUX_PANE": "%1"}, str(command)))
            self.assertFalse(calls.exists())

    def test_lookup_failure_and_mismatched_wire_identity_are_unavailable(self):
        environment = dict(os.environ, TMUX="/fake,1,0", TMUX_PANE="%4")
        self.assertIsNone(capture_pane(environment, "/missing-tmux-command"))
        with tempfile.TemporaryDirectory() as directory:
            command = Path(directory) / "tmux"
            for wire in ("%5|0|wrong pane", "%4|invalid|pane", "%4|0", "%4|-1|pane"):
                with self.subTest(wire=wire):
                    command.write_text(f"#!{sys.executable}\nprint({wire!r})\n")
                    command.chmod(0o700)
                    self.assertIsNone(capture_pane(environment, str(command)))

    def test_wire_title_may_contain_separators_and_newlines(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = root / "tmux"
            calls = root / "calls"
            command.write_text(f"#!{sys.executable}\nimport json,sys\nfrom pathlib import Path\nPath({str(calls)!r}).write_text(json.dumps(sys.argv[1:]))\nprint('%4|0|backend | 雪\\nnext')\n")
            command.chmod(0o700)
            environment = dict(os.environ, TMUX="/private-source,1,0", TMUX_PANE="%4")
            self.assertEqual(capture_pane(environment, str(command)), TmuxPane(0, "backend | 雪 next"))
            arguments = json.loads(calls.read_text())
            self.assertEqual(arguments, ["-N", "-S", "/private-source", "display-message", "-p", "-t", "%4", "#{pane_id}|#{pane_index}|#{pane_title}"])


@unittest.skipUnless(os.environ.get("NOTIFY_TEST_TMUX"), "real tmux binary not configured")
class NativeTmuxContextTests(unittest.TestCase):
    def test_inactive_origin_pane_and_launch_snapshot(self):
        command = os.environ["NOTIFY_TEST_TMUX"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            socket = str(root / "server")
            environment = dict(os.environ, HOME=str(root), TMUX="", SMIND_SANDBOXED="0")
            environment.pop(CONTEXT_ENVIRONMENT_VARIABLE, None)

            def run(*arguments):
                return subprocess.run([command, "-u", "-S", socket, "-f", os.devnull, *arguments],
                                      env=environment, text=True, capture_output=True, timeout=5, check=True).stdout.strip()

            try:
                source = run("new-session", "-d", "-s", "notify", "-P", "-F", "#{pane_id}",
                             sys.executable, "-c", "import time; time.sleep(60)")
                run("select-pane", "-t", source, "-T", "backend | 雪")
                other = run("split-window", "-d", "-t", source, "-P", "-F", "#{pane_id}",
                            sys.executable, "-c", "import time; time.sleep(60)")
                run("select-pane", "-t", other, "-T", "active different pane")
                run("select-pane", "-t", other)
                query_environment = dict(environment, TMUX=f"{socket},0,0", TMUX_PANE=source)
                pane = capture_pane(query_environment, command)
                self.assertEqual(pane, TmuxPane(0, "backend | 雪"))
                captured = subprocess.run([sys.executable, str(Path(__file__).with_name("tmux_context.py")), "--tmux", command],
                                          env=query_environment, text=True, capture_output=True, timeout=5, check=True)
                self.assertEqual(json.loads(captured.stdout), asdict(pane))
                run("select-pane", "-t", source, "-T", "renamed")
                snapshot_environment = dict(query_environment, SMIND_TMUX_PANE_CONTEXT=json.dumps(asdict(pane)))
                self.assertEqual(notification_pane(snapshot_environment, command), pane)
                self.assertEqual(notification_pane(query_environment, command), TmuxPane(0, "renamed"))
            finally:
                subprocess.run([command, "-S", socket, "kill-server"], env=environment,
                               capture_output=True, timeout=5, check=False)
