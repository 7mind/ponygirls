#!/usr/bin/env python3
"""Bind complete source-level validation to the final installed native ELF."""
import argparse
import hashlib
import json
from pathlib import Path


def read(path: Path) -> dict:
    value = json.loads(path.read_text())
    if not isinstance(value, dict):
        raise ValueError('validation document must be an object')
    return value


def evidence(inputs: dict) -> dict:
    required = {'nativeArtifact', 'nativeDerivation', 'runtimeSource', 'testSource', 'backendValidation',
                'backendDerivation', 'protocolValidation', 'protocolDerivation', 'protocolSource'}
    if set(inputs) != required or any(not isinstance(value, str) or not value.startswith('/nix/store/') for value in inputs.values()):
        raise ValueError('invalid immutable validation input identities')
    backend = read(Path(inputs['backendValidation'])/'backend.json')
    protocol = read(Path(inputs['protocolValidation'])/'protocol.json')
    if (backend['schemaVersion'] != 1 or backend['status'] != 'passed'
        or backend['scope'] != 'full-unfiltered-postgres-protocol-concurrency'
        or backend['runtimeSource'] != inputs['runtimeSource'] or backend['testSource'] != inputs['testSource']
        or any(backend[key] != 0 for key in ['failed', 'errors', 'skipped'])
        or type(backend['tests']) is not int or backend['tests'] <= 0
        or type(backend['suites']) is not int or backend['suites'] <= 0
        or len(backend['suiteCounts']) != backend['suites']
        or any(type(count) is not int or count <= 0 for count in backend['suiteCounts'].values())
        or sum(backend['suiteCounts'].values()) != backend['tests']):
        raise ValueError('missing, mismatched or incomplete mandatory backend validation')
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
    return {'schemaVersion': 1, 'claim': 'exact-artifact-bound-to-full-source-validation',
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
        raise ValueError('validation receipt does not match exact artifact/source/full-suite identities')
    print('EXACT_ARTIFACT_FULL_VALIDATION_VERIFIED', expected['nativeSha256'])


if __name__ == '__main__':
    main()
