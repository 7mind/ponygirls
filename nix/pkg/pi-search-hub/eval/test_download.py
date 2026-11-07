import hashlib
from pathlib import Path
import tempfile
import unittest

from download import preserve, verified


class ArtifactDownloadTests(unittest.TestCase):
    def test_exact_hash_and_length_and_optional_md5(self):
        data = b"public artifact"
        record = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "md5": hashlib.md5(data).hexdigest()}
        self.assertEqual(verified(data, record), data)
        for change in ({"bytes": len(data) + 1}, {"sha256": "0" * 64}, {"md5": "0" * 32}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                verified(data, record | change)

    def test_preserves_exact_existing_artifact_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "nested" / "artifact"
            preserve(path, b"first")
            before = path.stat().st_mtime_ns
            preserve(path, b"first")
            self.assertEqual(path.stat().st_mtime_ns, before)
            with self.assertRaisesRegex(ValueError, "Refusing to overwrite"):
                preserve(path, b"different")
            self.assertEqual(path.read_bytes(), b"first")


if __name__ == "__main__":
    unittest.main()
