#!/usr/bin/env python3
"""manure log-privacy probe (owned helper, narrow, guest-run).

Checks sanitized observability on log FILES with the SAME guard functions
(nix/tests/manure_guardlib.py, delivered alongside this file) that the
host-side derivations and fixtures use — one gate implementation, three
runtimes (Nix checks, release-guard fixtures, VM guest).

All inputs arrive as argv (paths, canary tokens, integers only — no shell
quoting layers beyond single quotes). Journal output is captured to files
by trivial shell redirection first; this probe only judges files.

Usage:
  python3 manure-privacy-check.py --log PATH [--log ...]
      [--absent CANARY ...] [--present-substr SUB ...]
      [--status-file PATH --expect CODE]
  python3 manure-privacy-check.py --selftest   # proves gates live

Exit 0 with an OK summary, else exit 1 naming the violated invariant.
Stdlib only.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from manure_guardlib import (  # noqa: E402
    GuardFailed,
    check_artifact_ids_equal,
    check_canaries_absent,
    check_exact_status,
    check_sanitized_path_present,
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--log", action="append", default=[])
    ap.add_argument("--absent", action="append", default=[])
    ap.add_argument("--present-substr", action="append", default=[])
    ap.add_argument("--status-file", default=None)
    ap.add_argument("--expect", type=int, default=None)
    ap.add_argument("--equal-a", default=None)
    ap.add_argument("--equal-b", default=None)
    args = ap.parse_args(argv)
    if args.selftest:
        return selftest()
    try:
        bodies = []
        for rel in args.log:
            try:
                bodies.append(Path(rel).read_text())
            except OSError:
                raise GuardFailed(f"log file unreadable: {rel}")
        combined = "\n".join(bodies)
        if args.absent:
            check_canaries_absent(combined, list(args.absent))
        for sub in args.present_substr:
            check_sanitized_path_present(combined, sub)
        if args.status_file is not None or args.expect is not None:
            if args.status_file is None or args.expect is None:
                raise GuardFailed("status check needs both --status-file and --expect")
            try:
                code = Path(args.status_file).read_text()
            except OSError:
                raise GuardFailed(f"status file unreadable: {args.status_file}")
            check_exact_status(code, args.expect)
        if (args.equal_a is None) != (args.equal_b is None):
            raise GuardFailed("equality check needs both --equal-a and --equal-b")
        if args.equal_a is not None:
            try:
                first = Path(args.equal_a).read_text().strip()
                second = Path(args.equal_b).read_text().strip()
            except OSError:
                raise GuardFailed("equality file unreadable")
            check_artifact_ids_equal(first, second)
    except GuardFailed as exc:
        print(f"manure-privacy-check: FAIL — {exc}", flush=True)
        return 1
    print("manure-privacy-check: OK (sanitized observability holds)", flush=True)
    return 0


def selftest() -> int:
    """Proves every gate used above is live (fatal on seeded violations,
    clean on controls) using the SAME functions (not copies)."""
    import tempfile

    def expect_fatal(label, fn):
        try:
            fn()
        except GuardFailed:
            print(f"selftest {label}: correctly fatal", flush=True)
            return
        print(f"selftest {label}: FAIL — accepted but must refuse", flush=True)
        raise SystemExit(1)

    def expect_clean(label, fn):
        try:
            fn()
        except GuardFailed as exc:
            print(f"selftest {label}: FAIL — refused but must pass ({exc})", flush=True)
            raise SystemExit(1)
        print(f"selftest {label}: correctly clean", flush=True)

    with tempfile.TemporaryDirectory(prefix="manure-privacy-selftest-") as td:
        tmp = Path(td)
        seeded = tmp / "seeded.log"
        seeded.write_text("GET /x?grant=CANARY_E2E_SELFTEST HTTP/1.1 502\n")
        clean = tmp / "clean.log"
        clean.write_text("GET /api/v1/nope  502\n")
        expect_fatal("canary-seeded", lambda: check_canaries_absent(seeded.read_text(), ["CANARY_E2E_SELFTEST"]))
        expect_clean("canary-clean", lambda: check_canaries_absent(clean.read_text(), ["CANARY_E2E_SELFTEST"]))
        expect_fatal("path-missing", lambda: check_sanitized_path_present("nothing here", "GET /api/v1/nope "))
        expect_clean("path-present", lambda: check_sanitized_path_present(clean.read_text(), "GET /api/v1/nope "))
        code502 = tmp / "code"
        code502.write_text("502")
        expect_clean("status-exact", lambda: check_exact_status(code502.read_text(), 502))
        code000 = tmp / "code0"
        code000.write_text("000")
        expect_fatal("status-transport-failure", lambda: check_exact_status(code000.read_text(), 502))
        expect_fatal("status-wrong-code", lambda: check_exact_status(code502.read_text(), 404))
        aid_a = tmp / "a"
        aid_b = tmp / "b"
        aid_a.write_text("d" * 32 + "\n")
        aid_b.write_text("d" * 32 + "\n")
        expect_clean(
            "artifact-equal",
            lambda: check_artifact_ids_equal(aid_a.read_text().strip(), aid_b.read_text().strip()),
        )
        aid_b.write_text("e" * 32 + "\n")
        expect_fatal(
            "artifact-mismatch",
            lambda: check_artifact_ids_equal(aid_a.read_text().strip(), aid_b.read_text().strip()),
        )
    print("selftest: OK (guest probe gates live)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
