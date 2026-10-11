import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from unittest import mock
from notify import FileTurnStore, MatrixSender, Notifier, Turn, make_sender, parse_turn


class MemoryTurnStore:
    def __init__(self):
        self.started: dict[str, float] = {}

    def begin(self, key: str, started: float) -> None:
        self.started[key] = started

    def finish(self, key: str) -> float | None:
        return self.started.pop(key, None)


class MemorySender:
    def __init__(self, messages: list[str]):
        self.messages = messages

    def send(self, body: str) -> None:
        self.messages.append(body)


class Clock:
    def __init__(self):
        self.value = 1000.0

    def now(self) -> float:
        return self.value


@contextlib.contextmanager
def adapters(real: bool):
    messages: list[str] = []
    if not real:
        yield MemoryTurnStore(), MemorySender(messages), messages
        return

    class Receiver(BaseHTTPRequestHandler):
        def do_PUT(self):
            if self.headers["Authorization"] != "Bearer test-token":
                self.send_error(401)
                return
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            messages.append(payload["body"])
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b'{"event_id":"$test"}')

        def log_message(self, *args):
            pass

    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        token = root / "token"
        token.write_text("test-token")
        server = HTTPServer(("127.0.0.1", 0), Receiver)
        worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        worker.start()
        try:
            sender = MatrixSender(f"http://127.0.0.1:{server.server_port}", "!room:test", token)
            yield FileTurnStore(root / "turns"), sender, messages
        finally:
            server.shutdown()
            worker.join()
            server.server_close()


class NotificationTests(unittest.TestCase):
    def test_notifications_contain_only_metadata(self):
        for real in (False, True):
            for harness in ("codex", "claude", "pi"):
                for field in ("message", "title", "last_assistant_message", "last-assistant-message"):
                    with self.subTest(real=real, harness=harness, field=field):
                        with adapters(real) as (store, sender, messages):
                            turn = parse_turn(harness, json.dumps({
                                "session_id": "session", "turn_id": "turn", "cwd": "/work/repo",
                                field: "private agent response text",
                            }))
                            clock = Clock()
                            notifier = Notifier(store, sender, clock.now, 60)
                            notifier.handle("start", turn)
                            clock.value += 60
                            self.assertTrue(notifier.handle("complete", turn))
                            self.assertTrue(notifier.handle("attention", turn))
                            self.assertEqual(messages, [
                                f"agent: turn complete [{harness}] session",
                                f"agent: input needed [{harness}] session",
                            ])

    def test_client_callbacks_deliver_through_the_command_line(self):
        with adapters(True) as (_store, sender, messages), tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({
                "homeserver": sender.homeserver,
                "roomId": "!room:test",
                "tokenFile": str(sender.token_file),
                "minTurnSeconds": 0,
            }))
            environment = dict(os.environ, XDG_CACHE_HOME=str(root))
            for harness in ("codex", "claude", "pi"):
                with self.subTest(harness=harness):
                    start = {"session_id": "session", "cwd": "/repo"}
                    complete = dict(start, last_assistant_message="done")
                    if harness == "codex":
                        start["turn_id"] = "turn"
                        complete = {"thread-id": "session", "turn-id": "turn", "cwd": "/repo", "last-assistant-message": "done"}
                    before = len(messages)
                    for action, payload in ((["--start"], start), ([], complete)):
                        command = [sys.executable, str(Path(__file__).with_name("notify.py")), str(config), harness] + action
                        encoded = json.dumps(payload)
                        result = subprocess.run(command + ([encoded] if harness != "claude" else []),
                                                input=encoded if harness == "claude" else None,
                                                text=True, capture_output=True, env=environment, timeout=5)
                        self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(len(messages) - before, 1)
                    self.assertEqual(messages[-1], f"agent: turn complete [{harness}] session")

    def test_completion_policy_across_harnesses_and_adapters(self):
        for real in (False, True):
            for harness in ("codex", "claude", "pi"):
                for seconds, expected in ((59, False), (60, True), (61, True)):
                    with self.subTest(real=real, harness=harness, seconds=seconds):
                        with adapters(real) as (store, sender, messages):
                            clock = Clock()
                            notifier = Notifier(store, sender, clock.now, 60)
                            turn = Turn(harness, "session", "turn")
                            notifier.handle("start", turn)
                            clock.value += seconds
                            with contextlib.redirect_stderr(io.StringIO()):
                                self.assertEqual(notifier.handle("complete", turn), expected)
                            self.assertEqual(len(messages), int(expected))
                            if expected:
                                self.assertEqual(messages[0], f"agent: turn complete [{harness}] session")

    def test_interleaved_turns_are_isolated_and_completion_is_consumed(self):
        for real in (False, True):
            with self.subTest(real=real), adapters(real) as (store, sender, messages):
                clock = Clock()
                notifier = Notifier(store, sender, clock.now, 60)
                first = Turn("codex", "session", "first")
                second = Turn("codex", "session", "second")
                notifier.handle("start", first)
                clock.value += 50
                notifier.handle("start", second)
                clock.value += 10
                self.assertTrue(notifier.handle("complete", first))
                self.assertFalse(notifier.handle("complete", second))
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertFalse(notifier.handle("complete", first))
                self.assertEqual(len(messages), 1)

    def test_attention_does_not_require_a_long_turn(self):
        for real in (False, True):
            with self.subTest(real=real), adapters(real) as (store, sender, messages):
                notifier = Notifier(store, sender, Clock().now, 60)
                turn = Turn("claude", "session", "")
                self.assertTrue(notifier.handle("attention", turn))
                self.assertIn("input needed", messages[0])

    def test_payloads_keep_session_and_turn_identity(self):
        for harness, payload in (
            ("codex", {"thread-id": "session", "turn-id": "turn", "last-assistant-message": "done"}),
            ("codex", {"session_id": "session", "turn_id": "turn", "last_assistant_message": "done"}),
            ("claude", {"session_id": "session", "last_assistant_message": "done"}),
            ("pi", {"session_id": "session"}),
        ):
            with self.subTest(harness=harness, payload=payload):
                turn = parse_turn(harness, json.dumps(payload))
                self.assertEqual(turn.session, "session")
        with self.assertRaisesRegex(ValueError, "session identifier"):
            parse_turn("codex", "{}")


