import importlib.util
from pathlib import Path
import base64
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

MODULE_PATH = Path(os.environ.get("AGENTIC_CREDENTIALS_HELPER", Path(__file__).parents[1] / "hm/agentic-services-credentials.py"))
spec = importlib.util.spec_from_file_location("agentic_services_credentials", MODULE_PATH)
credentials = importlib.util.module_from_spec(spec)
spec.loader.exec_module(credentials)


# Specified Effectual-GoodCommunication: exact filesystem/security semantics.
class CredentialsTest(unittest.TestCase):
    def password_hash(self, password):
        salt = bytes(range(16))
        derived = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 600000, dklen=32)
        return "$".join(("pbkdf2-sha256", "600000", base64.b64encode(salt).decode(),
                         base64.b64encode(derived).decode()))

    def test_operator_password_hash_matches_preserved_service_specific_token(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            for service in ("haystack", "manure"):
                token = (directory / f"{service}-operator.token").read_text().removesuffix("\n")
                encoded = (directory / f"{service}-operator.pbkdf2").read_text().removesuffix("\n")
                algorithm, iterations, salt, derived = encoded.split("$")
                self.assertEqual((algorithm, iterations), ("pbkdf2-sha256", "600000"))
                self.assertEqual(len(base64.b64decode(salt, validate=True)), 16)
                self.assertEqual(base64.b64decode(derived, validate=True),
                                 hashlib.pbkdf2_hmac("sha256", token.encode(),
                                                     base64.b64decode(salt), 600000, dklen=32))
            self.assertNotEqual((directory / "haystack-operator.token").read_bytes(),
                                (directory / "manure-operator.token").read_bytes())

    def test_legacy_operator_password_derivation_refuses_implicit_rotation(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            (directory / "haystack-operator.token").write_text("R" * 43 + "\n")
            (directory / "haystack-operator.sha256").write_text(hashlib.sha256(("R" * 43).encode()).hexdigest() + "\n")
            before = {p.name: p.read_bytes() for p in directory.iterdir()}
            with self.assertRaisesRegex(RuntimeError, "operator password hash mismatch.*refusing rotation"):
                self.provision(directory)
            self.assertEqual(before, {p.name: p.read_bytes() for p in directory.iterdir()})

    def test_explicit_operator_hash_is_validated_without_rotating_legacy_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            directory = root / "credentials"
            self.provision(directory)
            legacy_hash = directory / "haystack-operator.pbkdf2"
            legacy_hash.write_text("retained unused legacy hash\n")
            canonical = root / "canonical.pbkdf2"
            canonical.write_text(self.password_hash("explicit canonical password") + "\n")
            before = {p.name: (p.read_bytes(), p.stat().st_ino) for p in directory.iterdir()}
            command = [sys.executable, str(MODULE_PATH), str(directory),
                       "--haystack-agent-file", str(root / "haystack-source"),
                       "--haystack-operator-password-hash-file", str(canonical)]
            for password in ("explicit canonical password", "explicit replacement password"):
                canonical.write_text(self.password_hash(password) + "\n")
                result = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertNotIn(password, result.stdout + result.stderr)
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_ino) for p in directory.iterdir()})

    def test_malformed_explicit_operator_hash_fails_before_creating_state(self):
        valid = self.password_hash("unused plaintext must not be logged")
        malformed = ["plaintext-password-CANARY", valid + "\n\n", valid.replace("600000", "1"),
                     valid.replace("600000", "2000001"), valid.replace("$", ":", 1),
                     valid.rsplit("$", 1)[0] + "$" + base64.b64encode(b"short").decode(),
                     valid[:-2] + "B=", valid.replace(valid.split("$")[2], valid.split("$")[2][:-3] + "B=="),
                     "x" * 20000, "\udcff"]
        for value in malformed:
            with self.subTest(value_index=malformed.index(value)), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                source = root / "agent"
                source.write_text("A" * 43 + "\n")
                canonical = root / "canonical.pbkdf2"
                canonical.write_bytes(value.encode(errors="surrogateescape"))
                directory = root / "credentials"
                result = subprocess.run([sys.executable, str(MODULE_PATH), str(directory),
                                         "--haystack-agent-file", str(source),
                                         "--haystack-operator-password-hash-file", str(canonical)],
                                        capture_output=True, text=True, timeout=5)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("invalid operator password hash source", result.stderr)
                self.assertNotIn("plaintext-password-CANARY", result.stderr + result.stdout)
                self.assertFalse(directory.exists())

    def test_malformed_legacy_operator_hash_is_rejected_without_replacement(self):
        for body in (b"not-a-password-hash\n", b"\xff\n", b"x" * 20000):
            with self.subTest(encoding="ascii" if body.isascii() else "non-ascii"), tempfile.TemporaryDirectory() as root:
                directory = Path(root) / "credentials"
                self.provision(directory)
                (directory / "haystack-operator.pbkdf2").write_bytes(body)
                before = {p.name: p.read_bytes() for p in directory.iterdir()}
                with self.assertRaisesRegex(RuntimeError, "invalid credential encoding: haystack-operator.pbkdf2"):
                    self.provision(directory)
                self.assertEqual(before, {p.name: p.read_bytes() for p in directory.iterdir()})

    def test_legacy_operator_hash_special_files_are_rejected_without_reading(self):
        for special in ("fifo", "symlink"):
            with self.subTest(special=special), tempfile.TemporaryDirectory() as root:
                root = Path(root)
                directory = root / "credentials"
                self.provision(directory)
                path = directory / "haystack-operator.pbkdf2"
                path.unlink()
                if special == "fifo":
                    os.mkfifo(path)
                else:
                    target = root / "target"
                    target.write_text("never read or replace\n")
                    path.symlink_to(target)
                with self.assertRaisesRegex(RuntimeError, "invalid credential file: haystack-operator.pbkdf2"):
                    self.provision(directory)
                if special == "symlink":
                    self.assertEqual(target.read_text(), "never read or replace\n")

    def test_operator_hash_special_file_is_rejected_without_reading(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / "agent"
            source.write_text("A" * 43 + "\n")
            canonical = root / "must-not-open"
            os.mkfifo(canonical)
            result = subprocess.run([sys.executable, str(MODULE_PATH), str(root / "credentials"),
                                     "--haystack-agent-file", str(source),
                                     "--haystack-operator-password-hash-file", str(canonical)],
                                    capture_output=True, text=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invalid operator password hash source", result.stderr)
            self.assertFalse((root / "credentials").exists())

    def test_disabled_operator_hash_sources_are_not_opened(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            source = root / "must-not-open"
            os.mkfifo(source)
            result = subprocess.run([sys.executable, str(MODULE_PATH), str(root / "credentials"),
                                     "--haystack-operator-password-hash-file", str(source),
                                     "--manure-operator-password-hash-file", str(root / "missing")],
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(sorted(p.name for p in (root / "credentials").iterdir()),
                             ["redis-password", "searx-secret"])

    def test_cli_provisions_real_private_files_and_preserves_identity(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            directory = root / "credentials"
            source = root / "runtime-agent-token"
            source.write_text("A" * 43 + "\n")
            command = [sys.executable, str(MODULE_PATH), str(directory),
                       "--haystack-agent-file", str(source)]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            before = {p.name: (p.read_bytes(), p.stat().st_mode, p.stat().st_ino)
                      for p in directory.iterdir()}
            self.assertEqual((directory / "haystack-agent.sha256").read_text().strip(),
                             hashlib.sha256(("A" * 43).encode()).hexdigest())
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all(mode & 0o777 == 0o600 for _, mode, _ in before.values()))
            self.assertFalse(any(name.startswith("manure") for name in before))
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mode, p.stat().st_ino)
                                      for p in directory.iterdir()})
            source.write_text("B" * 43 + "\n")
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("refusing rotation", result.stderr)
            self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_mode, p.stat().st_ino)
                                      for p in directory.iterdir()})

    def test_missing_source_is_rejected_before_creating_state(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            with self.assertRaises(FileNotFoundError):
                credentials.provision(directory, Path(root) / "missing", None, None, None)
            self.assertFalse(directory.exists())

    def test_existing_fifo_is_rejected_without_reading_it(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            directory.mkdir()
            os.mkfifo(directory / "redis-password")
            with self.assertRaisesRegex(RuntimeError, "invalid credential file"):
                credentials.provision(directory, None, None, None, None)

    def provision(self, directory):
        haystack = directory.parent / "haystack-source"
        manure = directory.parent / "manure-source"
        for path, token in ((haystack, "H" * 43), (manure, "M" * 43)):
            if not path.exists():
                path.write_text(token + "\n")
        credentials.provision(directory, haystack, manure, None, None)

    def test_agent_tokens_come_from_provisioned_sources(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            self.assertEqual((directory / "haystack-agent.token").read_text(), "H" * 43 + "\n")
            self.assertEqual((directory / "manure-agent.token").read_text(), "M" * 43 + "\n")

    def test_changed_source_is_rejected_without_rotating_runtime_token(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            original = {p.name: p.read_bytes() for p in directory.iterdir()}
            (Path(root) / "haystack-source").write_text("X" * 43 + "\n")
            with self.assertRaisesRegex(RuntimeError, "source mismatch"):
                self.provision(directory)
            self.assertEqual(original, {p.name: p.read_bytes() for p in directory.iterdir()})

    def test_invalid_source_is_rejected_before_creating_tokens(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            (Path(root) / "manure-source").write_text("invalid token\n")
            with self.assertRaisesRegex(RuntimeError, "invalid agent token source"):
                self.provision(directory)
            self.assertFalse(directory.exists())

    # Effectual-GoodCommunication, specified: private, idempotent filesystem provisioning.
    def test_private_credentials_survive_repeated_provisioning(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            original = {p.name: p.read_bytes() for p in directory.iterdir()}
            self.provision(directory)
            self.assertEqual(original, {p.name: p.read_bytes() for p in directory.iterdir()})
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
            self.assertEqual(len(original), 12)
            for path in directory.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_existing_token_and_digest_newline_encodings_remain_unchanged(self):
        for ending in (b"\r\n", b"\r"):
            with self.subTest(ending=repr(ending)), tempfile.TemporaryDirectory() as root:
                directory = Path(root) / "credentials"
                self.provision(directory)
                for path in directory.iterdir():
                    if path.suffix in (".token", ".sha256"):
                        path.write_bytes(path.read_bytes().removesuffix(b"\n") + ending)
                before = {p.name: (p.read_bytes(), p.stat().st_ino) for p in directory.iterdir()}
                self.provision(directory)
                self.assertEqual(before, {p.name: (p.read_bytes(), p.stat().st_ino) for p in directory.iterdir()})

    def test_mismatched_digest_is_rejected_without_rotation(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            token = (directory / "haystack-agent.token").read_bytes()
            (directory / "haystack-agent.sha256").write_text("0" * 64 + "\n")
            with self.assertRaisesRegex(RuntimeError, "digest mismatch"):
                self.provision(directory)
            self.assertEqual((directory / "haystack-agent.token").read_bytes(), token)

    def test_secret_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            directory.mkdir()
            target = Path(root) / "target"
            target.write_text("do not overwrite")
            (directory / "haystack-agent.token").symlink_to(target)
            with self.assertRaisesRegex(RuntimeError, "invalid credential file"):
                self.provision(directory)
            self.assertEqual(target.read_text(), "do not overwrite")

    def test_disabled_services_are_not_created_or_read(self):
        for enabled in ("haystack", "manure"):
            with self.subTest(enabled=enabled), tempfile.TemporaryDirectory() as root:
                directory = Path(root) / "credentials"
                source = Path(root) / "enabled-source"
                source.write_text("A" * 43 + "\n")
                credentials.provision(directory, source if enabled == "haystack" else None,
                                      source if enabled == "manure" else None, None, None)
                disabled = "manure" if enabled == "haystack" else "haystack"
                self.assertTrue((directory / f"{enabled}-agent.token").exists())
                self.assertFalse(any(path.name.startswith(disabled) for path in directory.iterdir()))
                self.assertEqual(len(list(directory.iterdir())), 7)

    def test_retirement_leaves_disabled_credential_bytes_modes_and_inodes_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            legacy = directory / "haystack-agent.token"
            legacy.write_text("retained without validation\n")
            legacy.chmod(0o640)
            paths = [path for path in directory.iterdir() if path.name.startswith(("haystack-", "manure-"))]
            before = {path.name: (path.read_bytes(), path.stat().st_mode, path.stat().st_ino) for path in paths}
            credentials.provision(directory, None, None, None, None)
            after = {path.name: (path.read_bytes(), path.stat().st_mode, path.stat().st_ino) for path in paths}
            self.assertEqual(before, after)
            self.assertTrue((directory / "redis-password").exists())
            self.assertTrue((directory / "searx-secret").exists())

    def test_both_disabled_only_provisions_remaining_stack_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            credentials.provision(directory, None, None, None, None)
            self.assertEqual(sorted(path.name for path in directory.iterdir()), ["redis-password", "searx-secret"])

    def test_accounts_key_is_created_once_privately_and_retained(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            directory = root / "credentials"
            key = directory / "manure-accounts.key"
            command = [sys.executable, str(MODULE_PATH), str(directory), "--manure-accounts-key"]
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            first = (key.read_bytes(), key.stat().st_ino)
            result = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((key.read_bytes(), key.stat().st_ino), first)
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            encoded = key.read_text().removesuffix("\n")
            self.assertEqual(len(base64.urlsafe_b64decode(encoded + "=")), 32)
            self.assertEqual(base64.urlsafe_b64encode(base64.urlsafe_b64decode(encoded + "=")).decode(), encoded + "=")
            self.assertFalse((directory / "haystack-accounts.key").exists())

    def test_malformed_accounts_key_is_rejected_without_replacement(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            directory.mkdir(mode=0o700)
            key = directory / "haystack-accounts.key"
            key.write_text("A" * 42 + "B\n")
            result = subprocess.run([sys.executable, str(MODULE_PATH), str(directory), "--haystack-accounts-key"],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("invalid credential encoding: haystack-accounts.key", result.stderr)
            self.assertEqual(key.read_text(), "A" * 42 + "B\n")

    def test_interrupted_accounts_key_creation_publishes_nothing(self):
        for step, target in (("generation", "random_urlsafe"), ("write", "fsync")):
            with self.subTest(step=step), tempfile.TemporaryDirectory() as root:
                directory = Path(root) / "credentials"
                directory.mkdir(mode=0o700)
                owner = credentials if target == "random_urlsafe" else credentials.os
                with mock.patch.object(owner, target, side_effect=OSError("interrupted")):
                    with self.assertRaises(OSError):
                        credentials.provision_accounts_key(directory, "haystack")
                self.assertEqual(list(directory.iterdir()), [])
                credentials.provision_accounts_key(directory, "haystack")
                self.assertRegex((directory / "haystack-accounts.key").read_text(), credentials.ACCOUNTS_KEY_PATTERN + "\n")

    def test_accounts_key_publication_race_keeps_the_winner(self):
        winner = "w" * 42 + "A\n"
        link = os.link

        def concurrent_winner(source, destination):
            Path(destination).write_text(winner)
            link(source, destination)

        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            directory.mkdir(mode=0o700)
            with mock.patch.object(credentials.os, "link", side_effect=concurrent_winner):
                credentials.provision_accounts_key(directory, "manure")
            self.assertEqual([p.name for p in directory.iterdir()], ["manure-accounts.key"])
            self.assertEqual((directory / "manure-accounts.key").read_text(), winner)

    def test_directory_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "target"
            target.mkdir()
            directory = Path(root) / "credentials"
            directory.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(RuntimeError, "credential directory"):
                self.provision(directory)


if __name__ == "__main__":
    unittest.main()
