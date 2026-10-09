#!/usr/bin/env python3
"""manure release guards (owned helper, narrow).

Proves the release gate is live, not decorative:
- owned inventory present (flake manure additions, package, modules,
  eval/client/browser/VM checks, plus this helper and vm-runtime);
- required dep groups/helpers present (fails naming the missing one —
  no cross-group quorum, no silent absence);
- skip/canary negative fixtures fail for the expected reason (seeded
  canary/skip redenomination proves each !-grep gate would catch a leak,
  while clean fixtures pass);
- controller checks are FULL (package/evals/client/browser/VM with
  installed defaults, health, LoadCredential, custom writes, TLS
  internal/external handoff, hostile headers), not package/options-only.

Usage: python3 nix/tests/test_manure_release_guards.py [--root DIR]
Exit 0 only when every guard holds; exit 1 names the first violation.
Stdlib only, no network, no driver.
"""
from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path


def _fail(msg: str) -> int:
    print(f"manure-release-guards: FAIL — {msg}", flush=True)
    return 1


#: Owned inventory (relative to the explicit --root candidate). Single
#: source for the existence check, the SHA listing, and alternate-root
#: copies — never the executing script's own directory.
_OWNED_REL = [
    "flake.nix",
    "nix/pkg/manure/package.nix",
    "nix/nixos/manure.nix",
    "nix/hm/manure.nix",
    "nix/hm/dev-llm.nix",
    "nix/tests/manure-browser.nix",
    "nix/tests/manure-client.nix",
    "nix/tests/manure-hm-eval.nix",
    "nix/tests/manure-nixos-eval.nix",
    "nix/tests/manure-unittests.nix",
    "nix/tests/manure-vm.nix",
    "nix/tests/test_manure_release_guards.py",
    "nix/tests/manure-vm-runtime.py",
    "nix/tests/manure-vm-audit.py",
    "nix/tests/manure-installed-shells.py",
    "nix/tests/manure-sdk/package.json",
    "nix/tests/manure-sdk/package-lock.json",
    "nix/tests/manure-hm-stub.nix",
    "nix/tests/manure_guardlib.py",
    "nix/tests/manure_guardlib.sh",
    "nix/tests/manure-privacy-check.py",
]


def _check_owned(root: Path) -> str | None:
    for rel in _OWNED_REL:
        if not (root / rel).is_file():
            return f"owned file absent: {rel}"
    flake = (root / "flake.nix").read_text()
    for marker in (
        "nix/hm/manure.nix",
        "nix/pkg/manure/package.nix",
        "nix/nixos/manure.nix",
        "nix/tests/manure-nixos-eval.nix",
        "nix/tests/manure-hm-eval.nix",
        "nix/tests/manure-client.nix",
        "nix/tests/manure-unittests.nix",
        "nix/tests/manure-browser.nix",
        "nix/tests/manure-vm.nix",
        "manure-vm-audit-test",
        "toolsHmModule",
    ):
        if marker not in flake:
            return f"flake.nix missing manure addition: {marker}"
    nixos = (root / "nix/nixos/manure.nix").read_text()
    for marker in (
        "proxy_set_header Host $manure_host;",
        "map $http_host $manure_host",
        "default $http_host;",
        "error_log /dev/null;",
        "listenAddress IPv6",
        "apiOrigin IPv6",
    ):
        if marker not in nixos:
            return f"nix/nixos/manure.nix missing fix marker: {marker!r}"
    if "proxy_set_header Host $host;" in nixos:
        return "nix/nixos/manure.nix still has bare $host (strips :port)"
    if "error_log off;" in nixos or "access_log off;" in nixos:
        return "nix/nixos/manure.nix silently disables diagnostics"
    hm = (root / "nix/hm/manure.nix").read_text()
    for marker in ("mkdir -p", "manure-cache", "exit 1", "cache dir unavailable"):
        if marker not in hm:
            return f"nix/hm/manure.nix missing R4 marker: {marker!r}"
    dev = (root / "nix/hm/dev-llm.nix").read_text()
    if "./manure.nix" not in dev:
        return "nix/hm/dev-llm.nix missing manure import"
    return None


