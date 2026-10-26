"""Behavioral-Active Blackbox-Atomic packaging-guard regressions; no network/GPU."""
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load("embedding-install")
locker = load("embedding-lock")


class PackagingGuards(unittest.TestCase):
    def test_data_scripts_and_data_bin_have_the_same_destination(self):
        scripts = installer.destination(PurePosixPath("example.data/scripts/foo"))
        data = installer.destination(PurePosixPath("other.data/data/bin/foo"))
        self.assertEqual(scripts, data)

    def test_purelib_matches_root_package_destination(self):
        self.assertEqual(installer.destination(PurePosixPath("example.data/purelib/package/a.py")),
                         installer.destination(PurePosixPath("package/a.py")))

    def test_generated_entry_point_matches_script_destination(self):
        entries = list(installer.entry_points("[console_scripts]\nfoo = example:main\n"))
        self.assertEqual(entries[0][0], str(installer.destination(PurePosixPath("example.data/scripts/foo"))))

    def test_unreviewed_header_scheme_is_rejected(self):
        with self.assertRaisesRegex(AssertionError, "Unsupported installation scheme"):
            installer.destination(PurePosixPath("example.data/headers/foo.h"))

    def test_python_requirement_rejects_otherwise_compatible_wheel(self):
        metadata = {"info": {"requires_dist": []}, "urls": [{
            "packagetype": "bdist_wheel", "yanked": False,
            "filename": "example-1.0-py3-none-any.whl", "requires_python": ">=3.13",
            "url": "https://files.pythonhosted.org/example.whl",
            "digests": {"sha256": "a" * 64}, "size": 1,
        }]}
        with patch.object(locker.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps(metadata).encode())):
            with self.assertRaisesRegex(ValueError, "No compatible wheel"):
                locker.select("example==1.0")


if __name__ == "__main__":
    unittest.main()
