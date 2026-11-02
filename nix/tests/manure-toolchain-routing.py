#!/usr/bin/env python3
"""Behavioral-Active / Blackbox-Group regression: explicit toolchain CLI routing.

Controlled compiler stand-ins test arguments and pin policy, NOT compilation or
native runtime. Real JVM/static-musl behavior is manure-posix-acceptance's job.
"""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

script, feature = map(lambda value: Path(value).resolve(), sys.argv[1:3])
del sys.argv[1:3]


class ToolchainRoutingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.project = self.root / 'project'
        (self.project / 'scripts').mkdir(parents=True)
        self.script = self.project / 'scripts/manure-native-image.sh'
        shutil.copyfile(script, self.script)
        source = self.project / 'manure/server/native-image/PosixLinkFeature.java'
        source.parent.mkdir(parents=True)
        shutil.copyfile(feature, source)
        self.home = self.root / 'graal'
        (self.home / 'bin').mkdir(parents=True)
        self.release = self.home / 'release'
        self.release.write_text('GRAALVM_VERSION="25.4.4.1.1"\n')
        self.static = self.root / 'static'
        self.static.mkdir()
        (self.static / 'libmanure_posix.a').write_bytes(b'fixture archive')
        self.classpath = self.root / 'test-classes'
        self.classpath.mkdir()
        self.output = self.root / 'probe'
        self.log = self.root / 'commands.jsonl'
        self.log.write_text('')
        wrong = self.root / 'wrong-path'
        wrong.mkdir()
        for directory, prefix in [(self.home / 'bin', 'HOME'), (wrong, 'PATH')]:
            for command in ['javac', 'native-image']:
                stub = directory / command
                stub.write_text(f'#!{sys.executable}\n' +
                    'import json, os, pathlib, sys\n' +
                    f'marker = {prefix + ":" + command!r}\n' +
                    'with open(os.environ["ROUTING_LOG"], "a") as out:\n' +
                    '    out.write(json.dumps([marker, sys.argv[1:]]) + "\\n")\n' +
                    'if marker.startswith("PATH:"): sys.exit(91)\n' +
                    'if marker.endswith(":javac"):\n' +
                    '    assert pathlib.Path(sys.argv[-1]).is_file()\n' +
                    'else:\n' +
                    '    pathlib.Path(sys.argv[-1]).write_text("controlled compiler output\\n")\n')
                stub.chmod(0o755)
        self.env = dict(os.environ, JAVA_HOME=str(self.home), MANURE_POSIX_STATIC=str(self.static),
                        ROUTING_LOG=str(self.log), PATH=str(wrong) + os.pathsep + os.environ['PATH'])

    def run_script(self, output=None):
        return subprocess.run([shutil.which('bash'), str(self.script), str(self.classpath),
                               str(self.output) if output is None else output],
                              env=self.env, capture_output=True, text=True, timeout=20)

    def commands(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_explicit_home_wins_over_adversarial_path_and_forwards_static_inputs(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        calls = self.commands()
        self.assertEqual([call[0] for call in calls], ['HOME:javac', 'HOME:native-image'])
        self.assertIn(str(self.home) + '/lib/svm/builder/*', calls[0][1])
        self.assertEqual(calls[0][1][-1], 'manure/server/native-image/PosixLinkFeature.java')
        native = calls[1][1]
        for flag in ['--static', '--libc=musl', '--enable-native-access=ALL-UNNAMED',
                     '--features=manure.build.PosixLinkFeature', '-H:CLibraryPath=' + str(self.static)]:
            self.assertIn(flag, native)
        self.assertTrue(native[native.index('-cp') + 1].startswith(str(self.classpath) + ':'))
        self.assertEqual(native[-2:], ['manure.storage.FilesystemCapabilityProbe', str(self.output)])
        self.assertEqual(self.output.read_text(), 'controlled compiler output\n')

    def test_wrong_version_rejected_before_compilers(self):
        self.release.write_text('GRAALVM_VERSION="different"\n')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('requires verified Graal', result.stderr)
        self.assertEqual(self.commands(), [])

    def test_missing_archive_rejected_before_compilers(self):
        (self.static / 'libmanure_posix.a').unlink()
        self.assertNotEqual(self.run_script().returncode, 0)
        self.assertEqual(self.commands(), [])

    def test_relative_output_rejected_before_compilers(self):
        self.assertNotEqual(self.run_script('relative-probe').returncode, 0)
        self.assertEqual(self.commands(), [])


if __name__ == '__main__':
    unittest.main()
