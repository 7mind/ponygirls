import json
import os
import subprocess
import sys
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path
from unittest.mock import Mock

from notify import FileTurnStore, Notifier, Sender, Turn
from tmux_context import CONTEXT_ENVIRONMENT_VARIABLE, WINDOW_NAME_PREVIEW_LENGTH, TmuxWindow, capture_window, notification_window


class TmuxContextTests(unittest.TestCase):
    def test_snapshot_keeps_zero_and_normalizes_display_text(self):
        environment = {CONTEXT_ENVIRONMENT_VARIABLE: json.dumps({"index": 0, "name": " backend | 雪\n branch\tname\x00 "})}
        self.assertEqual(notification_window(environment, "/must-not-run"), TmuxWindow(0, "backend | 雪 branch name"))
        self.assertEqual(len(TmuxWindow(2, "x" * (WINDOW_NAME_PREVIEW_LENGTH + 1)).name), WINDOW_NAME_PREVIEW_LENGTH)

    def test_explicit_unavailable_snapshot_does_not_query(self):
        environment = {CONTEXT_ENVIRONMENT_VARIABLE: "null", "TMUX": "/must-not-connect,1,0", "TMUX_PANE": "%1"}
        self.assertIsNone(notification_window(environment, "/must-not-run"))

    def test_malformed_snapshots_are_not_silent_fallbacks(self):
        for value in ("", "not json", "[]", "true", "3", '{"index":0}', '{"index":true,"name":"window"}',
                      '{"index":-1,"name":"window"}', '{"index":0.5,"name":"window"}', '{"index":0,"name":3}',
                      '{"index":0,"name":null}', '{"index":0,"title":"old pane label"}',
                      '{"index":0,"name":"window","socket":"private"}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                notification_window({CONTEXT_ENVIRONMENT_VARIABLE: value}, "/must-not-run")

    def test_old_pane_snapshot_is_not_reinterpreted_in_sandbox(self):
        environment = {"SMIND_SANDBOXED": "1", "SMIND_TMUX_PANE_CONTEXT": '{"index":1,"title":"old pane label"}',
                       "TMUX": "/must-not-connect,1,0", "TMUX_PANE": "%1"}
        self.assertIsNone(notification_window(environment, "/must-not-run"))

    def test_no_pane_or_isolated_context_never_queries_active_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / "calls"
            command = root / "tmux"
            command.write_text(f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(calls)!r}).write_text('called')\n")
            command.chmod(0o700)
            for target in ("", "active", "%1;other", "0"):
                environment = {"TMUX": "/fake,1,0", "TMUX_PANE": target}
                self.assertIsNone(capture_window(environment, str(command)))
            self.assertIsNone(notification_window({"SMIND_SANDBOXED": "1", "TMUX": "/fake,1,0", "TMUX_PANE": "%1"}, str(command)))
            self.assertFalse(calls.exists())

    def test_lookup_failure_and_mismatched_wire_identity_are_unavailable(self):
        environment = dict(os.environ, TMUX="/fake,1,0", TMUX_PANE="%4")
        self.assertIsNone(capture_window(environment, "/missing-tmux-command"))
        with tempfile.TemporaryDirectory() as directory:
            command = Path(directory) / "tmux"
            for wire in ("%5|0|wrong pane", "%4|invalid|pane", "%4|0", "%4|-1|pane"):
                with self.subTest(wire=wire):
                    command.write_text(f"#!{sys.executable}\nprint({wire!r})\n")
                    command.chmod(0o700)
                    self.assertIsNone(capture_window(environment, str(command)))

    def test_wire_name_may_contain_separators_and_newlines(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = root / "tmux"
            calls = root / "calls"
            command.write_text(f"#!{sys.executable}\nimport json,sys\nfrom pathlib import Path\nPath({str(calls)!r}).write_text(json.dumps(sys.argv[1:]))\nprint('%4|0|backend | 雪\\nnext')\n")
            command.chmod(0o700)
            environment = dict(os.environ, TMUX="/private-source,1,0", TMUX_PANE="%4")
            self.assertEqual(capture_window(environment, str(command)), TmuxWindow(0, "backend | 雪 next"))
            arguments = json.loads(calls.read_text())
            self.assertEqual(arguments, ["-N", "-S", "/private-source", "display-message", "-p", "-t", "%4", "#{pane_id}|#{window_index}|#{window_name}"])


@unittest.skipUnless(os.environ.get("NOTIFY_TEST_TMUX"), "real tmux binary not configured")
class NativeTmuxContextTests(unittest.TestCase):
    def test_inactive_origin_window_and_launch_snapshot(self):
        command = os.environ["NOTIFY_TEST_TMUX"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            socket = str(root / "server")
            environment = dict(os.environ, HOME=str(root), TMUX="", SMIND_SANDBOXED="0")
            environment.pop(CONTEXT_ENVIRONMENT_VARIABLE, None)

            def run(*arguments):
                result = subprocess.run([command, "-u", "-S", socket, "-f", os.devnull, *arguments],
                                        env=environment, text=True, capture_output=True, timeout=5, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout.strip()

            try:
                bootstrap = run("new-session", "-d", "-s", "notify", "-P", "-F", "#{pane_id}",
                                sys.executable, "-c", "import time; time.sleep(60)")
                run("rename-window", "-t", "notify:0", "zero window")
                self.assertEqual(capture_window(dict(environment, TMUX=f"{socket},0,0", TMUX_PANE=bootstrap), command),
                                 TmuxWindow(0, "zero window"))
                run("move-window", "-s", "notify:0", "-t", "notify:3")
                run("set-option", "-w", "-t", "notify:3", "automatic-rename", "off")
                run("rename-window", "-t", "notify:3", "backend | 雪 branch")
                source = run("split-window", "-d", "-t", bootstrap, "-P", "-F", "#{pane_id}",
                             sys.executable, "-c", "import time; time.sleep(60)")
                run("select-pane", "-t", source, "-T", "different pane title")
                other = run("new-window", "-t", "notify:4", "-n", "active other window", "-P", "-F", "#{pane_id}",
                            sys.executable, "-c", "import time; time.sleep(60)")
                run("select-window", "-t", "notify:4")
                self.assertEqual(run("display-message", "-p", "-t", source, "#{pane_index}|#{window_index}"), "1|3")
                self.assertEqual(run("display-message", "-p", "#{pane_id}"), other)
                query_environment = dict(environment, TMUX=f"{socket},0,0", TMUX_PANE=source)
                window = capture_window(query_environment, command)
                with self.subTest(observation="captured metadata"):
                    self.assertEqual(window, TmuxWindow(3, "backend | 雪 branch"))
                sender = Mock(spec=Sender)
                notifier = Notifier(FileTurnStore(root / "turns"), sender, lambda: 0, 60,
                                    window_context=lambda: notification_window(query_environment, command))
                self.assertTrue(notifier.handle("attention", Turn("pi", "session", "turn")))
                with self.subTest(observation="emitted notification"):
                    sender.send.assert_called_once_with("agent: input needed [pi] session [tmux window 3: backend | 雪 branch]")
                captured = subprocess.run([sys.executable, str(Path(__file__).with_name("tmux_context.py")), "--tmux", command],
                                          env=query_environment, text=True, capture_output=True, timeout=5, check=True)
                self.assertEqual(json.loads(captured.stdout), asdict(window))
                run("rename-window", "-t", "notify:3", "renamed")
                snapshot_environment = dict(query_environment, SMIND_TMUX_WINDOW_CONTEXT=json.dumps(asdict(window)))
                self.assertEqual(notification_window(snapshot_environment, command), window)
                self.assertEqual(notification_window(query_environment, command), TmuxWindow(3, "renamed"))
                run("kill-pane", "-t", source)
                self.assertIsNone(capture_window(query_environment, command))
            finally:
                subprocess.run([command, "-S", socket, "kill-server"], env=environment,
                               capture_output=True, timeout=5, check=False)
                disconnected = subprocess.run([command, "-N", "-S", socket, "list-sessions"], env=environment,
                                              capture_output=True, timeout=5, check=False)
                self.assertNotEqual(disconnected.returncode, 0)
