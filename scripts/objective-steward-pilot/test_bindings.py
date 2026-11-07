"""Behavioral-Active Blackbox Good-Communication source-binding contract."""
from pathlib import Path
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest


class BindingTests(unittest.TestCase):
    def test_view_does_not_initialize_or_modify_an_existing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "other.sqlite"
            with sqlite3.connect(path) as connection:
                connection.execute("CREATE TABLE sentinel (id INTEGER)")
            result = subprocess.run([sys.executable, "-B", str(Path(__file__).parent / "run.py"), "view", "--database", str(path)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            with sqlite3.connect(path) as connection:
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertEqual(tables, {"sentinel"})

    def test_identical_instrument_bytes_keep_bindings_after_relocation(self):
        with tempfile.TemporaryDirectory() as directory:
            results = []
            for name in ("first", "relocated"):
                root = Path(directory) / name
                root.mkdir()
                for source in ("profile.py", "store.py", "pilot.py", "run.py", "live.mjs"):
                    shutil.copyfile(Path(__file__).parent / source, root / source)
                for source in ("cases.json", "oracle.json"):
                    (root / source).write_text("{}\n", encoding="utf-8")
                command = "import json,sys;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from run import frozen_sources;print(json.dumps(frozen_sources(Path(sys.argv[1])/'cases.json',Path(sys.argv[1])/'oracle.json'),sort_keys=True))"
                results.append(json.loads(subprocess.check_output([sys.executable, "-B", "-c", command, str(root)], text=True)))
            self.assertEqual(results[0], results[1])

if __name__ == "__main__":
    unittest.main()
