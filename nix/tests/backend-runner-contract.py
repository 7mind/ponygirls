#!/usr/bin/env python3
"""Static execution-contract checks; not JVM/PostgreSQL/runtime acceptance."""
from pathlib import Path
import re
import shlex
import sys
import unittest

ROOT = Path(sys.argv.pop(1)).resolve()


class BackendRunnerContractTest(unittest.TestCase):
    def tasks(self, path):
        source = (ROOT / path).read_text().replace('\\\n', ' ')
        commands = re.findall(r'(?:bash scripts/backend-sbt\.sh|\./scripts/sbt\.sh)([^\n]*)', source)
        self.assertEqual(len(commands), 1, path)
        tokens = shlex.shlex(commands[0], posix=True, punctuation_chars='();|&')
        tokens.whitespace_split = True
        arguments = [re.sub(r'\s*/\s*', '/', token) for token in tokens]
        return [argument for argument in arguments
                if re.match(r'^(?:\w+/)?(?:Test/validationInventory|test(?:Full|Only|Quick)?)(?:\s|$)', argument)]

    def test_full_gates_execute_every_module_with_inventory(self):
        gates = {
            'chronicle/scripts/test-postgres.sh': ['Test/validationInventory', 'testFull'],
            'haystack/scripts/test-postgres-scala.sh': ['haystackServer/Test/validationInventory', 'haystackServer/testFull'],
            'manure/scripts/test-backend.sh': ['manureStorage/Test/validationInventory', 'manureStorage/testFull', 'manureServer/Test/validationInventory', 'manureServer/testFull'],
            'rites/scripts/test-postgres.sh': ['ritesServer/Test/validationInventory', 'ritesServer/testFull'],
            'shared/service-runtime/scripts/test-postgres.sh': ['serviceRuntime/Test/validationInventory', 'serviceRuntime/testFull'],
            'shared/retrieval-postgres/scripts/test-postgres.sh': ['retrievalCore/Test/validationInventory', 'modelHttp/Test/validationInventory', 'retrievalPostgres/Test/validationInventory', 'retrievalCore/testFull', 'modelHttp/testFull', 'retrievalPostgres/testFull'],
            'nix/pkg/backend-foundation.nix': ['losslessJson/Test/validationInventory', 'losslessJson/testFull', 'manureStorage/Test/validationInventory', 'manureStorage/testFull'],
            'nix/tests/manure-backend.nix': ['manureStorage/Test/validationInventory', 'manureStorage/testFull', 'manureServer/Test/validationInventory', 'manureServer/testFull'],
        }
        for path, expected in gates.items():
            with self.subTest(path=path):
                self.assertEqual(self.tasks(path), expected)

    def test_fast_selection_remains_explicitly_filtered(self):
        self.assertEqual(self.tasks('chronicle/scripts/test-fast.sh'),
                         ['Test/validationInventory', 'testOnly ${suites[*]}'])

    def test_protocol_selection_retains_all_three_suites(self):
        self.assertEqual(self.tasks('chronicle/scripts/test-codecs.sh'),
                         ['testOnly chronicle.CodecFixtureTest chronicle.ApiVersionCompatibilityTest chronicle.ProtocolEvolutionTest'])


if __name__ == '__main__':
    unittest.main()
