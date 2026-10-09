# manure browser check (CONTRACT.md B1–B7, D1, N2-browser, M2).
#
# Linux only. No skip paths: missing server sources, web shells, UI
# suites, or the packaged driver FAIL this check (release gates must
# never go green on absence). Guards below are SHARED code
# (nix/tests/manure_guardlib.sh), also driven by the fixtures in
# nix/tests/test_manure_release_guards.py. Structured verdicts only —
# NEVER grep FAILED/ERROR output text.
# Phases:
#   1. Deterministic driver/chromium resolution
#      (pkgs.playwright-driver IS playwright-core; the derivation fails
#      when its package.json does not say so — no layout guessing).
#   2. M2 on the INSTALLED package with default asset resolution: the
#      server starts from a scratch cwd (so the repo fallback cannot
#      trigger) with the shell keys OMITTED (server default "package"),
#      then dashboard `/` and the external unlock form both answer 200.
#   3. The UI-owned test_browser_* suite with the §11 env resolution.
{ pkgs, manurePackage }:
let
  lib = pkgs.lib;
  driver = pkgs.playwright-driver;
  chromium = pkgs.chromium;
  python = pkgs.python3;
  # Headless Chromium needs real fonts for text metrics (click boxes,
  # layout); the sandbox ships none (Fontconfig error), which breaks
  # interaction-heavy suites while trivial loads pass.
  fontsConf = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
  # Whole manure source tree (probed at build time; fail-closed).
  src = ../../manure;

  # Sandbox DNS stand-in (documented harness gap, not product
  # behavior): the Nix build sandbox has no resolver, while dev hosts
  # answer *.localhost via systemd-resolved and Chromium gets explicit
  # --host-resolver-rules from the fixture. This sitecustomize maps the
  # fixture's three localhost families to 127.0.0.1 for AF_UNSPEC/AF_INET
  # lookups only (AF_INET6 and everything else delegate untouched), so
  # Python-side urllib in the tests resolves exactly as the browser does.
  dnsHook = pkgs.writeTextDir "sitecustomize/sitecustomize.py" ''
    import socket as _socket
    _orig_getaddrinfo = _socket.getaddrinfo
    _SUFFIXES = ("artifacts.localhost", "manure-files.localhost")
    def _is_fixture_host(host):
        h = str(host).lower().rstrip(".")
        return any(h == s or h.endswith("." + s) for s in _SUFFIXES)
    def getaddrinfo(host, port, family=0, *args, **kwargs):
        if host is not None and _is_fixture_host(host) and family in (0, _socket.AF_INET):
            import sys
            sys.stderr.write("manure-dns-hook: %s -> 127.0.0.1\n" % host)
            return [(_socket.AF_INET, _socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]
        return _orig_getaddrinfo(host, port, family, *args, **kwargs)
    _socket.getaddrinfo = getaddrinfo
  '';

  m2probe = pkgs.writeText "manure-m2-probe.py" ''
    import base64, hashlib, json, os, re, secrets, subprocess, sys, tempfile
    import urllib.request

    pkg = sys.argv[1]
    work = tempfile.mkdtemp(prefix="manure-m2-")
    data = os.path.join(work, "data")
    os.makedirs(data)
    raw = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(raw.encode()).hexdigest()
    digest_file = os.path.join(work, "digest.sha256")
    with open(digest_file, "w") as fh:
        fh.write(digest + "\n")
    # Shell keys OMITTED: the server default ("package") must resolve to
    # the INSTALLED manure/web tree. cwd is scratch, so the repo
    # fallback cannot rescue a bad install.
    config = {
        "port": 0,
        "data_dir": data,
        "api_origin": "http://127.0.0.1:1",
        "content_suffix": "artifacts.localhost",
        "loopback_dev": True,
        "users": [{"id": "m2", "type": "agent",
                   "tokens": [{"id": "default", "hashFile": digest_file}]}],
    }
    cfg_path = os.path.join(work, "config.json")
    with open(cfg_path, "w") as fh:
        json.dump(config, fh)
    site = os.path.join(pkg, "${python.sitePackages}")
    env = dict(os.environ, PYTHONPATH=site)
    log = open(os.path.join(work, "stderr.log"), "wb")
    proc = subprocess.Popen(
        [os.path.join(pkg, "bin", "manure-server"), "--config", cfg_path],
        cwd=work, env=env, stdout=subprocess.DEVNULL, stderr=log)
    try:
        origin = None
        for _ in range(200):
            with open(log.name, "rb") as fh:
                m = re.search(rb"manure: serving (\S+)", fh.read())
            if m:
                origin = m.group(1).decode()
                break
            if proc.poll() is not None:
                raise SystemExit("manure-server exited early")
            import time
            time.sleep(0.05)
        if not origin:
            raise SystemExit("manure-server never printed its origin")
        port = int(origin.rsplit(":", 1)[1].rstrip("/"))
        base = "http://127.0.0.1:%d" % port

        def get(url, host=None, code=200):
            req = urllib.request.Request(url)
            if host:
                req.add_header("Host", host)
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read()
                assert resp.status == code, (url, resp.status)
                return resp, body

        def post(url, obj, token=None, origin_hdr=None):
            req = urllib.request.Request(
                url, data=json.dumps(obj).encode(),
                headers={"Content-Type": "application/json"}, method="POST")
            if token:
                req.add_header("Authorization", "Bearer " + token)
            if origin_hdr:
                req.add_header("Origin", origin_hdr)
            with urllib.request.urlopen(req, timeout=10) as resp:
                assert resp.status == 200, (url, resp.status)
                return json.load(resp)

        # Dashboard shell served unauthenticated from installed defaults.
        resp, body = get(base + "/")
        assert len(body) > 0, "empty dashboard"
        csp = resp.headers.get("Content-Security-Policy", "")
        assert "artifacts.localhost" in csp, csp
        # External empty-dir artifact, published with no chunks.
        init = post(base + "/api/v1/artifacts:init",
                    {"name": "m2", "kind": "dir", "visibility": "external",
                     "files": []}, token=raw)
        aid = init["artifact_id"]
        assert "external_password" in init, init.keys()
        pub = post(base + "/api/v1/artifacts/" + aid + "/publish", {},
                   token=raw)
        assert pub.get("content_url"), pub
        # Unlock shell for the external artifact answers 200.
        host = "%s.artifacts.localhost:%d" % (aid, port)
        _, form = get("http://127.0.0.1:%d/__manure/password" % port, host=host)
        assert len(form) > 0, "empty unlock form"
        print("manure M2: dashboard + unlock shells 200 from installed defaults")
    finally:
        proc.terminate()
        proc.wait(timeout=10)
  '';
in
pkgs.runCommand "manure-browser-test"
{
  nativeBuildInputs = [ pkgs.coreutils pkgs.findutils pkgs.gnugrep pkgs.curl pkgs.nodejs python chromium driver pkgs.dejavu_fonts pkgs.openssl ];
  MANURE_CHROMIUM_BIN = "${chromium}/bin/chromium";
  MANURE_PLAYWRIGHT_CORE_PATH = "${driver}";
  # The TLS fixture resolves openssl via PATH or MANURE_OPENSSL_BIN
  # (store lookup is test-only); both are wired from the pinned input.
  MANURE_OPENSSL_BIN = "${pkgs.openssl}/bin/openssl";
  FONTCONFIG_FILE = "${fontsConf}";
} ''
  set -euo pipefail
  source "${./manure_guardlib.sh}"
  # Chromium requires a writable HOME (profile/crashpad); the Nix
  # sandbox sets HOME=/homeless-shelter, which kills the browser at
  # launch (verified SIGTRAP). A scratch HOME is sandbox-local.
  export HOME="$(mktemp -d)"
  # Sandbox DNS stand-in for Python-side urllib (see dnsHook); wired
  # into every python invocation below via PYTHONPATH.
  hookPath="${dnsHook}/sitecustomize"
  # Phase 0 — fail closed on missing server/web/driver inputs.
  require_file_present "${src}/manure/server.py" "manure-browser/server" || exit 1
  require_file_present "${src}/web/dashboard/index.html" "manure-browser/dashboard" || exit 1
  require_file_present "${src}/web/unlock/index.html" "manure-browser/unlock" || exit 1
  # Phase 1 — the packaged driver really is playwright-core.
  grep -q '"name": *"playwright-core"' "$MANURE_PLAYWRIGHT_CORE_PATH/package.json" \
    || { echo "manure-browser: FAIL — driver at $MANURE_PLAYWRIGHT_CORE_PATH is not playwright-core"; exit 1; }
  test -x "$MANURE_CHROMIUM_BIN" \
    || { echo "manure-browser: FAIL — chromium missing"; exit 1; }
  echo "manure-browser: driver=$MANURE_PLAYWRIGHT_CORE_PATH chromium=$MANURE_CHROMIUM_BIN"
  # Phase 2 — M2: installed defaults serve both shells (no checkout fallback).
  PYTHONPATH="$hookPath:${manurePackage}/${python.sitePackages}" \
    ${python}/bin/python "${m2probe}" "${manurePackage}"
  # Phase 3 — the UI-owned browser suite (fail closed while unsynced;
  # skipped mandatory tests also fail: the driver/chromium gates above
  # mean any skip here is unexpected, including a missing helper).
  require_file_present "${src}/tests/browser/steps.mjs" "manure-browser/steps" || exit 1
  require_group_files "${src}/tests" "test_browser_*.py" "manure-browser" || exit 1
  # Self-tests drive the SAME guard functions the suite run uses below,
  # with fixtures that must fail (proving fatal) and clean controls.
  echo "OK" > skip-rule-ok.log
  echo "OK (skipped=1)" > skip-rule-skipped.log
  require_no_skips_file skip-rule-ok.log "self-test/clean" || { echo "manure-browser: FAIL — skip rule rejects clean runs"; exit 1; }
  if require_no_skips_file skip-rule-skipped.log "self-test/skipped" 2>/dev/null; then
    echo "manure-browser: FAIL — skip rule misses skips"; exit 1;
  fi
  # Negative fixture (SAME fixed guard shape): a failed suite with NO skips
  # must still be fatal (proves the guard reads the pipeline status, not
  # skips; the old `|| true` form returned status 0 here — wrong green).
  # Subshell carries `set +e` so the intentional failure reaches the guard
  # (a bare failing pipeline under `set -euo pipefail` would exit first);
  # inside, the status is captured as the first command after the pipeline.
  # The `if` inverts the expected failure into a pass (stderr silenced;
  # the `if` verdict itself is the evidence the guard fired).
  if ( set +e; false | tee pipe-fail.log; require_pipeline_ok "''${PIPESTATUS[0]}" "self-test/pipe" ) 2>/dev/null; then
    echo "manure-browser: FAIL — pipe guard misses failures"; exit 1;
  fi
  PYTHONPATH="$hookPath:${manurePackage}/${python.sitePackages}" \
    ${python}/bin/python -m unittest discover -s "${src}/tests" -p "test_browser_*.py" -v 2>&1 | tee suite.log
  require_pipeline_ok "''${PIPESTATUS[0]}" "manure-browser/suite" \
    || { echo "manure-browser: FAIL — suite errored"; exit 1; }
  require_no_skips_file suite.log "manure-browser/suite" \
    || { echo "manure-browser: FAIL — mandatory browser tests skipped"; exit 1; }
  touch $out
''
