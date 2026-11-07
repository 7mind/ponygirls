#!/usr/bin/env python3
"""Fetch public ranked IDs and judgments only; never fetch corpus text or execute upstream code."""
import argparse
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen
import zipfile

MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024
NETWORK_TIMEOUT_SECONDS = 45


def verified(data, record):
    if len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
        raise ValueError("Artifact size/SHA256 mismatch")
    if "md5" in record and hashlib.md5(data).hexdigest() != record["md5"]:
        raise ValueError("Judgment MD5 does not match ir_datasets")
    return data


def fetch(record):
    with urlopen(record["url"], timeout=NETWORK_TIMEOUT_SECONDS) as response:
        data = response.read(MAX_DOWNLOAD_BYTES + 1)
    if len(data) > MAX_DOWNLOAD_BYTES:
        raise ValueError("Download exceeds execution bound")
    return verified(data, record)


def preserve(path, data):
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError(f"Refusing to overwrite differing artifact: {path}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as handle:
        handle.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    lock = json.loads(Path(__file__).with_name("data.lock.json").read_text())
    archive_path = args.output / "trec-dl-baselines-v1.zip"
    archive = verified(archive_path.read_bytes(), lock["bundle"]) if archive_path.exists() else fetch(lock["bundle"])
    preserve(archive_path, archive)
    with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
        manifest_bytes = bundle.read("bundle_manifest.json")
        manifest = json.loads(manifest_bytes)
        if manifest["experiment_commit"] != lock["bundle"]["experimentCommit"]:
            raise ValueError("Unexpected experiment identity")
        for member in manifest["members"]:
            relative = Path(member["path"])
            if relative.is_absolute() or ".." in relative.parts:
                raise ValueError("Unsafe archive path")
            preserve(args.output / relative, verified(bundle.read(member["path"]), member))
        preserve(args.output / "bundle_manifest.json", manifest_bytes)
    for record in lock["qrels"]:
        target = args.output / record["file"]
        data = verified(target.read_bytes(), record) if target.exists() else fetch(record)
        preserve(target, data)
    print(f"Verified public benchmark artifacts: {args.output}")


if __name__ == "__main__":
    main()
