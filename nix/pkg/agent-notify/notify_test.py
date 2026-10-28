import base64
import contextlib
import hashlib
import hmac as hmac_module
import importlib.util
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

    def test_garbage_payload_says_what_was_expected(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(Path(directory))
            result = self.run_cli(config, ["pi", "--attention", "abc"])
            self.assertEqual(result.returncode, 1)
            self.assertIn("must be a JSON object with a session identifier", result.stderr)
            self.assertIn("'abc'", result.stderr)

    def test_missing_payload_says_what_was_expected(self):
        with tempfile.TemporaryDirectory() as directory:
            config = self.write_config(Path(directory))
            command = [sys.executable, str(Path(__file__).with_name("notify.py")), str(config),
                       "pi", "--attention"]
            with open(os.devnull) as void:
                result = subprocess.run(command, stdin=void, text=True, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 1)
            self.assertIn("must be a JSON object with a session identifier", result.stderr)

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


class MessageDetailTests(unittest.TestCase):
    def notify(self, payload, **flags):
        arguments = {"show_message": False, "show_workdir": False, "show_hostname": False}
        arguments.update(flags)
        messages = []
        notifier = Notifier(MemoryTurnStore(), MemorySender(messages), Clock().now, 0, **arguments)
        turn = parse_turn("pi", json.dumps(payload))
        with mock.patch("notify.socket.gethostname", return_value="testhost"):
            self.assertTrue(notifier.handle("attention", turn))
        return messages

    def test_detail_flags_default_off(self):
        payload = {"session_id": "s", "cwd": "/srv/api", "message": "do it"}
        self.assertEqual(self.notify(payload), ["agent: input needed [pi] s"])

    def test_all_detail_flags_on(self):
        payload = {"session_id": "s", "cwd": "/srv/api", "message": "do it"}
        self.assertEqual(
            self.notify(payload, show_message=True, show_workdir=True, show_hostname=True),
            ["agent: input needed [pi] s @ /srv/api on testhost: do it"],
        )

    def test_message_truncates_at_200_characters(self):
        payload = {"session_id": "s", "message": "x" * 500}
        self.assertEqual(self.notify(payload, show_message=True), [f"agent: input needed [pi] s: {'x' * 200}"])

    def test_empty_fields_omit_their_segments(self):
        payload = {"session_id": "s"}
        self.assertEqual(
            self.notify(payload, show_message=True, show_workdir=True, show_hostname=True),
            ["agent: input needed [pi] s on testhost"],
        )


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
        config = dict(self.base_config(), transport="e2ee", sender="@bot:test", passwordFile=None,
                        recoveryKeyFile="/run/secrets/recovery")
        sender = make_sender(config)
        self.assertIsInstance(sender, NioMatrixSender)
        self.assertEqual(sender.room, "!room:test")
        self.assertEqual(str(sender.recovery_key_file), "/run/secrets/recovery")

    def test_unprovisioned_e2ee_send_without_password_fails_closed(self):
        from matrix_e2ee import NioMatrixSender
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": directory}):
                sender = NioMatrixSender("https://matrix.test", "!room:test", "@bot:test")
                with self.assertRaisesRegex(ValueError, "no passwordFile is configured"):
                    sender.send("hello")

    def test_unprovisioned_e2ee_send_provisions_on_first_use(self):
        from matrix_e2ee import NioMatrixSender
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": directory}):
                sender = NioMatrixSender("https://matrix.test", "!room:test", "@bot:test")
                calls = []

                def provision():
                    calls.append(1)
                    store = Path(directory) / "agent-notify-matrix"
                    store.mkdir(parents=True, exist_ok=True)
                    (store / "session.json").write_text(json.dumps({
                        "user_id": "@bot:test", "device_id": "DEVICE", "access_token": "token",
                    }))

                with mock.patch.object(sender, "_setup", side_effect=provision):
                    self.assertEqual(sender._session(), ("@bot:test", "DEVICE", "token"))
                    self.assertEqual(sender._session(), ("@bot:test", "DEVICE", "token"))
                self.assertEqual(len(calls), 1)


def _unpadded(value):
    return base64.b64encode(value).decode().rstrip("=")


def _spec_hkdf(key, info, length=64):
    prk = hmac_module.new(b"\x00" * 32, key, hashlib.sha256).digest()
    output = b""
    block = b""
    counter = 1
    while len(output) < length:
        block = hmac_module.new(prk, block + info + bytes((counter,)), hashlib.sha256).digest()
        output += block
        counter += 1
    return output[:length]


def _spec_encrypt(storage_key, name, plaintext, iv):
    from Crypto.Cipher import AES
    derived = _spec_hkdf(storage_key, name.encode())
    cipher = AES.new(derived[:32], AES.MODE_CTR, initial_value=int.from_bytes(iv, "big"), nonce=b"")
    ciphertext = cipher.encrypt(plaintext)
    return {
        "iv": _unpadded(iv),
        "ciphertext": _unpadded(ciphertext),
        "mac": _unpadded(hmac_module.new(derived[32:], ciphertext, hashlib.sha256).digest()),
    }


HAS_CRYPTO = importlib.util.find_spec("Crypto") is not None
HAS_VODOZEMAC = importlib.util.find_spec("vodozemac") is not None


@unittest.skipUnless(HAS_CRYPTO, "pycryptodome unavailable")
class RecoveryKeyTests(unittest.TestCase):
    def test_recovers_key_from_frozen_element_format_vector(self):
        from matrix_e2ee import decode_recovery_key
        self.assertEqual(
            decode_recovery_key("EsSz ykH7 LCZx 7Cae cmKD wcmY JRXi Ybtu 8iQ3 t8Ez nRwK pUY1"),
            bytes(range(32)),
        )
        self.assertEqual(
            decode_recovery_key("EsSzykH7LCZx7CaecmKDwcmYJRXiYbtu8iQ3t8EznRwKpUY1"),
            bytes(range(32)),
        )

    def test_rejects_tampered_recovery_key(self):
        from matrix_e2ee import decode_recovery_key
        with self.assertRaisesRegex(ValueError, "parity"):
            decode_recovery_key("EsSz ykH7 LCZx 7Cae cmKD wcmY JRXi Ybtu 8iQ3 t8Ez nRwK pUY2")
        with self.assertRaisesRegex(ValueError, "base58|decodes to"):
            decode_recovery_key("not a key 0OIl")

    def test_decrypts_secret_stored_per_spec(self):
        from matrix_e2ee import decrypt_secret
        storage_key = bytes(range(32))
        encrypted = _spec_encrypt(storage_key, "m.cross_signing.self_signing", _unpadded(b"s" * 32).encode(), bytes(range(16, 32)))
        self.assertEqual(decrypt_secret(storage_key, "m.cross_signing.self_signing", encrypted), _unpadded(b"s" * 32).encode())
        encrypted["mac"] = _unpadded(b"\x00" * 32)
        with self.assertRaisesRegex(ValueError, "MAC check"):
            decrypt_secret(storage_key, "m.cross_signing.self_signing", encrypted)

    def test_secret_storage_key_check_accepts_and_rejects(self):
        from matrix_e2ee import secret_storage_key
        storage_key = bytes(range(32))
        check = _spec_encrypt(storage_key, "", b"\x00" * 32, bytes(range(16)))
        description = {"algorithm": "m.secret_storage.v1.aes-hmac-sha2", "iv": check["iv"], "mac": check["mac"]}
        self.assertEqual(
            secret_storage_key("EsSz ykH7 LCZx 7Cae cmKD wcmY JRXi Ybtu 8iQ3 t8Ez nRwK pUY1", description),
            storage_key,
        )
        with self.assertRaisesRegex(ValueError, "does not match"):
            secret_storage_key("EsSz ygLv VP1b xF1C v7kE eBQx MxDP buG5 w25T L3b6 hfyG Kkrd", description)

    def test_signs_canonical_json_with_frozen_vector(self):
        from matrix_e2ee import canonical_json, ed25519_public_key, ed25519_sign
        seed = bytes(range(32))
        self.assertEqual(_unpadded(ed25519_public_key(seed)), "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg")
        signed = {"b": 1, "a": 2, "signatures": {"@bot:test": {}}, "unsigned": {"age_ts": 1}}
        self.assertEqual(canonical_json(signed), b'{"a":2,"b":1}')
        self.assertEqual(
            _unpadded(ed25519_sign(seed, canonical_json(signed))),
            "pOb5vaHoMMWP+HrtBGCH+mO4856xt7RA+t0unRp8HVOiEaEj6OIbs61cpGHSobP3+YnxFELABqVU9QPandHgCQ",
        )


@unittest.skipUnless(HAS_CRYPTO and HAS_VODOZEMAC, "e2ee crypto unavailable")
class VerifyOwnDeviceTests(unittest.TestCase):
    def test_recovery_key_cross_signs_own_device(self):
        from matrix_e2ee import canonical_json, ed25519_public_key, ed25519_sign, verify_own_device
        import vodozemac

        user = "@bot:test"
        device = "DEVICE"
        storage_key = bytes(range(32))
        master_seed = b"m" * 32
        self_signing_seed = b"s" * 32
        master_public = _unpadded(ed25519_public_key(master_seed))
        self_signing_public = _unpadded(ed25519_public_key(self_signing_seed))
        check = _spec_encrypt(storage_key, "", b"\x00" * 32, bytes(range(16)))
        account_data = {
            "m.secret_storage.default_key": {"key": "key1"},
            "m.secret_storage.key.key1": {
                "algorithm": "m.secret_storage.v1.aes-hmac-sha2", "iv": check["iv"], "mac": check["mac"],
            },
            "m.cross_signing.master": {"encrypted": {"key1": _spec_encrypt(
                storage_key, "m.cross_signing.master", _unpadded(master_seed).encode(), bytes(range(16, 32)))}},
            "m.cross_signing.self_signing": {"encrypted": {"key1": _spec_encrypt(
                storage_key, "m.cross_signing.self_signing", _unpadded(self_signing_seed).encode(), bytes(range(32, 48)))}},
        }
        master_key = {
            "user_id": user, "usage": ["master"],
            "keys": {f"ed25519:{master_public}": master_public},
        }
        master_key["signatures"] = {user: {f"ed25519:{master_public}": _unpadded(
            ed25519_sign(master_seed, canonical_json(master_key)))}}
        self_signing_key = {
            "user_id": user, "usage": ["self_signing"],
            "keys": {f"ed25519:{self_signing_public}": self_signing_public},
        }
        self_signing_key["signatures"] = {user: {f"ed25519:{master_public}": _unpadded(
            ed25519_sign(master_seed, canonical_json(self_signing_key)))}}
        device_key = {
            "user_id": user, "device_id": device,
            "algorithms": ["m.olm.v1.curve25519-aes-sha2", "m.megolm.v1.aes-sha2"],
            "keys": {f"curve25519:{device}": _unpadded(b"c" * 32), f"ed25519:{device}": _unpadded(b"d" * 32)},
            "signatures": {user: {f"ed25519:{device}": _unpadded(b"e" * 64)}},
            "unsigned": {"age_ts": 1},
        }
        uploads = []

        class Homeserver(BaseHTTPRequestHandler):
            def respond(self, payload):
                body = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.headers["Authorization"] != "Bearer token":
                    self.send_error(401)
                    return
                event_type = self.path.rsplit("/", 1)[-1]
                from urllib.parse import unquote
                event_type = unquote(event_type)
                if event_type not in account_data:
                    self.send_error(404)
                    return
                self.respond(account_data[event_type])

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if self.path.endswith("/keys/query"):
                    self.respond({
                        "device_keys": {user: {device: device_key}},
                        "master_keys": {user: master_key},
                        "self_signing_keys": {user: self_signing_key},
                    })
                    return
                if self.path.endswith("/keys/signatures/upload"):
                    uploads.append(payload)
                    self.respond({})
                    return
                self.send_error(404)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Homeserver)
        worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        worker.start()
        try:
            result = verify_own_device(
                f"http://127.0.0.1:{server.server_port}", user, device, "token",
                "EsSz ykH7 LCZx 7Cae cmKD wcmY JRXi Ybtu 8iQ3 t8Ez nRwK pUY1",
            )
        finally:
            server.shutdown()
            worker.join()
            server.server_close()
        self.assertEqual(result, self_signing_public)
        self.assertEqual(len(uploads), 1)
        signed_device = uploads[0][user][device]
        self.assertEqual(signed_device["keys"], device_key["keys"])
        self.assertEqual(signed_device["signatures"][user][f"ed25519:{device}"], _unpadded(b"e" * 64))
        signature = signed_device["signatures"][user][f"ed25519:{self_signing_public}"]
        vodozemac.Ed25519PublicKey.from_base64(
            base64.b64encode(base64.b64decode(self_signing_public + "=")).decode()
        ).verify_signature(
            canonical_json(device_key),
            vodozemac.Ed25519Signature.from_base64(base64.b64encode(base64.b64decode(signature + "==")).decode()),
        )

    def test_wrong_recovery_key_fails_before_any_upload(self):
        from matrix_e2ee import verify_own_device
        storage_key = bytes(range(32))
        check = _spec_encrypt(storage_key, "", b"\x00" * 32, bytes(range(16)))
        account_data = {
            "m.secret_storage.default_key": {"key": "key1"},
            "m.secret_storage.key.key1": {
                "algorithm": "m.secret_storage.v1.aes-hmac-sha2", "iv": check["iv"], "mac": check["mac"],
            },
        }

        class Homeserver(BaseHTTPRequestHandler):
            def do_GET(self):
                from urllib.parse import unquote
                event_type = unquote(self.path.rsplit("/", 1)[-1])
                body = json.dumps(account_data[event_type]).encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Homeserver)
        worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        worker.start()
        try:
            with self.assertRaisesRegex(ValueError, "does not match"):
                verify_own_device(
                    f"http://127.0.0.1:{server.server_port}", "@bot:test", "DEVICE", "token",
                    "EsSz ygLv VP1b xF1C v7kE eBQx MxDP buG5 w25T L3b6 hfyG Kkrd",
                )
        finally:
            server.shutdown()
            worker.join()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
