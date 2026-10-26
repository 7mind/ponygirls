"""Normalize the equivalent braced ORIGIN spelling for auto-patchelf's parser."""
from pathlib import Path
import subprocess
import sys

root, patchelf = sys.argv[1:]
count = 0
for path in Path(root).rglob("*"):
    if not path.is_file() or path.is_symlink():
        continue
    with path.open("rb") as source:
        if source.read(4) != b"\x7fELF":
            continue
    result = subprocess.run([patchelf, "--print-rpath", str(path)], capture_output=True, text=True)
    if result.returncode:
        assert "statically linked" in result.stderr or "cannot find section '.dynamic'" in result.stderr, (path, result.stderr)
        continue
    original = result.stdout.strip()
    normalized = original.replace("${ORIGIN}", "$ORIGIN")
    if original != normalized:
        subprocess.run([patchelf, "--set-rpath", normalized, str(path)], check=True)
        count += 1
print(f"Normalized braced ORIGIN tokens in {count} ELF files")
