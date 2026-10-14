# Behavioral-Active-Blackbox-Atomic: helper CLI, synthetic credential bytes only.
import base64
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


HELPER = Path(sys.argv.pop(1))


class AtlassianAuthTest(unittest.TestCase):
    def invoke(self, token: bytes, email: str = "user@example.com"):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "token"
            path.write_bytes(token)
            return subprocess.run(
                [sys.executable, str(HELPER), email, str(path)],
                capture_output=True,
                check=False,
            )

    def test_exact_header_and_one_terminal_newline(self):
        expected = b"Basic " + base64.b64encode(b"user@example.com:dummy-token") + b"\n"
        for token in (b"dummy-token", b"dummy-token\n"):
            with self.subTest(token=token):
                result = self.invoke(token)
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, expected)
                self.assertEqual(result.stderr, b"")

    def test_invalid_token_is_not_disclosed(self):
        for token in (b"", b"\n", b"dummy-token\n\n", b"dummy-token\r\n",
                      b"dummy-token\x00", b"dummy-token\t", b"dummy-token secret", b"\xff"):
            with self.subTest(token=token):
                result = self.invoke(token)
                self.assertEqual(result.returncode, 3)
                self.assertEqual(result.stdout, b"")
                self.assertNotIn(b"dummy-token", result.stderr)

    def test_invalid_email(self):
        for email in ("", "user:name@example.com", "user\n@example.com", "ü@example.com", "user @example.com"):
            with self.subTest(email=email):
                result = self.invoke(b"dummy-token", email)
                self.assertEqual(result.returncode, 3)
                self.assertEqual(result.stdout, b"")
                self.assertNotIn(b"dummy-token", result.stderr)

    def test_missing_file(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [sys.executable, str(HELPER), "user@example.com", str(Path(directory) / "absent")],
                capture_output=True, check=False,
            )
            self.assertEqual(result.returncode, 3)
            self.assertEqual(result.stdout, b"")
            self.assertEqual(result.stderr, b"atlassian-auth: token file could not be read\n")


if __name__ == "__main__":
    unittest.main()
