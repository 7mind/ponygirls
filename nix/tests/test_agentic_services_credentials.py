import importlib.util
from pathlib import Path
import hashlib
import os
import subprocess
import sys
import tempfile
import unittest

MODULE_PATH = Path(os.environ.get("AGENTIC_CREDENTIALS_HELPER", Path(__file__).parents[1] / "hm/agentic-services-credentials.py"))
spec = importlib.util.spec_from_file_location("agentic_services_credentials", MODULE_PATH)
credentials = importlib.util.module_from_spec(spec)
spec.loader.exec_module(credentials)


# Specified Effectual-GoodCommunication: exact filesystem/security semantics.
class CredentialsTest(unittest.TestCase):
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
                credentials.provision(directory, Path(root) / "missing", None)
            self.assertFalse(directory.exists())

    def test_existing_fifo_is_rejected_without_reading_it(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            directory.mkdir()
            os.mkfifo(directory / "redis-password")
            with self.assertRaisesRegex(RuntimeError, "invalid credential file"):
                credentials.provision(directory, None, None)

    def provision(self, directory):
        haystack = directory.parent / "haystack-source"
        manure = directory.parent / "manure-source"
        for path, token in ((haystack, "H" * 43), (manure, "M" * 43)):
            if not path.exists():
                path.write_text(token + "\n")
        credentials.provision(directory, haystack, manure)

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
            self.assertEqual(len(original), 10)
            for path in directory.iterdir():
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)

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
                                      source if enabled == "manure" else None)
                disabled = "manure" if enabled == "haystack" else "haystack"
                self.assertTrue((directory / f"{enabled}-agent.token").exists())
                self.assertFalse(any(path.name.startswith(disabled) for path in directory.iterdir()))
                self.assertEqual(len(list(directory.iterdir())), 6)

    def test_retirement_leaves_disabled_credential_bytes_modes_and_inodes_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            self.provision(directory)
            legacy = directory / "haystack-agent.token"
            legacy.write_text("retained without validation\n")
            legacy.chmod(0o640)
            paths = [path for path in directory.iterdir() if path.name.startswith(("haystack-", "manure-"))]
            before = {path.name: (path.read_bytes(), path.stat().st_mode, path.stat().st_ino) for path in paths}
            credentials.provision(directory, None, None)
            after = {path.name: (path.read_bytes(), path.stat().st_mode, path.stat().st_ino) for path in paths}
            self.assertEqual(before, after)
            self.assertTrue((directory / "redis-password").exists())
            self.assertTrue((directory / "searx-secret").exists())

    def test_both_disabled_only_provisions_remaining_stack_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "credentials"
            credentials.provision(directory, None, None)
            self.assertEqual(sorted(path.name for path in directory.iterdir()), ["redis-password", "searx-secret"])

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