def _check_deps(root: Path) -> str | None:
    # Frozen groups/helpers (§1, contract/UI/client owned, READONLY here).
    required_files = [
        "manure/manure/server.py",
        "manure/manure/auth.py",
        "manure/manure/domain.py",
        "manure/manure/storage.py",
        "manure/manure/client.py",
        "manure/manure/cli.py",
        "manure/manure/mcp.py",
        "manure/tests/browser/steps.mjs",
        "manure/tests/browser_fixtures.py",
        "manure/web/dashboard/index.html",
        "manure/web/unlock/index.html",
        "manure/skill/SKILL.md",
    ]
    for rel in required_files:
        if not (root / rel).is_file():
            return f"required dep helper absent: {rel}"
    prefixes = [
        "test_server_*.py",
        "test_storage_*.py",
        "test_client_*.py",
        "test_cli_*.py",
        "test_mcp_*.py",
        "test_browser_*.py",
    ]
    import glob

    for pat in prefixes:
        matches = glob.glob(str(root / "manure/tests" / pat))
        if not matches:
            return f"required dep group absent: {pat}"
    return None


def _check_guardlib_py(root: Path) -> str | None:
    """Drive the ACTUAL shared Python guards (same module object family the
    derivations import) with fatal fixtures and clean controls. The module
    loads from the explicit --root candidate by path (spec load, no
    sys.path mutation, no import-cache borrowing)."""
    import importlib.util as _ilu

    mod_path = root / "nix" / "tests" / "manure_guardlib.py"
    if not mod_path.is_file():
        return f"guardlib missing under root: {mod_path}"
    spec = _ilu.spec_from_file_location("manure_guardlib_candidate", str(mod_path))
    if spec is None or spec.loader is None:
        return "guardlib spec unloadable"
    gates = _ilu.module_from_spec(spec)
    try:
        spec.loader.exec_module(gates)
    except Exception as exc:
        return f"guardlib import failed: {exc}"

    def fatal(label, fn):
        try:
            fn()
        except gates.GuardFailed:
            return None
        except Exception as exc:
            return f"{label}: wrong exception: {exc!r}"
        return f"{label}: accepted but must refuse"

    def clean(label, fn):
        try:
            fn()
        except gates.GuardFailed as exc:
            return f"{label}: refused but must pass ({exc})"
        except Exception as exc:
            return f"{label}: wrong exception: {exc!r}"
        return None

    import tempfile as _tf

    with _tf.TemporaryDirectory(prefix="manure-guardlib-py-") as td:
        tmp = Path(td)
        err = fatal(
            "result-skipped",
            lambda: gates.check_unittest_result_clean(total=3, skipped=[("t", "r")], errors=[], failures=[], unexpected=[]),
        )
        if err:
            return err
        err = fatal(
            "result-errors",
            lambda: gates.check_unittest_result_clean(total=3, skipped=[], errors=[("t", "tb")], failures=[], unexpected=[]),
        )
        if err:
            return err
        err = fatal(
            "result-empty",
            lambda: gates.check_unittest_result_clean(total=0, skipped=[], errors=[], failures=[], unexpected=[]),
        )
        if err:
            return err
        # E1 control: outer success alongside inner 'Ran 1 FAILED' text
        # passes, because verdicts never read output text.
        err = clean(
            "result-outer-ok-despite-inner-failed-text",
            lambda: gates.check_unittest_result_clean(total=5, skipped=[], errors=[], failures=[], unexpected=[]),
        )
        if err:
            return err
        # Real unittest result objects (not synthetic lists): a passing
        # test is clean; an expectedFailure that PASSES is spec drift and
        # must refuse even though unittest's own wasSuccessful() ignores
        # unexpected successes; a skipped test must refuse naming the skip.
        import io as _io
        import unittest as _ut

        class _Pass(_ut.TestCase):
            def test_ok(self):
                pass

        class _Unexp(_ut.TestCase):
            @_ut.expectedFailure
            def test_would_pass(self):
                pass

        class _Skip(_ut.TestCase):
            @_ut.skip("deliberate fixture skip")
            def test_skip(self):
                pass

        def _real(cls):
            res = _ut.TextTestRunner(stream=_io.StringIO(), verbosity=0).run(
                _ut.TestLoader().loadTestsFromTestCase(cls)
            )
            return {
                "total": res.testsRun,
                "skipped": list(res.skipped),
                "errors": list(res.errors),
                "failures": list(res.failures),
                "unexpected": list(res.unexpectedSuccesses),
            }

        err = clean(
            "result-real-clean",
            lambda: gates.check_unittest_result_clean(**_real(_Pass)),
        )
        if err:
            return err
        got = _real(_Unexp)
        if not got["unexpected"]:
            return "result-real-unexpected-success: fixture produced no unexpectedSuccess"
        err = fatal(
            "result-real-unexpected-success",
            lambda g=got: gates.check_unittest_result_clean(**g),
        )
        if err:
            return err
        got = _real(_Skip)
        if not got["skipped"]:
            return "result-real-skipped: fixture produced no skip"
        err = fatal(
            "result-real-skipped",
            lambda g=got: gates.check_unittest_result_clean(**g),
        )
        if err:
            return err
        seed = tmp / "seed.log"
        seed.write_text("GET /x?grant=CANARY_E2E_SELFTEST HTTP/1.1\n")
        err = fatal(
            "canary-seeded",
            lambda p=seed: gates.check_canaries_absent(p.read_text(), ["CANARY_E2E_SELFTEST"]),
        )
        if err:
            return err
        ctl = tmp / "clean.log"
        ctl.write_text("GET /api/v1/nope  200\n")
        err = clean(
            "canary-clean",
            lambda p=ctl: gates.check_canaries_absent(p.read_text(), ["CANARY_E2E_SELFTEST"]),
        )
        if err:
            return err
        err = fatal(
            "path-missing",
            lambda p=ctl: gates.check_sanitized_path_present(p.read_text(), "GET /missing "),
        )
        if err:
            return err
        err = clean(
            "path-present",
            lambda p=ctl: gates.check_sanitized_path_present(p.read_text(), "GET /api/v1/nope "),
        )
        if err:
            return err
        code502 = tmp / "c502"
        code502.write_text("502")
        err = clean("status-exact", lambda: gates.check_exact_status(code502.read_text(), 502))
        if err:
            return err
        code000 = tmp / "c000"
        code000.write_text("000")
        err = fatal("status-000", lambda: gates.check_exact_status(code000.read_text(), 502))
        if err:
            return err
        code404 = tmp / "c404"
        code404.write_text("404")
        err = fatal("status-wrong-code", lambda: gates.check_exact_status(code404.read_text(), 502))
        if err:
            return err
        aid_a = tmp / "a1"
        aid_b = tmp / "a2"
        aid_a.write_text("d" * 32 + "\n")
        aid_b.write_text("d" * 32 + "\n")
        err = clean(
            "artifact-equal",
            lambda: gates.check_artifact_ids_equal(aid_a.read_text().strip(), aid_b.read_text().strip()),
        )
        if err:
            return err
        aid_b.write_text("e" * 32 + "\n")
        err = fatal(
            "artifact-mismatch",
            lambda: gates.check_artifact_ids_equal(aid_a.read_text().strip(), aid_b.read_text().strip()),
        )
        if err:
            return err
        sdkdir = tmp / "sdk"
        sdkdir.mkdir()
        err = fatal("sdk-missing", lambda: gates.check_sdk_package_json(str(sdkdir / "nope")))
        if err:
            return err
        (sdkdir / "package.json").write_text('{"name": "something-else"}')
        err = fatal("sdk-wrong-name", lambda: gates.check_sdk_package_json(str(sdkdir)))
        if err:
            return err
        (sdkdir / "package.json").write_text('{"name": "@modelcontextprotocol/sdk"}')
        err = clean("sdk-official", lambda: gates.check_sdk_package_json(str(sdkdir)))
        if err:
            return err
        # Resume-reuse oracle: size=10 chunk=4 -> chunks [0,4),[4,8),[8,10);
        # ranges [[0,4]] leave exactly 2 missing PUTs.
        import json as _json

        def _status_doc(size, chunk, received, ranges):
            return {
                "chunk_bytes": chunk,
                "files": [
                    {"size": size, "received_bytes": received, "received_ranges": ranges}
                ],
            }

        rust = tmp / "reuse-status.json"
        rjou = tmp / "reuse-journal.log"
        rust.write_text(_json.dumps(_status_doc(10, 4, 4, [[0, 4]])))
        rjou.write_text(
            "manure rid=1 PUT chunks -> 200 user=u bytes=4 1.0ms\n"
            "manure rid=2 PUT chunks -> 200 user=u bytes=4 1.0ms\n"
        )
        err = clean(
            "reuse-exact",
            lambda s=rust, j=rjou: gates.check_resume_reuse(str(s), str(j)),
        )
        if err:
            return err
        rjou.write_text(
            rjou.read_text()
            + "manure rid=3 PUT chunks -> 200 user=u bytes=4 1.0ms\n"
        )
        err = fatal(
            "reuse-retransmit",
            lambda s=rust, j=rjou: gates.check_resume_reuse(str(s), str(j)),
        )
        if err:
            return err
        rjou.write_text("manure rid=1 GET upload-status -> 200 user=u bytes=9 0.1ms\n")
        err = fatal(
            "reuse-omission",
            lambda s=rust, j=rjou: gates.check_resume_reuse(str(s), str(j)),
        )
        if err:
            return err
        rust.write_text(_json.dumps(_status_doc(10, 4, 10, [[0, 10]])))
        err = fatal(
            "reuse-complete",
            lambda s=rust, j=rjou: gates.check_resume_reuse(str(s), str(j)),
        )
        if err:
            return err
        rust.write_text(_json.dumps(_status_doc(10, 4, 2, [])))
        err = fatal(
            "reuse-no-ranges",
            lambda s=rust, j=rjou: gates.check_resume_reuse(str(s), str(j)),
        )
        if err:
            return err
        rust.write_text(_json.dumps(_status_doc(8, 4, 2, [[0, 2]])))
        err = fatal(
            "reuse-no-coverage",
            lambda s=rust, j=rjou: gates.check_resume_reuse(str(s), str(j)),
        )
        if err:
            return err
        # Token-mount attribution: writable token + writable cache outside
        # any mount must REFUSE (write succeeds -> mount not enforcing);
        # missing token / unwritable cache fail naming their cause; a real
        # read-only remount-bind (unprivileged userns) must ACCEPT via EROFS.
        import os as _os

        tok = tmp / "token.raw"
        tok.write_text("A" * 43)
        tok.chmod(0o600)
        cdir = tmp / "cache"
        cdir.mkdir()
        err = fatal(
            "token-write-succeeds",
            lambda: gates.check_token_mount_ro(str(tok), str(cdir)),
        )
        if err:
            return err
        err = fatal(
            "token-unreadable",
            lambda: gates.check_token_mount_ro(str(tmp / "nope.raw"), str(cdir)),
        )
        if err:
            return err
        rocache = tmp / "rocache"
        rocache.mkdir()
        rocache.chmod(0o555)
        err = fatal(
            "token-cache-unwritable",
            lambda: gates.check_token_mount_ro(str(tok), str(rocache)),
        )
        if err:
            return err
        import subprocess as _sp
        import sys as _sys

        mnt = tmp / "romnt"
        mnt.mkdir()
        (mnt / "token.raw").write_text("A" * 43)
        (mnt / "token.raw").chmod(0o600)
        DQ = chr(34)
        # Double quotes for python-level paths: they sit inside the
        # sh-level single-quoted -c program (no nesting breakage).
        child_prog = (
            "import sys; sys.path.insert(0, " + DQ + str(mod_path.parent) + DQ + "); "
            "from manure_guardlib import check_token_mount_ro; "
            "check_token_mount_ro(" + DQ + str(mnt / 'token.raw') + DQ + ", " + DQ + str(cdir) + DQ + ")"
        )
        try:
            r = _sp.run(
                ["unshare", "-rm", "sh", "-c",
                 f"mount --bind {mnt} {mnt} && mount -o remount,ro,bind {mnt} && "
                 f"{_sys.executable} -c '{child_prog}'"],
                capture_output=True,
                text=True,
                timeout=120,
            )
        except FileNotFoundError:
            return "token-erofs: unshare absent (no fallback accepted)"
        if r.returncode != 0:
            return f"token-erofs: refused but must pass ({r.stderr[-300:]!r})"
    return None


