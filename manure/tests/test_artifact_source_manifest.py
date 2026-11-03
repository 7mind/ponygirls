"""Behavioral/Active Effectual-GoodCommunication regression: location-independent identity.

Only copied owned source fixtures and a real bounded manifest CLI, no builds,
credentials, service/model configuration or network. Expected inputs are an
independent explicit fixture map, not the generator's directory/filter logic.
"""
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

GENERATOR = Path(__file__).resolve().parents[1] / 'scripts/artifact-source.py'
SELECTED = {
    'build.sbt': b'// owned build definition\n',
    'deps.lock.json': b'{"owned":"dependency lock"}\n',
    'lockfile-config.json': b'{"owned":"lock configuration"}\n',
    'manure/migration/schema.sql': b'-- owned migration schema\n',
    'project/build.properties': b'sbt.version=owned-fixture\n',
    'project/plugins.sbt': b'// owned plugin definition\n',
    'project/target-compatible/targeting.scala': b'// target substrings are not build-output components\n',
    'project/.gitignore': b'# not a .git directory component\n',
    'manure/backend/src/main/scala/manure/Main.scala': b'// owned Scala application\n',
    'manure/backend/src/main/resources/003_catalogue.sql': b'-- owned compiled resource\n',
    'manure/server/src/main/c/posix_native.c': b'/* owned native source */\n',
    'manure/server/native-image/reachability-metadata.json': b'{"owned":"native metadata"}\n',
    'manure/generated/scala/manure/api/Version.scala': b'// owned generated contract\n',
    'shared/baboon-runtime/src/main/scala/Runtime.scala': b'// owned generated runtime\n',
    'shared/lossless-json/src/main/scala/Json.scala': b'// owned lossless codec\n',
    'shared/service-runtime/src/main/scala/Runtime.scala': b'// owned service runtime\n',
    'shared/service-runtime/src/main/resources/runtime.conf': b'owned-runtime-resource\n',
    'shared/model-http/src/main/scala/Model.scala': b'// owned model transport source\n',
    'shared/retrieval-core/src/main/scala/Retrieval.scala': b'// owned retrieval core\n',
    'shared/retrieval-postgres/src/main/scala/Postgres.scala': b'// owned retrieval adapter\n',
}
EXCLUDED = {
    'project/target/compiled/Discard.scala': b'owned nested build output\n',
    'manure/backend/src/main/target/compiled/Discard.scala': b'owned nested main build output\n',
    'shared/service-runtime/src/main/target/Discard.class': b'owned runtime build output\n',
    'manure/server/native-image/.git/objects/ignored': b'owned nested git metadata\n',
    'project/.git/config': b'owned nested git metadata\n',
    'manure/backend/src/test/scala/NotCompiledIntoServer.scala': b'owned tests\n',
    'manure/backend/target/Discard.class': b'owned ordinary build output\n',
    'target/compiled/Discard.class': b'owned top-level build output\n',
    '.git/config': b'owned top-level git metadata\n',
    'manure/scripts/not-compiled.py': b'# owned tooling\n',
    'manure/tests/not-compiled.py': b'# owned test\n',
    'README.md': b'owned documentation\n',
}


class ArtifactSourceManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='manure-source-manifest-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.seed = self.root / 'fixture-source'
        for relative, data in {**SELECTED, **EXCLUDED}.items():
            path = self.seed / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        script = self.seed / 'manure/scripts/artifact-source.py'
        script.write_bytes(GENERATOR.read_bytes())
        self.caller = self.root / 'unrelated-caller'
        self.caller.mkdir()

    @staticmethod
    def expected():
        # Explicit independent selected map: no generator selector imported,
        # copied, or queried to decide which entries belong in this manifest.
        return ''.join(hashlib.sha256(data).hexdigest() + '  ' + relative + '\n'
                       for relative, data in sorted(SELECTED.items())).encode('ascii')

    def copied(self, *location):
        destination = self.root.joinpath(*location)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(self.seed, destination)
        return destination

    def manifest(self, checkout, *, cwd=None):
        env = {'PATH': os.defpath, 'HOME': str(self.root / 'empty-home'),
               'PYTHONNOUSERSITE': '1', 'PYTHONDONTWRITEBYTECODE': '1',
               'LANG': 'C.UTF-8', 'LC_ALL': 'C.UTF-8', 'TZ': 'UTC'}
        result = subprocess.run([sys.executable, str(checkout / 'manure/scripts/artifact-source.py')],
                                cwd=cwd or self.caller, env=env, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stderr, b'')
        return result.stdout

    def test_manifest_matches_independent_selected_hashes_and_relative_paths_from_any_cwd(self):
        checkout = self.copied('ordinary', 'checkout')
        for cwd in (self.caller, checkout, checkout / 'manure'):
            with self.subTest(cwd=cwd.relative_to(self.root).as_posix()):
                self.assertEqual(self.manifest(checkout, cwd=cwd), self.expected())

    def test_target_ancestor_cannot_change_selected_compiled_inputs(self):
        ordinary = self.copied('ordinary', 'checkout')
        under_target = self.copied('target', 'source-archive', 'checkout')
        expected = self.expected()
        self.assertEqual(self.manifest(ordinary), expected)
        self.assertEqual(self.manifest(under_target), expected)
        self.assertEqual(self.manifest(under_target), self.manifest(ordinary))

    def test_git_ancestor_is_not_confused_with_repository_relative_git_metadata(self):
        ordinary = self.copied('ordinary', 'checkout')
        under_git = self.copied('.git', 'source-archive', 'checkout')
        expected = self.expected()
        self.assertEqual(self.manifest(ordinary), expected)
        self.assertEqual(self.manifest(under_git), expected)
        self.assertEqual(self.manifest(under_git), self.manifest(ordinary))

    def test_nested_build_metadata_and_generator_itself_never_enter_compiled_identity(self):
        checkout = self.copied('ordinary', 'checkout')
        before = self.manifest(checkout)
        self.assertEqual(before, self.expected())
        for relative in EXCLUDED:
            (checkout / relative).write_bytes(b'changed owned excluded bytes\n')
        generator = checkout / 'manure/scripts/artifact-source.py'
        generator.write_bytes(generator.read_bytes() + b'\n# changed tooling is not a compiled input\n')
        self.assertEqual(self.manifest(checkout), before)
        self.assertEqual(self.manifest(checkout), self.expected())


if __name__ == '__main__':
    unittest.main()
