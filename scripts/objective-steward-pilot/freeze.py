#!/usr/bin/env python3
"""Export committed pilot bytes, identify them, and freeze them in the Nix store."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

PREFIX = "scripts/objective-steward-pilot/"


def freeze(repository: Path, revision: str) -> str:
    def git(*arguments):
        return subprocess.check_output(["git", "-C", str(repository), *arguments])
    commit = git("rev-parse", revision + "^{commit}").decode().strip()
    entries = git("ls-tree", "-r", "-z", commit, "--", PREFIX).split(b"\0")
    with tempfile.TemporaryDirectory(prefix="steward-freeze-") as temporary:
        stage = Path(temporary) / "objective-steward-pilot"
        stage.mkdir()
        hashes = {}
        for entry in entries:
            if not entry:
                continue
            metadata, raw_path = entry.split(b"\t", 1)
            mode, kind, object_id = metadata.decode().split()
            relative = Path(raw_path.decode()).relative_to(PREFIX)
            if kind != "blob" or mode not in ("100644", "100755") or ".." in relative.parts:
                raise ValueError("unsupported exported entry")
            destination = stage / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            blob = git("cat-file", "blob", object_id)
            destination.write_bytes(blob)
            destination.chmod(0o755 if mode == "100755" else 0o644)
            hashes[str(relative)] = hashlib.sha256(blob).hexdigest()
        if "run.py" not in hashes:
            raise ValueError("committed pilot missing")
        identity = {"version": "steward-source-v1", "commit": commit, "files": hashes}
        (stage / "source-identity.json").write_text(json.dumps(identity, sort_keys=True) + "\n", encoding="utf-8")
        frozen = subprocess.check_output(["nix", "--extra-experimental-features", "nix-command", "store", "add-path", str(stage)], text=True).strip()
        for name in [*hashes, "source-identity.json"]:
            if (Path(frozen) / name).read_bytes() != (stage / name).read_bytes():
                raise ValueError("frozen export differs")
        return frozen

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    print(freeze(args.repository, args.revision))
