"""Behavioral-Active Blackbox Good-Communication source-binding contract."""
from pathlib import Path
from contextlib import closing
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
            with closing(sqlite3.connect(path)) as connection:
                connection.execute("CREATE TABLE sentinel (id INTEGER)")
            result = subprocess.run([sys.executable, "-B", str(Path(__file__).parent / "run.py"), "view", "--database", str(path)], capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            with closing(sqlite3.connect(path)) as connection:
                tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertEqual(tables, {"sentinel"})

    def test_changed_source_after_import_is_rejected_before_freezing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for source in ("profile.py", "store.py", "pilot.py", "run.py", "live.mjs"):
                shutil.copyfile(Path(__file__).parent / source, root / source)
            for source in ("cases.json", "oracle.json"):
                (root / source).write_text("{}\n", encoding="utf-8")
            command = """import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from run import frozen_sources
from profile import Rejected
root = Path(sys.argv[1])
with (root/'pilot.py').open('a') as stream: stream.write('\\n# changed after module load\\n')
try: frozen_sources(root/'cases.json',root/'oracle.json')
except Rejected: pass
else: raise AssertionError('changed source was bound after old implementation was imported')
"""
            result = subprocess.run([sys.executable, "-B", "-c", command, str(root)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)

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
