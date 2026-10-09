import contextlib
import io
import json
import os
import pty
import select
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from notify import FileTurnStore, Focus, MatrixSender, Notifier, Turn, parse_turn
from terminal import FOCUS_IN, FOCUS_OUT, FOCUS_REPORTING_OFF, FOCUS_REPORTING_ON, FocusInput, FocusOutput


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
                            notifier = Notifier(store, sender, clock.now, 60, True)
                            notifier.handle("start", turn, Focus.FOCUSED)
                            clock.value += 60
                            self.assertTrue(notifier.handle("complete", turn, Focus.UNFOCUSED))
                            self.assertTrue(notifier.handle("attention", turn, Focus.UNFOCUSED))
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
                "onlyWhenUnfocused": True,
            }))
            focus = root / "focus"
            environment = dict(os.environ, XDG_CACHE_HOME=str(root), PONYGIRLS_NOTIFY_FOCUS_FILE=str(focus))
            for harness in ("codex", "claude", "pi"):
                for state in (Focus.FOCUSED, Focus.UNFOCUSED):
                    with self.subTest(harness=harness, focus=state):
                        focus.write_text(state.value)
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
                        self.assertEqual(len(messages) - before, int(state == Focus.UNFOCUSED))
                        if state == Focus.UNFOCUSED:
                            self.assertEqual(messages[-1], f"agent: turn complete [{harness}] session")

    def test_completion_policy_across_harnesses_and_adapters(self):
        for real in (False, True):
            for harness in ("codex", "claude", "pi"):
                for seconds, focus, expected in (
                    (59, Focus.UNFOCUSED, False), (60, Focus.UNFOCUSED, True),
                    (61, Focus.FOCUSED, False), (61, Focus.UNKNOWN, False),
                ):
                    with self.subTest(real=real, harness=harness, seconds=seconds, focus=focus):
                        with adapters(real) as (store, sender, messages):
                            clock = Clock()
                            notifier = Notifier(store, sender, clock.now, 60, True)
                            turn = Turn(harness, "session", "turn")
                            notifier.handle("start", turn, Focus.FOCUSED)
                            clock.value += seconds
                            with contextlib.redirect_stderr(io.StringIO()):
                                self.assertEqual(notifier.handle("complete", turn, focus), expected)
                            self.assertEqual(len(messages), int(expected))
                            if expected:
                                self.assertEqual(messages[0], f"agent: turn complete [{harness}] session")

    def test_interleaved_turns_are_isolated_and_completion_is_consumed(self):
        for real in (False, True):
            with self.subTest(real=real), adapters(real) as (store, sender, messages):
                clock = Clock()
                notifier = Notifier(store, sender, clock.now, 60, True)
                first = Turn("codex", "session", "first")
                second = Turn("codex", "session", "second")
                notifier.handle("start", first, Focus.FOCUSED)
                clock.value += 50
                notifier.handle("start", second, Focus.FOCUSED)
                clock.value += 10
                self.assertTrue(notifier.handle("complete", first, Focus.UNFOCUSED))
                self.assertFalse(notifier.handle("complete", second, Focus.UNFOCUSED))
                with contextlib.redirect_stderr(io.StringIO()):
                    self.assertFalse(notifier.handle("complete", first, Focus.UNFOCUSED))
                self.assertEqual(len(messages), 1)

    def test_attention_does_not_require_a_long_turn_but_obeys_focus(self):
        for real in (False, True):
            with self.subTest(real=real), adapters(real) as (store, sender, messages):
                notifier = Notifier(store, sender, Clock().now, 60, True)
                turn = Turn("claude", "session", "")
                self.assertFalse(notifier.handle("attention", turn, Focus.FOCUSED))
                self.assertTrue(notifier.handle("attention", turn, Focus.UNFOCUSED))
                self.assertIn("input needed", messages[0])

    def test_duration_only_policy(self):
        for real in (False, True):
            with self.subTest(real=real), adapters(real) as (store, sender, messages):
                clock = Clock()
                notifier = Notifier(store, sender, clock.now, 60, False)
                turn = Turn("pi", "session", "")
                notifier.handle("start", turn, Focus.UNKNOWN)
                clock.value += 60
                self.assertTrue(notifier.handle("complete", turn, Focus.UNKNOWN))
                self.assertEqual(len(messages), 1)

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


