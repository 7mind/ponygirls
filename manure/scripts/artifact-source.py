#!/usr/bin/env python3
"""Deterministic compiled-input identity, independent of worktree absolute path.

Run from any cwd. Build recipe must emit this manifest from the ACTUAL artifact
source snapshot, not generate it after the fact from a different checkout.
"""
import hashlib
from pathlib import Path

root=Path(__file__).resolve().parents[2]
paths=[root/'build.sbt',root/'lockfile.json',root/'lockfile-config.json']
for directory in ['project','manure/backend/src/main','manure/server/src/main','manure/server/native-image',
                  'manure/generated/scala','shared/baboon-runtime/src/main','shared/service-runtime/src/main',
                  'shared/model-http/src/main','shared/retrieval-core/src/main','shared/retrieval-postgres/src/main']:
    paths.extend(p for p in (root/directory).rglob('*') if p.is_file() and 'target' not in p.parts and '.git' not in p.parts)
for path in sorted(set(paths)):
    if path.is_file():print(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+path.relative_to(root).as_posix())