def _check_cli_actual(root: Path) -> str | None:
    """Drive the ACTUAL candidate CLI entrypoint (`python -m manure.cli`,
    fresh interpreter per call) for credential/usage negatives with intended
    reasons and clean controls. The package resolves from the explicit
    --root candidate (subprocess CWD), never the executing script's
    siblings, sys.path, or import cache. No server is contacted: every
    negative exits before any network use."""
    import os as _os
    import subprocess as _sp
    import sys as _sys
    import tempfile as _tf

    pkgdir = root / "manure"
    if not (pkgdir / "manure" / "cli.py").is_file():
        return f"CLI package missing under root: {pkgdir}"

    cred_keys = (
        "MANURE_URL", "MANURE_URL_FILE", "MANURE_TOKEN", "MANURE_TOKEN_FILE",
        "MANURE_CACHE_DIR", "MANURE_EXTERNAL_PASSWORD", "MANURE_EXTERNAL_PASSWORD_FILE",
    )

    def _run(argv, env):
        full_env = {k: v for k, v in _os.environ.items() if k not in cred_keys}
        full_env.update(env)
        proc = _sp.run(
            [_sys.executable, "-m", "manure.cli", *argv],
            cwd=str(pkgdir),
            env=full_env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return proc.returncode, proc.stdout, proc.stderr

    with _tf.TemporaryDirectory(prefix="manure-cli-neg-") as td:
        # Clean control: the real CLI parses and runs --help (exit 0).
        rc, _, _ = _run(["--help"], {})
        if rc != 0:
            return f"cli-help: refused but must pass (rc={rc})"
        # Negative: whoami with no credentials fails CLOSED naming
        # missing-credentials (exit 2, before any network).
        rc, _, se = _run(["whoami"], {})
        if rc != 2 or "missing-credentials" not in se:
            return f"cli-missing-credentials: must refuse exit 2 naming it (rc={rc} err={se[-200:]!r})"
        # Negative: upload without --access is a usage error naming it
        # (dummy env only proves format-valid creds; validation precedes
        # any filesystem/network use, so the path need not exist).
        dummy = {"MANURE_URL": "https://example.invalid", "MANURE_TOKEN": "A" * 43}
        rc, _, se = _run(["upload", str(Path(td) / "nope.bin")], dummy)
        if rc != 2 or "missing --access" not in se:
            return f"cli-missing-access: must refuse exit 2 naming it (rc={rc} err={se[-200:]!r})"
        # Clean control: --cache-dir (the persistent-cache root analog)
        # parses and flows; usage is still enforced for its reason.
        rc, _, se = _run(["--cache-dir", td, "upload", str(Path(td) / "nope.bin")], dummy)
        if rc != 2 or "missing --access" not in se:
            return f"cli-cache-dir: must parse and still enforce usage (rc={rc} err={se[-200:]!r})"
    return None


def _check_guardlib_sh(root: Path) -> str | None:
    """Drive the ACTUAL shared shell guards (same file the derivations
    source) with fixtures that must fail and clean controls. The library
    path resolves under the explicit --root candidate."""
    import subprocess as _sp
    import tempfile as _tf

    lib = root / "nix" / "tests" / "manure_guardlib.sh"
    if not lib.is_file():
        return f"guardlib.sh absent under root: {lib}"

    def run_snippet(body: str) -> tuple[int, str]:
        # Fixture logs stay inside the temporary dir (cwd): the snippets
        # use relative log names exactly like the derivations do, so a
        # bare run must never litter the candidate worktree.
        proc = _sp.run(
            ["bash", "-c", f"set -euo pipefail\nsource {lib}\n{body}"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=td,
        )
        return proc.returncode, (proc.stdout + proc.stderr)[-800:]

    with _tf.TemporaryDirectory(prefix="manure-guardlib-sh-") as td:
        tmp = Path(td)
        # Missing helper: fatal naming it; present helper: clean.
        rc, _ = run_snippet(f'require_file_present "{tmp}/nope.mjs" "demo-helper"')
        if rc == 0:
            return "sh/file-missing: accepted but must refuse"
        rc, _ = run_snippet(f'require_file_present "{lib}" "demo-helper"')
        if rc != 0:
            return "sh/file-present: refused but must pass"
        # Missing group: fatal; populated dir with matching files: clean.
        empty = tmp / "empty"
        empty.mkdir()
        rc, _ = run_snippet(f'require_group_files "{empty}" "test_server_*.py" "demo"')
        if rc == 0:
            return "sh/group-missing: accepted but must refuse"
        (empty / "test_server_x.py").write_text("x\n")
        rc, _ = run_snippet(f'require_group_files "{empty}" "test_server_*.py" "demo"')
        if rc != 0:
            return "sh/group-present: refused but must pass"
        # Nullglob both states: the guard must accept a populated group
        # and restore the caller's nullglob setting either way (the
        # capture reads `shopt -p` output, never its state exit status).
        rc, out = run_snippet(
            f'shopt -u nullglob; require_group_files "{empty}" "test_server_*.py" "demo"; '
            'st=$(shopt -p nullglob || true); test "$st" = "shopt -u nullglob"'
        )
        if rc != 0:
            return "sh/nullglob-off: refused but must pass" + out[-200:]
        rc, out = run_snippet(
            f'shopt -s nullglob; require_group_files "{empty}" "test_server_*.py" "demo"; '
            'st=$(shopt -p nullglob || true); test "$st" = "shopt -s nullglob"'
        )
        if rc != 0:
            return "sh/nullglob-on: refused but must pass" + out[-200:]
        # Pipe verdicts through the shared guard. NOTE: no bare failing
        # pipeline here — under `set -euo pipefail` it would exit before
        # reaching the guard; intentional failures use the subshell shape
        # (exactly as the derivations do).
        rc, out = run_snippet(
            '( set +e; false | tee pipe-fail.log; require_pipeline_ok "${PIPESTATUS[0]}" "demo" )'
        )
        if rc == 0:
            return "sh/pipe-fail: accepted but must refuse" + out[-200:]
        rc, _ = run_snippet('true | tee pipe-ok.log; require_pipeline_ok "${PIPESTATUS[0]}" "demo"')
        if rc != 0:
            return "sh/pipe-clean: refused but must pass"
        # Skip markers both directions.
        (tmp / "ok.log").write_text("OK\n")
        rc, _ = run_snippet(f'require_no_skips_file "{tmp}/ok.log" "demo"')
        if rc != 0:
            return "sh/skip-clean: refused but must pass"
        (tmp / "skipped.log").write_text("OK (skipped=1)\n")
        rc, _ = run_snippet(f'require_no_skips_file "{tmp}/skipped.log" "demo"')
        if rc == 0:
            return "sh/skip-present: accepted but must refuse"
        # Failed no-skip browser-shaped process: fatal.
        rc, _ = run_snippet(
            '( set +e; false | tee browser-fail.log; require_pipeline_ok "${PIPESTATUS[0]}" "demo-browser" )'
        )
        if rc == 0:
            return "sh/browser-fail: accepted but must refuse"
    return None


def _check_hm_host_simulation() -> str | None:
    """COMPLEMENTARY host simulation of HM cache mechanics (NOT adapter
    acceptance — labeled as such; the dummy writer stands in for the CLI).

    Adapter acceptance lives in nix/tests/manure-vm.nix, which evaluates a
    REAL homeManagerConfiguration (tools+manure+yolo modules, full
    home.path installed) and drives the REAL generated yolo adapter in
    the guest. This simulation uses real FS + shell + signals
    (no server/CLI impl needed) for fast host feedback only: custom cache
    under /srv/nvme/tmp (outside HOME/.cache and PWD), initially absent;
    host mkdir provisioning actually runs; the guard text exits 0 when
    present and 1 with message when absent; an interrupted dummy writer
    (SIGKILL mid-flight) leaves partial state, resume completes and cleans,
    and records carry no secrets. It proves shell mechanics, never the
    adapter, the CLI, or resume semantics.
    """
    import os
    import shutil
    import signal
    import subprocess
    import tempfile
    import time

    yolo_tmp = Path("/srv/nvme/tmp")
    if not yolo_tmp.is_dir() or not os.access(yolo_tmp, os.W_OK):
        return "HM actual: /srv/nvme/tmp not writable (no fallback)"
    base = Path(tempfile.mkdtemp(prefix="manure-hm-actual-", dir=yolo_tmp))
    try:
        cache = base / "custom-cache"
        # Precondition: initially absent + outside default writables.
        if cache.exists():
            return "HM actual: custom cache not initially absent"
        try:
            home_cache = Path.home() / ".cache"
        except Exception:
            home_cache = None
        try:
            cwd = Path.cwd().resolve()
        except Exception:
            return "HM actual: cannot resolve cwd"
        if home_cache is not None:
            try:
                if cache.resolve().is_relative_to(home_cache.resolve()):
                    return "HM actual: custom cache under HOME/.cache (not outside)"
            except Exception:
                pass
        try:
            if cache.resolve().is_relative_to(cwd):
                return "HM actual: custom cache under PWD (not outside)"
        except Exception:
            pass
        # Host hook actual (double-quoted mkdir, as module does).
        cmd = f'mkdir -p "{cache}"'
        r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=30)
        if r.returncode != 0 or not cache.is_dir():
            return f"HM actual: host mkdir provisioning failed: {r.stderr[-300:]}"
        # Guard actual: present -> 0; absent (bind-skip sim) -> 1 + message.
        guard = (
            f'cache="{cache}"; '
            'if [ ! -d "$cache" ] || [ ! -w "$cache" ]; then '
            'echo "manure: cache dir unavailable: $cache '
            '(persistent bind missing; resume records would be lost)" >&2; exit 1; fi'
        )
        r = subprocess.run(["bash", "-c", guard], capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            return "HM actual: guard should pass when provisioned"
        shutil.rmtree(cache)
        r = subprocess.run(["bash", "-c", guard], capture_output=True, text=True, timeout=30)
        if r.returncode != 1 or "manure: cache dir unavailable" not in r.stderr:
            return "HM actual: guard should fail closed when bind missing"
        # Re-provision for resume test.
        r = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, timeout=30)
        if r.returncode != 0 or not cache.is_dir():
            return "HM actual: re-provision failed"
        # Dummy manifest record (no secrets) + fake secrets for negative.
        import hashlib
        import secrets as _secrets

        fake_token = _secrets.token_urlsafe(32)[:43]
        fake_digest = hashlib.sha256(fake_token.encode()).hexdigest()
        fake_pw = "pw-" + _secrets.token_hex(8)
        aid = hashlib.sha256(os.urandom(16)).hexdigest()[:32]
        uploads = cache / "uploads"
        uploads.mkdir(parents=True, exist_ok=True)
        rec = uploads / f"{aid}.json"
        import json as _json

        rec.write_text(_json.dumps({"artifact_id": aid, "manifest": {"name": "hm-actual", "files": 1}, "note": "manifest-only"}))
        body = rec.read_text()
        if fake_token in body or fake_digest in body or fake_pw in body:
            return "HM actual: record unexpectedly contains secrets"
        # Negative: fixture WITH secret must be detectable (gate live).
        if fake_token not in (body + fake_token):
            return "HM actual: no-secrets gate broken (missed seeded secret)"
        # Interrupted writer (SIGKILL mid-flight) + resume + clean.
        expected = os.urandom(2 * 1024 * 1024)
        expected_hash = hashlib.sha256(expected).hexdigest()
        src = base / "expected.bin"
        src.write_bytes(expected)
        dest = base / "fetched.bin"
        writer = base / "writer.py"
        writer_lines = [
            "import sys",
            "import time",
            "src, dest = sys.argv[1], sys.argv[2]",
            "data = open(src, 'rb').read()",
            "n = 256 * 1024",
            "with open(dest, 'wb') as fh:",
            "    fh.write(b'')",
            "    fh.flush()",
            "    import os as _os",
            "    _os.fsync(fh.fileno())",
            "    for i in range(0, len(data), n):",
            "        fh.write(data[i:i + n])",
            "        fh.flush()",
            "        time.sleep(0.02)",
        ]
        writer.write_text(chr(10).join(writer_lines) + chr(10))
        import sys as _sys
        proc = subprocess.Popen([_sys.executable, str(writer), str(src), str(dest)])
        killed = False
        for _ in range(100):
            time.sleep(0.02)
            if proc.poll() is not None:
                break
            try:
                sz = dest.stat().st_size
            except FileNotFoundError:
                sz = 0
            if 0 < sz < len(expected):
                proc.kill()
                killed = True
                break
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
            return "HM actual: writer did not terminate after kill"
        if not killed:
            # Writer finished before we could interrupt (too fast); treat as
            # fixture failure (not resume proof) to avoid false green.
            return "HM actual: could not interrupt mid-flight (fixture too fast)"
        if not rec.is_file():
            return "HM actual: record lost after interrupt (bind not persistent)"
        try:
            partial = dest.stat().st_size
        except FileNotFoundError:
            return "HM actual: partial dest missing after interrupt"
        if not (0 < partial < len(expected)):
            return f"HM actual: partial size unexpected: {partial}"
        # Resume to completion (no kill), verify hash, publish cleans record.
        r = subprocess.run([_sys.executable, str(writer), str(src), str(dest)], capture_output=True, timeout=60)
        if r.returncode != 0:
            return "HM actual: resume writer failed"
        if hashlib.sha256(dest.read_bytes()).hexdigest() != expected_hash:
            return "HM actual: resumed bytes mismatch"
        rec.unlink()
        if rec.exists() or list(uploads.glob("*.json")):
            return "HM actual: record not cleaned after publish"
        return None
    except Exception as exc:
        return f"HM actual: exception: {exc}"
    finally:
        import shutil as _shutil

        _shutil.rmtree(base, ignore_errors=True)


def _check_controller_full(root: Path) -> str | None:
    # Fresh gate must include FULL controller checks, not package-only.
    checks = {
        "manure-nixos-eval": [
            "LoadCredential",
            "manure-launcher",
            "$manure_host",
            "http_host",
            "error_log /dev/null;",
            "ipv6",
            "longIds",
        ],
        "manure-hm-eval": ["MANURE_TOKEN_FILE", "manure-cache", "exit 1"],
        "manure-client": ["manure-mcp", "MANURE_TOKEN_FILE", "whoami"],
        "manure-unittests": ["test_server_", "manure_guardlib", "require_pipeline_ok", "require_no_skips_file", "require_group_files", "check_unittest_result_clean", "unexpectedSuccesses", "check_sdk_package_json", "test_sdk_interop", "test_official_sdk_lifecycle", "manure-sdk"],
        "manure-browser": ["manure_guardlib", "require_pipeline_ok", "require_no_skips_file", "require_group_files", "require_file_present", "playwright-core", "M2"],
        "manure-vm": [
            "manure.service",
            "LoadCredential",
            "/srv/manure-data",
            "api.example.test",
            "X-Forwarded-Host",
            "error_log /dev/null;",
            "api.example.test:9999",
            "installed-shells.py",
            "--cacert",
            "wrong.example",
            "homeManagerConfiguration",
            "home.path",
            "toolsHmModule",
            "hm-guard.sh",
            "yolo --disable=codegraph",
            "/srv/manure-test/token.raw",
            "upload-status",
            "received_bytes",
            "killed-exit",
            "hmStubPi",
            "7834e825",
            "check = true",
            "SSL_CERT_FILE",
            "payload-ran",
            "up-status.json",
            "check_resume_reuse",
            "readlink -f",
            "--after-cursor",
            "--equal-a",
            "check_token_mount_ro",
            "0600",
            "TOKEN-MOUNT-ATTRIBUTION-OK",
            "TOKEN-WRITE-DENIED-OK",
            "manure-hm-cache",
            "manure-hm-fetch",
        ],
    }
    for name, markers in checks.items():
        text = (root / f"nix/tests/{name}.nix").read_text()
        for marker in markers:
            if marker not in text:
                return f"controller check {name}.nix missing FULL marker: {marker!r}"
    return None


def _check_alternateroot(root: Path) -> str | None:
    """The entrypoint must bind libraries to the explicit --root candidate:
    a poisoned alternate root fails this same entrypoint for the intended
    reason, while the explicit real root passes clean. (Fail-first repro
    0750: sibling resolution returned 0 against a poisoned candidate.)
    No recursion: children run with _MANURE_GUARD_NESTED=1."""
    import os as _os
    import shutil as _shutil
    import subprocess as _sp
    import sys as _sys
    import tempfile as _tf

    if _os.environ.get("_MANURE_GUARD_NESTED") == "1":
        return None
    self_path = root / "nix" / "tests" / "test_manure_release_guards.py"
    if not self_path.is_file():
        return f"entrypoint missing under root: {self_path}"

    def _run_self(candidate: Path) -> tuple[int, str]:
        env = dict(_os.environ)
        env["_MANURE_GUARD_NESTED"] = "1"
        proc = _sp.run(
            [_sys.executable, str(self_path), "--root", str(candidate)],
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
        )
        return proc.returncode, (proc.stdout + proc.stderr)[-1500:]

    with _tf.TemporaryDirectory(prefix="manure-altroot-") as td:
        alt = Path(td) / "altroot"
        for rel in _OWNED_REL:
            src = root / rel
            dst = alt / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            _shutil.copy2(src, dst)
        _shutil.copytree(root / "manure", alt / "manure")
        (alt / "nix" / "tests" / "manure_guardlib.py").write_text(
            'raise RuntimeError("POISONED_CANDIDATE_GUARD_LOADED")\n'
        )
        # Negative: the poisoned candidate must fail FOR the poisoned lib.
        rc, out = _run_self(alt)
        if rc == 0:
            return "altroot-poisoned: accepted but must refuse (--root libraries ignored)"
        if "guardlib import failed" not in out or "POISONED_CANDIDATE_GUARD_LOADED" not in out:
            return f"altroot-poisoned: wrong reason (rc={rc} out={out[-300:]!r})"
        # Clean control: the explicit real root passes.
        rc, out = _run_self(root)
        if rc != 0:
            return f"altroot-clean: refused but must pass (rc={rc} out={out[-300:]!r})"
    return None

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="candidate repo root")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    for checker in (_check_owned, _check_deps):
        err = checker(root)
        if err:
            return _fail(err)
    for checker in (_check_guardlib_py, _check_cli_actual, _check_guardlib_sh):
        err = checker(root)
        if err:
            return _fail(err)
    err = _check_hm_host_simulation()
    if err:
        return _fail(err)
    err = _check_alternateroot(root)
    if err:
        return _fail(err)
    err = _check_controller_full(root)
    if err:
        return _fail(err)
    try:
        head = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except Exception:
        head = "unknown"
    print(f"manure-release-guards: HEAD={head}", flush=True)
    for rel in sorted(_OWNED_REL):
        data = (root / rel).read_bytes()
        print(f"  sha256 {hashlib.sha256(data).hexdigest()}  {rel}", flush=True)
    print("manure-release-guards: OK (owned/full/negative gates live)", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
