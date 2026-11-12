#!/usr/bin/env python3
"""Check the generated lock helper without downloading or running sbt."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def check(helper: Path, directory: Path) -> None:
    source = helper.read_text()
    runner_directory = re.search(r'PATH=(/nix/store/[^:]+/bin):', source)
    if runner_directory is None:
        raise AssertionError('Missing isolated generation PATH')
    runner = Path(runner_directory.group(1)) / 'sbt'
    runner_source = runner.read_text()
    launcher = re.search(r'(?:exec )?(/nix/store/\S+/bin/chronicle-sbt) ', runner_source)
    if launcher is None:
        raise AssertionError('Missing pinned sbt launcher')
    mock = directory / 'mock-sbt'
    adapted_runner = directory / 'sbt'
    adapted_runner.write_text(runner_source.replace(launcher.group(1), str(mock)))
    adapted_runner.chmod(0o755)
    env = {
        **os.environ,
        'SBT_OPTS': '',
        'SBT_GLOBAL_BASE': str(directory / 'global'),
        'COURSIER_CACHE': str(directory / 'cache'),
    }
    cases = [
        ('plain error', 'echo "[error] Failed to write cache"; exit 0', 1),
        ('ANSI error', 'printf "\\033[31m[error]\\033[0m Failed to write cache\\n"; exit 0', 1),
        ('child failure', 'echo "[error] child failed"; exit 7', 7),
        ('warning', 'echo "[warn] Compiler warning"; exit 0', 0),
        ('nonprefix substring', 'echo "[info] source contains [error] text"; exit 0', 0),
        ('success', 'echo "[info] successful"; exit 0', 0),
        ('stderr error', 'echo "[error] stderr failure" >&2; exit 0', 1),
        ('stderr warning', 'echo "[warn] stderr warning" >&2; exit 0', 0),
        ('both streams', 'echo "[info] stdout message"; echo "[warn] stderr message" >&2; exit 0', 0),
    ]
    for name, body, expected in cases:
        mock.write_text('#!/bin/sh\n' + body + '\n')
        mock.chmod(0o755)
        result = subprocess.run([str(adapted_runner), '--batch', 'compile'], env=env,
                                capture_output=True, text=True, check=False)
        if result.returncode != expected or not result.stdout:
            raise AssertionError((name, result.returncode, expected, result.stdout, result.stderr))
        if name == 'both streams' and not all(text in result.stdout for text in ['stdout message', 'stderr message']):
            raise AssertionError('Lost stdout or stderr output')
        print(f'PASS {name}: exit {result.returncode}, output preserved')
    link = directory / 'lock-link'
    link.symlink_to(directory / 'absent-lock')
    for arguments in [[], ['relative.json'], [str(directory)], [str(link)]]:
        result = subprocess.run([str(helper), *arguments], capture_output=True, text=True, check=False)
        if result.returncode != 2:
            raise AssertionError((arguments, result.returncode, result.stdout, result.stderr))
        print(f'PASS destination guard: {arguments}')
    generator = re.search(r'timeout [0-9]+ (/nix/store/\S+/bin/squish-lockfile)', source)
    if generator is None:
        raise AssertionError('Missing bounded pinned lock generator')
    mock_generator = directory / 'mock-generator'
    adapted_helper = directory / 'helper'
    adapted_helper.write_text(source.replace(generator.group(1), str(mock_generator)))
    adapted_helper.chmod(0o755)
    destination = directory / 'published.lock.json'
    lock = {'version': 1, 'artifacts': [{'url': 'https://repo.maven.apache.org/maven2/test.jar',
                                       'sha256': '0' * 52}]}
    assemblies = [
        'chronicle/target/chronicle-server.jar',
        'haystack/server/target/haystack-server.jar',
        'manure/backend/target/manure-server.jar',
        'rites/server/target/rites-server.jar',
        'ontology/server/target/ontology-server.jar',
    ]
    for state in ['missing', 'empty', 'missing-ontology', 'empty-ontology', 'complete']:
        produced = [] if state == 'missing' else [
            artifact for artifact in assemblies
            if not (state == 'missing-ontology' and artifact.startswith('ontology/'))
        ]
        empty_prefix = {'empty': 'rites/', 'empty-ontology': 'ontology/'}.get(state)
        mock_generator.write_text(
            f'#!{sys.executable}\nimport pathlib, sys\n'
            f'pathlib.Path(sys.argv[-1]).write_text({json.dumps(lock)!r})\n'
            f'for artifact in {produced!r}:\n'
            '    jar = pathlib.Path(artifact)\n'
            '    jar.parent.mkdir(parents=True)\n'
            f'    jar.write_bytes(b"" if {empty_prefix!r} is not None and artifact.startswith({empty_prefix!r}) else b"jar")\n'
        )
        mock_generator.chmod(0o755)
        destination.write_text('original lock')
        result = subprocess.run([str(adapted_helper), str(destination)],
                                env={**os.environ, 'TMPDIR': str(directory)},
                                capture_output=True, text=True, check=False)
        expected = 0 if state == 'complete' else 1
        if result.returncode != expected:
            raise AssertionError((state, result.returncode, result.stdout, result.stderr))
        if state == 'complete':
            if json.loads(destination.read_text()) != lock:
                raise AssertionError('Complete assembly set did not publish the candidate lock')
        elif destination.read_text() != 'original lock':
            raise AssertionError('Incomplete assembly set replaced the original lock')
        print(f'PASS assembly publication guard: {state}, exit {result.returncode}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('helper', type=Path, help='Built chronicle-update-sbt-lock executable')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='sbt-lock-guard-check-') as temporary:
        check(args.helper.resolve(strict=True), Path(temporary))


if __name__ == '__main__':
    main()
