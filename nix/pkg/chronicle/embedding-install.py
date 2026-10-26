"""Validate wheel paths/collisions, then install offline in a deterministic order."""
import configparser
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import zipfile

known_collision = {
    "flashinfer_python": "e02446b7d8276825d5761b209f46d39ea09c4a5e9db7e97dc641654f3cae6317",
    "torch_c_dlpack_ext": "59480145c7bb8be2bb86d4dda092763953d22d550056ff03bfe704b5af204f89",
}


def destination(path):
    site = PurePosixPath("lib/python3.12/site-packages")
    if not path.parts[0].endswith(".data"):
        return site / path
    scheme = path.parts[1]
    relative = PurePosixPath(*path.parts[2:])
    if scheme in {"purelib", "platlib"}:
        return site / relative
    if scheme == "scripts":
        return PurePosixPath("bin") / relative
    assert scheme == "data", ("Unsupported installation scheme", path)
    return relative


def entry_points(content):
    parser = configparser.ConfigParser(interpolation=None)
    parser.optionxform = str
    parser.read_string(content)
    for section in ("console_scripts", "gui_scripts"):
        if parser.has_section(section):
            for name, target in parser.items(section):
                assert PurePosixPath(name).name == name, name
                yield str(PurePosixPath("bin") / name), "generated:" + target


def main():
    prefix, uv, wheelhouse = map(Path, sys.argv[1:])
    files = {}
    archives = sorted(wheelhouse.glob("*.whl"))
    assert archives, "No wheels"
    for archive in archives:
        owner = archive.name.split("-")[0]
        with zipfile.ZipFile(archive) as wheel:
            for entry in wheel.infolist():
                path = PurePosixPath(entry.filename)
                assert not path.is_absolute() and ".." not in path.parts, (archive.name, entry.filename)
                assert not stat.S_ISLNK(entry.external_attr >> 16), (archive.name, entry.filename)
                if entry.is_dir():
                    continue
                target = destination(path)
                digest = hashlib.sha256(wheel.read(entry)).hexdigest()
                files.setdefault(str(target), []).append((owner, digest))
                if path.parent.name.endswith(".dist-info") and path.name == "entry_points.txt":
                    for target, signature in entry_points(wheel.read(entry).decode()):
                        files.setdefault(target, []).append((owner, signature))
    collisions = {path: owners for path, owners in files.items() if len(owners) > 1}
    backend = "lib/python3.12/site-packages/build_backend.py"
    assert set(collisions) == {backend}, collisions
    assert dict(collisions[backend]) == known_collision, collisions

    # Match the reference container's observed build-only file, not uv task scheduling.
    archives.sort(key=lambda path: (path.name.startswith("flashinfer_python-"), path.name))
    for archive in archives:
        subprocess.run([str(uv), "pip", "install", "--python", str(prefix / "bin/python"),
                        "--offline", "--no-index", "--no-deps", str(archive)], check=True)
    site = prefix / "lib/python3.12/site-packages"
    actual = hashlib.sha256((site / "build_backend.py").read_bytes()).hexdigest()
    assert actual == known_collision["flashinfer_python"], actual
    print(json.dumps({"known_collisions": collisions, "build_backend_sha256": actual}))


if __name__ == "__main__":
    main()
