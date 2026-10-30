#!/usr/bin/env python3
"""Bind explicit fast backend and retained-protocol checks to the final installed native ELF."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path: Path) -> dict:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('validation document must be an object')
    return value


def suite_names(path: Path) -> list[str]:
    names = path.read_text().splitlines()
    if not names or any(not name for name in names) or len(set(names)) != len(names):
        raise ValueError('empty or duplicate validation inventory/selection')
    return names


def check_backend(inputs: dict, backend: dict, selected: list[str], discovered: list[str]) -> None:
    if (not selected or not discovered or len(set(selected)) != len(selected)
        or len(set(discovered)) != len(discovered) or not set(selected) <= set(discovered)
        or backend['schemaVersion'] != 2 or backend['status'] != 'passed'
        or backend['scope'] != 'fast-explicit-suite-subset'
        or backend['runtimeSource'] != inputs['runtimeSource'] or backend['testSource'] != inputs['testSource']
        or any(type(backend[key]) is not int or backend[key] != 0 for key in ['failed', 'errors', 'skipped'])
        or type(backend['tests']) is not int or backend['tests'] <= 0
        or type(backend['suites']) is not int or backend['suites'] != len(selected)
        or backend['selectedSuites'] != selected
        or type(backend['discoveredSuites']) is not int or backend['discoveredSuites'] != len(discovered)
        or not isinstance(backend['suiteCounts'], dict) or set(backend['suiteCounts']) != set(selected)
        or any(type(count) is not int or count <= 0 for count in backend['suiteCounts'].values())
        or sum(backend['suiteCounts'].values()) != backend['tests']):
        raise ValueError('missing, mismatched or incomplete fast backend subset validation')


def evidence(inputs: dict) -> dict:
    required = {'nativeArtifact', 'nativeDerivation', 'runtimeSource', 'testSource', 'backendValidation',
                'backendDerivation', 'protocolValidation', 'protocolDerivation', 'protocolSource'}
    if set(inputs) != required or any(not isinstance(value, str) or not value.startswith('/nix/store/') for value in inputs.values()):
        raise ValueError('invalid immutable validation input identities')
    backend = read(Path(inputs['backendValidation'])/'backend.json')
    selected = suite_names(Path(inputs['testSource'])/'scripts/fast-suites.txt')
    discovered = suite_names(Path(inputs['backendValidation'])/'validation-inventory.txt')
    check_backend(inputs, backend, selected, discovered)
    protocol = read(Path(inputs['protocolValidation'])/'protocol.json')
    if (protocol['schemaVersion'] != 1 or protocol['status'] != 'passed'
        or protocol['protocolSource'] != inputs['protocolSource'] or protocol['versions'] != 8
        or type(protocol['fixtureGroups']) is not int or protocol['fixtureGroups'] <= 0
        or type(protocol['retainedBranchRejections']) is not int or protocol['retainedBranchRejections'] <= 0):
        raise ValueError('missing, mismatched or incomplete retained-version protocol validation')
    executable = Path(inputs['nativeArtifact'])/'libexec/chronicle-server'
    digest = hashlib.sha256()
    with executable.open('rb') as stream:
        while block := stream.read(1024*1024):
            digest.update(block)
    return {'schemaVersion': 2, 'claim': 'exact-artifact-bound-to-fast-backend-subset-and-retained-protocol',
            'inputs': inputs, 'nativeSha256': digest.hexdigest(), 'backend': backend, 'protocol': protocol}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['create', 'verify'])
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    options = parser.parse_args()
    expected = evidence(read(options.inputs))
    if options.mode == 'create':
        options.receipt.write_text(json.dumps(expected, indent=2)+'\n')
    elif read(options.receipt) != expected:
        raise ValueError('validation receipt does not match exact artifact/source/fast-subset/protocol identities')
    print('EXACT_ARTIFACT_FAST_SUBSET_PROTOCOL_VERIFIED', expected['nativeSha256'])


if __name__ == '__main__':
    main()
