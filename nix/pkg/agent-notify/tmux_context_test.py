import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from notify import FileTurnStore, Notifier, Sender, Turn
from tmux_context import WINDOW_NAME_PREVIEW_LENGTH, TmuxWindow, notification_window


class TmuxContextTests(unittest.TestCase):
    def test_label_is_normalized_and_bounded(self):
        self.assertEqual(TmuxWindow(0, " backend | 雪\n branch\tname\x00 ").name, "backend | 雪 branch name")
        self.assertEqual(len(TmuxWindow(2, "x" * (WINDOW_NAME_PREVIEW_LENGTH + 1)).name), WINDOW_NAME_PREVIEW_LENGTH)

    def test_unusable_origin_or_sandbox_selector_never_runs_tmux(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = root / "calls"
            command = root / "tmux"
            command.write_text(f"#!{sys.executable}\nfrom pathlib import Path\nPath({str(calls)!r}).write_text('called')\n")
            command.chmod(0o700)
            origin = {"TMUX": "/fake,1,0", "TMUX_PANE": "%1", "PATH": str(root)}
            for invalid in ({}, {"TMUX_PANE": "active"}, {"TMUX_PANE": "%1;other"}, {"TMUX_PANE": "0"},
                            {"TMUX": ""}, {"TMUX": "relative,1,0"}):
                environment = dict(origin, **invalid) if invalid else {"TMUX": origin["TMUX"]}
                with self.subTest(environment=environment):
                    self.assertIsNone(notification_window(environment, str(command)))
                    self.assertIsNone(notification_window(
                        dict(environment, SMIND_SANDBOXED="1", SMIND_TMUX_COMMAND=str(command)), str(command),
                    ))
            for selector in ({}, {"SMIND_TMUX_COMMAND": ""}, {"SMIND_TMUX_COMMAND": "tmux"},
                             {"SMIND_TMUX_COMMAND": str(root / "missing")}):
                with self.subTest(selector=selector):
                    self.assertIsNone(notification_window(dict(origin, SMIND_SANDBOXED="1", **selector), str(command)))
            self.assertFalse(calls.exists())

    def test_lookup_failure_and_mismatched_wire_identity_are_unavailable(self):
        origin = {"TMUX": "/fake,1,0", "TMUX_PANE": "%4"}
        with tempfile.TemporaryDirectory() as directory:
            command = Path(directory) / "tmux"
            self.assertIsNone(notification_window(origin, str(command)))
            for program in (
                "print('%5|0|wrong pane')",
                "print('%4|invalid|pane')",
                "print('%4|0')",
                "print('%4|-1|pane')",
                "import sys; sys.stdout.buffer.write(b'%4|0|\\xff')",
                "print('%4|0|valid wire'); raise SystemExit(1)",
                "import time; time.sleep(60)",
            ):
                with self.subTest(program=program):
                    command.write_text(f"#!{sys.executable}\n{program}\n")
                    command.chmod(0o700)
                    self.assertIsNone(notification_window(origin, str(command)))

    def test_selected_command_receives_the_same_native_query(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            command = root / "tmux"
            calls = root / "calls"
            command.write_text(f"#!{sys.executable}\nimport json,sys\nfrom pathlib import Path\nPath({str(calls)!r}).write_text(json.dumps(sys.argv[1:]))\nprint('%4|0|backend | 雪\\nnext')\n")
            command.chmod(0o700)
            for sandboxed in (False, True):
                with self.subTest(sandboxed=sandboxed):
                    calls.unlink(missing_ok=True)
                    environment = {"TMUX": "/private-source,1,0", "TMUX_PANE": "%4",
                                   "SMIND_TMUX_WINDOW_CONTEXT": '{"index":7,"name":"stale snapshot"}'}
                    if sandboxed:
                        environment.update(SMIND_SANDBOXED="1", SMIND_TMUX_COMMAND=str(command))
                    else:
                        environment["SMIND_TMUX_COMMAND"] = str(root / "must-not-run")
                    configured = str(root / "must-not-run") if sandboxed else str(command)
                    window = notification_window(environment, configured)
                    self.assertTrue(calls.exists(), "the selected tmux executable did not receive the query")
                    self.assertEqual(json.loads(calls.read_text()), [
                        "-N", "-S", "/private-source", "display-message", "-p", "-t", "%4",
                        "#{pane_id}|#{window_index}|#{?#{!=:#{@smind_window_label_format},},"
                        "#{P:#{?pane_active,#{E:@smind_window_label_format},}},#{window_name}}",
                    ])
                    self.assertEqual(window, TmuxWindow(0, "backend | 雪 next"))


@unittest.skipUnless(os.environ.get("NOTIFY_TEST_TMUX"), "real tmux binary not configured")
class NativeTmuxContextTests(unittest.TestCase):
    def test_inactive_origin_window_is_queried_when_notifying(self):
        command = os.environ["NOTIFY_TEST_TMUX"]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            socket = str(root / "server")
            environment = dict(os.environ, HOME=str(root), TMUX="", SMIND_SANDBOXED="0")

            def run(*arguments):
                result = subprocess.run([command, "-u", "-S", socket, "-f", os.devnull, *arguments],
                                        env=environment, text=True, capture_output=True, timeout=5, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout.strip()

            try:
                project = root / "ponygirls"
                project.mkdir()
                bootstrap = run("new-session", "-d", "-s", "notify", "-c", str(project), "-P", "-F", "#{pane_id}",
                                "bash", "--noprofile", "--norc")
                run("rename-window", "-t", "notify:0", "zero window")
                self.assertEqual(notification_window(dict(environment, TMUX=f"{socket},0,0", TMUX_PANE=bootstrap), command),
                                 TmuxWindow(0, "zero window"))
                run("move-window", "-s", "notify:0", "-t", "notify:3")
                run("set-option", "-w", "-t", "notify:3", "automatic-rename", "on")
                run("set-option", "-gw", "@smind_window_label_format",
                    "#{?automatic-rename,#{b:pane_current_path}:#{pane_current_command},#{window_name}}")
                source = run("split-window", "-d", "-c", str(root), "-t", bootstrap, "-P", "-F", "#{pane_id}",
                             sys.executable, "-c", "import time; time.sleep(60)")
                run("select-pane", "-t", source, "-T", "different pane title")
                other = run("new-window", "-t", "notify:4", "-n", "active other window", "-P", "-F", "#{pane_id}",
                            sys.executable, "-c", "import time; time.sleep(60)")
                run("select-window", "-t", "notify:4")
                self.assertEqual(run("display-message", "-p", "-t", source, "#{pane_index}|#{window_index}"), "1|3")
                self.assertEqual(run("display-message", "-p", "#{pane_id}"), other)
                query_environment = dict(environment, TMUX=f"{socket},0,0", TMUX_PANE=source)
                sender = Mock(spec=Sender)
                notifier = Notifier(FileTurnStore(root / "turns"), sender, lambda: 0, 60,
                                    window_context=lambda: notification_window(query_environment, command))
                turn = Turn("pi", "session", "turn")

                def assert_notification(suffix):
                    sender.reset_mock()
                    self.assertTrue(notifier.handle("attention", turn))
                    sender.send.assert_called_once_with(f"agent: input needed [pi] session{suffix}")

                assert_notification(" [tmux window 3: ponygirls:bash]")
                run("rename-window", "-t", "notify:3", "backend | 雪 branch")
                run("move-window", "-d", "-s", "notify:3", "-t", "notify:5")
                self.assertEqual(run("display-message", "-p", "#{pane_id}"), other)
                assert_notification(" [tmux window 5: backend | 雪 branch]")
                run("set-option", "-gw", "@smind_window_label_format", "0")
                self.assertEqual(notification_window(query_environment, command), TmuxWindow(5, "0"))
                run("kill-pane", "-t", source)
                assert_notification("")
            finally:
                subprocess.run([command, "-S", socket, "kill-server"], env=environment,
                               capture_output=True, timeout=5, check=False)
                disconnected = subprocess.run([command, "-N", "-S", socket, "list-sessions"], env=environment,
                                              capture_output=True, timeout=5, check=False)
                self.assertNotEqual(disconnected.returncode, 0)