class CommandLineTests(unittest.TestCase):
    def run_cli(self, config, arguments, payload=None):
        environment = dict(os.environ)
        command = [sys.executable, str(Path(__file__).with_name("notify.py")), str(config)] + arguments
        return subprocess.run(command, input=payload, text=True, capture_output=True,
                              env=environment, timeout=30)

    def write_config(self, root, extra=None):
        config = root / "config.json"
        body = {
            "homeserver": "https://matrix.test",
            "roomId": "!room:test",
            "tokenFile": "/tmp/test-token",
            "minTurnSeconds": 0,
        }
        if extra:
            body.update(extra)
        config.write_text(json.dumps(body))
        return config

    def test_help_lists_setup_and_manual_test(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(Path(directory))
            result = self.run_cli(config, ["--help"])
            self.assertEqual(result.returncode, 0)
            self.assertIn("--setup", result.stdout)
            self.assertIn("--attention", result.stdout)

    def test_setup_does_not_need_harness(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(Path(directory))
            result = self.run_cli(config, ["--setup"])
            self.assertEqual(result.returncode, 1)
            self.assertIn("--setup requires e2ee transport", result.stderr)

    def test_manual_attention_ping_without_turn(self):
        with adapters(True) as (_store, sender, messages), tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "config.json"
            config.write_text(json.dumps({
                "homeserver": sender.homeserver,
                "roomId": "!room:test",
                "tokenFile": str(sender.token_file),
                "minTurnSeconds": 0,
            }))
            payload = json.dumps({"session_id": "manual"})
            result = self.run_cli(config, ["pi", "--attention", payload])
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(messages, ["agent: input needed [pi] manual"])


class E2EESelectionTests(unittest.TestCase):
    def base_config(self):
        return {
            "homeserver": "https://matrix.test",
            "roomId": "!room:test",
            "tokenFile": "/tmp/test-token",
            "minTurnSeconds": 0,
            "onlyWhenUnfocused": False,
        }

    def test_plaintext_stays_default_without_transport_key(self):
        sender = make_sender(self.base_config())
        self.assertIsInstance(sender, MatrixSender)

    def test_e2ee_selects_nio_sender_without_network(self):
        from matrix_e2ee import NioMatrixSender
        config = dict(self.base_config(), transport="e2ee", sender="@bot:test", passwordFile=None)
        sender = make_sender(config)
        self.assertIsInstance(sender, NioMatrixSender)
        self.assertEqual(sender.room, "!room:test")

    def test_unprovisioned_e2ee_send_fails_closed(self):
        from matrix_e2ee import NioMatrixSender
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": directory}):
                sender = NioMatrixSender("https://matrix.test", "!room:test", "@bot:test")
                with self.assertRaisesRegex(ValueError, "not provisioned"):
                    sender.send("hello")


if __name__ == "__main__":
    unittest.main()
