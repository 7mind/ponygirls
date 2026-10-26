"""Audit every retained wheel ELF's original ORIGIN entries and interpreter.

Usage: python embedding-elf-audit.py OUTPUT WHEEL_SOURCES_JSON PATCHELF
WHEEL_SOURCES_JSON is the package's passthru.sources, coerced to strings.
Does not load ELF libraries, contact a driver, or execute wheel programs.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import re
import sys
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location("installer", Path(__file__).with_name("embedding-install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
def equivalent_entry(path):
    path = path.replace("${ORIGIN}", "$ORIGIN")
    while path.endswith("/."):
        path = path[:-2]
    return path


output, source_file, patchelf = sys.argv[1:]
sources = json.loads(Path(source_file).read_text())
removed = {f"torchcodec/libtorchcodec_{kind}{abi}.so"
           for kind in ("core", "custom_ops") for abi in (4, 5, 6, 7, 9)}
counts = {"elfs": 0, "origin_entries": 0, "interpreters": 0, "removed_variants": 0}
with tempfile.TemporaryDirectory() as directory:
    original = Path(directory) / "original"
    for source in sources:
        with zipfile.ZipFile(source) as wheel:
            for entry in wheel.infolist():
                if entry.is_dir():
                    continue
                if entry.filename in removed:
                    counts["removed_variants"] += 1
                    continue
                with wheel.open(entry) as member:
                    if member.read(4) != b"\x7fELF":
                        continue
                target = Path(output) / installer.destination(Path(entry.filename))
                assert target.is_file(), target
                original.write_bytes(wheel.read(entry))
                old = subprocess.check_output([patchelf, "--print-rpath", str(original)], text=True).strip().split(":")
                new = subprocess.check_output([patchelf, "--print-rpath", str(target)], text=True).strip().split(":")
                dynamic = {path for path in old if "$" in path}
                for path in dynamic:
                    tokens = re.findall(r"\$(?:\{([^}]+)\}|([A-Za-z_][A-Za-z0-9_]*))", path)
                    assert tokens and all((braced or plain) in {"ORIGIN", "LIB", "PLATFORM"} for braced, plain in tokens), (entry.filename, path)
                origins = {equivalent_entry(path) for path in dynamic}
                assert origins <= {equivalent_entry(path) for path in new}, (entry.filename, sorted(origins), new)
                interpreter = subprocess.run([patchelf, "--print-interpreter", str(target)], capture_output=True, text=True)
                if interpreter.returncode == 0:
                    path = interpreter.stdout.strip()
                    assert path.startswith("/nix/store/") and Path(path).is_file(), (entry.filename, path)
                    counts["interpreters"] += 1
                counts["elfs"] += 1
                counts["origin_entries"] += len(origins)
assert counts["removed_variants"] == len(removed), counts
print(json.dumps(counts, sort_keys=True))
