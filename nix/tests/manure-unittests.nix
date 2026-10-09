# manure offline unit suites (server/storage/client/cli/mcp).
#
# Runs the owning agents' unittest suites against the INSTALLED
# package with the VENDORED official JS SDK 1.32.1 + node must-run
# (no network at build: nix/tests/manure-sdk/{package.json,package-lock.json}
# pin the tree; npmDepsHash pins the offline `npm ci` cache). Discovery is
# by the frozen CONTRACT.md §1 filename prefixes; browser suites are
# EXCLUDED here (the manure-browser check owns their real execution —
# no skip-based green). Every listed owner group must be present (a
# missing group fails naming it); build-time self-tests prove the group
# gate and the skip-rejection gate are live (not decorative).
#
# Guards below are SHARED code (nix/tests/manure_guardlib.sh +
# nix/tests/manure_guardlib.py), also driven by the fixtures in
# nix/tests/test_manure_release_guards.py: a gate fixed in the library
# is fixed in every consumer. Structured verdicts only — NEVER grep
# FAILED/ERROR output text (client gen4 E1 expected-negative inner
# 'Ran 1 FAILED'/tracebacks leave the OUTER result successful and must
# NOT false-fail here).
#
# [R8-SDK] Vendored must-run (partition RETIRED): test_mcp_protocol's
# test_sdk_interop_if_available AND test_client_realserver's
# test_official_sdk_lifecycle_against_real_service (A4, mandatory) run
# here with MANURE_MCP_SDK_PATH pointing at the vendored SDK (explicit
# controller env, never a host /srv path or haystack fallback) and node
# on PATH. Parent real-service probe 1.32.1 remains complementary
# evidence, NOT a substitute; the dedicated manure-client check wires the
# official Python SDK must-run (nixpkgs p.mcp) as the complementary leg.
# No successful skip is allowed in either leg.
{ pkgs, manurePackage }:
let
  lib = pkgs.lib;
  python = pkgs.python3;
  src = ../../manure;
  # Frozen owner prefixes (§1), minus browser (owned by manure-browser)
  # and contract (M1 sunset).
  prefixes = [
    "test_server_*.py"
    "test_storage_*.py"
    "test_client_*.py"
    "test_cli_*.py"
    "test_mcp_*.py"
  ];
  # Vendored official JS SDK 1.32.1 + npm deps (offline `npm ci`): the
  # whole node_modules tree is installed so the SDK's bare externals
  # (ajv/zod/cross-spawn/...) resolve by directory walk-up from the SDK
  # files (verified: tarball dist imports bare externals; host smoke test
  # imports client/index.js + client/stdio.js OK with deps installed).
  mcpSdkModules = pkgs.buildNpmPackage {
    pname = "manure-mcp-sdk-vendor";
    version = "1.32.1";
    src = ./manure-sdk;
    npmDepsHash = "sha256-ehsj472Bpd0FAec5WtNKa0aUX/vePHVaqoMQ7ljwl2U=";
    dontBuild = true;
    installPhase = ''
      mkdir -p $out/lib
      cp -r node_modules $out/lib/node_modules
    '';
  };
  mcpSdkPath = "${mcpSdkModules}/lib/node_modules/@modelcontextprotocol/sdk";
in
pkgs.runCommand "manure-unittests"
{
  nativeBuildInputs = [ python pkgs.nodejs ];
} ''
  set -euo pipefail
  source "${./manure_guardlib.sh}"
  # Quoted array: iteration count never depends on the shell's
  # glob options (nullglob would otherwise empty an unquoted list).
  pats=(${lib.concatMapStringsSep " " (p: "'" + p + "'") prefixes})
  # Self-tests drive the SAME guard functions the suites use below, with
  # fixtures that must fail (proving fatal) and clean controls that must
  # pass. Expected-failure directions silence stderr (the reason would
  # otherwise read as a real failure in a passing build log).
  if require_group_files "${pkgs.emptyDirectory}" "test_server_*.py" "self-test" 2>/dev/null; then
    echo "manure-unittests: FAIL — group gate self-test broken"; exit 1;
  fi
  echo "OK" > skip-rule-ok.log
  echo "OK (skipped=1)" > skip-rule-skipped.log
  require_no_skips_file skip-rule-ok.log "self-test/clean" || { echo "manure-unittests: FAIL — skip rule rejects clean runs"; exit 1; }
  if require_no_skips_file skip-rule-skipped.log "self-test/skipped" 2>/dev/null; then
    echo "manure-unittests: FAIL — skip rule misses skips"; exit 1;
  fi
  # SDK preflight (explicit controller env only): the vendored package
  # must carry the official name (A4 re-verifies at runtime; fail here
  # loudly instead of letting every SDK test fail downstream).
  PYTHONPATH=${./.} ${python}/bin/python -c 'from manure_guardlib import check_sdk_package_json; import sys; check_sdk_package_json(sys.argv[1])' "${mcpSdkPath}" \
    || { echo "manure-unittests: FAIL — vendored SDK identity check failed"; exit 1; }
  export MANURE_MCP_SDK_PATH="${mcpSdkPath}"
  for pat in "''${pats[@]}"; do
    require_group_files "${src}/tests" "$pat" "manure-unittests" \
      || { echo "manure-unittests: FAIL — owner group gate failed: $pat"; exit 1; }
    # Must-run all discovered tests for this prefix (JS-SDK tests included
    # via the vendored SDK above — no partition, no skip). PIPESTATUS is
    # read by the shared guard as the first command after the pipeline.
    PYTHONPATH="${./.}:${manurePackage}/${python.sitePackages}" \
      ${python}/bin/python - "$pat" "${src}/tests" <<PYEOF 2>&1 | tee "suite-$pat.log"
import sys
from manure_guardlib import check_unittest_result_clean
import unittest
pat, srcdir = sys.argv[1], sys.argv[2]
loader = unittest.TestLoader()
suite = loader.discover(srcdir, pattern=pat)
def _iter(s):
    for t in s:
        if isinstance(t, unittest.TestSuite):
            yield from _iter(t)
        else:
            yield t
all_tests = list(_iter(suite))
print("manure-unittests: %s total=%d" % (pat, len(all_tests)))
runner = unittest.TextTestRunner(verbosity=2)
result = runner.run(unittest.TestSuite(all_tests))
check_unittest_result_clean(
    total=len(all_tests),
    skipped=list(result.skipped),
    errors=list(result.errors),
    failures=list(result.failures),
    unexpected=list(result.unexpectedSuccesses),
)
PYEOF
    require_pipeline_ok "''${PIPESTATUS[0]}" "manure-unittests/$pat" \
      || { echo "manure-unittests: FAIL — suite errored: $pat"; exit 1; }
    require_no_skips_file "suite-$pat.log" "manure-unittests/$pat" \
      || { echo "manure-unittests: FAIL — mandatory tests skipped: $pat"; exit 1; }
  done
  touch $out
''
