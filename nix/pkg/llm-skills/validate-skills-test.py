"""BG: exercise the validator CLI with real YAML parsing and temporary skills."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


VALIDATOR = Path(sys.argv.pop(1)).resolve()


class SkillValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def skill(self, directory="fixture", *, name="fixture", description="A useful skill.", content="Body\n"):
        path = self.root / directory
        path.mkdir()
        metadata = {}
        if name is not None:
            metadata["name"] = name
        if description is not None:
            metadata["description"] = description
        # JSON is YAML; quoting preserves exact Unicode and boundary lengths.
        meta = path / "meta.yaml"
        meta.write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        if content is not None:
            (path / "content.md").write_text(content, encoding="utf-8")
        return meta

    def validate(self, *metadata):
        return subprocess.run(
            ["bash", str(VALIDATOR), *map(str, metadata)],
            capture_output=True, text=True, timeout=10,
        )

    def assert_valid(self, meta):
        result = self.validate(meta)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assert_invalid(self, meta, diagnostic):
        result = self.validate(meta)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(diagnostic, result.stderr)

    def test_valid_skill(self):
        self.assert_valid(self.skill())

    def test_missing_name(self):
        self.assert_invalid(self.skill(name=None), "missing required 'name'")

    def test_missing_description(self):
        self.assert_invalid(self.skill(description=None), "missing required 'description'")

    def test_missing_content(self):
        self.assert_invalid(self.skill(content=None), "missing")

    def test_empty_content(self):
        self.assert_invalid(self.skill(content=""), "empty")

    # Regression: mismatched names and oversized metadata were accepted.
    def test_name_must_match_directory(self):
        self.assert_invalid(self.skill(name="different"), "directory")

    def test_description_at_limit(self):
        self.assert_valid(self.skill(description="x" * 1024))

    def test_description_over_limit(self):
        self.assert_invalid(self.skill(description="x" * 1025), "1024")

    def test_unicode_description_counts_characters_not_bytes(self):
        self.assert_valid(self.skill(description="界" * 1024))

    def test_unicode_description_over_limit(self):
        self.assert_invalid(self.skill(description="界" * 1025), "1024")

    def test_trailing_newline_counts_toward_limit(self):
        self.assert_invalid(self.skill(description="x" * 1024 + "\n"), "1024")

    def test_invalid_skill_in_batch_is_not_hidden(self):
        bad = self.skill("bad", name="bad", content="")
        good = self.skill("good", name="good")
        result = self.validate(bad, good)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("empty", result.stderr)


if __name__ == "__main__":
    unittest.main()
