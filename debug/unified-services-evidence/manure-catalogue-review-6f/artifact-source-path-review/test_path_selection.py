"""Read-only fail-first: an ancestor named target must not hide source inputs."""
import subprocess,sys,unittest
from pathlib import Path

class ArtifactSourcePathSelection(unittest.TestCase):
    def test_actual_archived_helper_matches_root_relative_source_selection(self):
        archive=Path(__file__).resolve().parents[1]
        expected=(archive/'artifact-source-relative-v1.sha256').read_text()
        actual=subprocess.check_output([sys.executable,str(archive/'manure/scripts/artifact-source.py')],text=True)
        print(f'ARTIFACT_SOURCE_PATH expectedRootRelativeEntries={len(expected.splitlines())} actualArchivedHelperEntries={len(actual.splitlines())}',flush=True)
        self.assertEqual(actual,expected,'ancestor target incorrectly treated as artifact-internal build output')

if __name__=='__main__':unittest.main(verbosity=2)
