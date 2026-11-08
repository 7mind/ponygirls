#!/usr/bin/env python3
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
COMPILER_SHA256 = "6470f599d47cc3f685efc4ccf4ddcc8492bfd0dcd87a88bf76ed7bfee0f77f36"


def contents(directory):
    return {path.relative_to(directory): path.read_bytes() for path in directory.rglob("*") if path.is_file()}


def main():
    compiler = Path(os.environ["BABOON"])
    if hashlib.sha256(compiler.read_bytes()).hexdigest() != COMPILER_SHA256:
        raise SystemExit("unexpected Baboon compiler")
    common = ["--omit-most-recent-version-suffix-from-paths", "--omit-most-recent-version-suffix-from-namespaces",
              "--generate-ueba-codecs=false", "--generate-json-codecs-by-default=true"]
    with tempfile.TemporaryDirectory(prefix="rites-codegen-") as temporary:
        output = Path(temporary)
        lock = output / "lock.json"
        shutil.copyfile(ROOT / "models/lock.json", lock)
        subprocess.run([str(compiler), "--model-dir", str(ROOT / "models"), "--lockfile", str(lock),
                        ":scala", "--output", str(output / "scala"), "--runtime", "without", *common,
                        ":typescript", "--output", str(output / "typescript"), *common, "--ts-import-suffix", ".js"],
                       check=True, stdout=subprocess.DEVNULL)
        if lock.read_bytes() != (ROOT / "models/lock.json").read_bytes():
            raise SystemExit("worker model lock requires regeneration")
        for language in ("scala", "typescript"):
            expected = contents(ROOT / "generated" / language)
            actual = contents(output / language)
            if not actual or actual != expected:
                raise SystemExit(f"stale {language} worker generated sources")
            print(f"PASS {language}: {len(actual)} byte-identical generated files")
        if list((output / "scala").glob("Baboon*.scala")):
            raise SystemExit("worker contract must use the canonical Scala runtime")


if __name__ == "__main__":
    main()