class TerminalTests(unittest.TestCase):
    def test_focus_reports_survive_every_packet_boundary(self):
        data = FOCUS_OUT + FOCUS_IN + FOCUS_OUT
        for boundary in range(len(data) + 1):
            states: list[Focus] = []
            tracker = FocusInput(states.append)
            tracker.feed(data[:boundary])
            tracker.feed(data[boundary:])
            self.assertEqual(states, [Focus.UNFOCUSED, Focus.FOCUSED, Focus.UNFOCUSED])

    def test_typing_establishes_initial_focus(self):
        for key in (b"I", b"hello", b"\r"):
            states: list[Focus] = []
            FocusInput(states.append).feed(key)
            self.assertEqual(states, [Focus.FOCUSED])

    def test_child_cannot_disable_focus_reporting(self):
        data = b"before" + FOCUS_REPORTING_OFF + b"after"
        for boundary in range(len(data) + 1):
            tracker = FocusOutput()
            output = tracker.feed(data[:boundary]) + tracker.feed(data[boundary:]) + tracker.pending
            self.assertEqual(output, b"before" + FOCUS_REPORTING_ON + b"after")

    def test_real_terminal_forwards_focus_and_restores_terminal_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            child = cache / "child.py"
            child.write_text(
                "import os, pathlib, sys, tty\n"
                "tty.setraw(0)\n"
                "print('READY', flush=True)\n"
                "data = b''\n"
                "while len(data) < 3: data += os.read(0, 3 - len(data))\n"
                "print(pathlib.Path(os.environ['PONYGIRLS_NOTIFY_FOCUS_FILE']).read_text(), flush=True)\n"
            )
            master, slave = pty.openpty()
            environment = dict(os.environ, XDG_CACHE_HOME=str(cache))
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("terminal.py")),
                                        sys.executable, str(child)], stdin=slave, stdout=slave, stderr=slave, env=environment)
            os.close(slave)
            output = b""
            try:
                deadline = time.monotonic() + 10
                while b"READY" not in output:
                    self.assertLess(time.monotonic(), deadline, output)
                    if select.select([master], [], [], 0.1)[0]:
                        output += os.read(master, 8192)
                os.write(master, FOCUS_OUT[:1])
                os.write(master, FOCUS_OUT[1:])
                while process.poll() is None:
                    self.assertLess(time.monotonic(), deadline, output)
                    if select.select([master], [], [], 0.1)[0]:
                        try:
                            output += os.read(master, 8192)
                        except OSError:
                            break
                self.assertEqual(process.wait(timeout=5), 0, output)
                self.assertIn(b"unfocused", output)
                self.assertIn(FOCUS_REPORTING_OFF, output)
                self.assertEqual(list((cache / "ponygirls-notify" / "focus").iterdir()), [])
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
                os.close(master)

    def test_headless_invocation_is_background_and_preserves_exit_status(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = dict(os.environ, XDG_CACHE_HOME=directory)
            for ending, status in (("sys.exit(7)", 7), ("os.kill(os.getpid(),signal.SIGTERM)", 128 + signal.SIGTERM)):
                with self.subTest(ending=ending):
                    command = "import os,pathlib,signal,sys; print(pathlib.Path(os.environ['PONYGIRLS_NOTIFY_FOCUS_FILE']).read_text(),flush=True); " + ending
                    result = subprocess.run([sys.executable, str(Path(__file__).with_name("terminal.py")),
                                             sys.executable, "-c", command], capture_output=True, env=environment)
                    self.assertEqual(result.returncode, status, result.stderr)
                    self.assertEqual(result.stdout.strip(), b"unfocused")
                    self.assertEqual(list((Path(directory) / "ponygirls-notify" / "focus").iterdir()), [])

    def test_simultaneous_input_and_output_does_not_deadlock(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            child = cache / "child.py"
            child.write_text(
                "import os, tty\n"
                "tty.setraw(0)\n"
                "print('READY', flush=True)\n"
                "os.write(1, b'x' * 1048576)\n"
                "remaining = 65536\n"
                "while remaining: remaining -= len(os.read(0, remaining))\n"
                "print('DONE', flush=True)\n"
            )
            master, slave = pty.openpty()
            process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("terminal.py")),
                                        sys.executable, str(child)], stdin=slave, stdout=slave, stderr=slave,
                                       env=dict(os.environ, XDG_CACHE_HOME=str(cache)))
            os.close(slave)
            output = b""
            writer = None
            try:
                deadline = time.monotonic() + 5
                while b"READY" not in output:
                    self.assertLess(time.monotonic(), deadline, "child did not start")
                    if select.select([master], [], [], 0.1)[0]:
                        output += os.read(master, 8192)
                def write_input():
                    try:
                        remaining = b"y" * 65536
                        while remaining:
                            remaining = remaining[os.write(master, remaining):]
                    except OSError:
                        return
                writer = threading.Thread(target=write_input, daemon=True)
                writer.start()
                while process.poll() is None:
                    self.assertLess(time.monotonic(), deadline, "interleaved PTY input/output stalled")
                    if select.select([master], [], [], 0.1)[0]:
                        try:
                            output += os.read(master, 8192)
                        except OSError:
                            break
                self.assertEqual(process.wait(timeout=5), 0, output[-200:])
                self.assertIn(b"DONE", output)
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                os.close(master)
                if writer is not None:
                    writer.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
