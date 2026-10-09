# manure client check (R3 MCP exchange + R4 CLI cache precedence).
#
# No skip paths: the installed `manure` CLI and `manure-mcp` stdio
# server come from the client sync; until they exist this check FAILS
# loudly (release gates must never go green on absence). Phases,
# all against an ephemeral INSTALLED server + real token digest:
#   1. Manual JSON-RPC MCP exchange over stdio (initialize negotiation,
#      tools/list schema surface, tools/call whoami round-trip,
#      stdout-purity: every stdout line is one JSON-RPC object).
#   2. Official-SDK interop (nixpkgs python MCP SDK): initialize +
#      list_tools through ClientSession over the installed stdio server.
#   3. CLI: whoami over host-style env defaults, upload/fetch
#      round-trip, cache-record placement under --cache-dir flag,
#      MANURE_CACHE_DIR env, and their precedence (flag wins); cache
#      records carry no secrets.
#
# Baseline inputs are explicit controller env only: the driver takes pkg
# (argv[1]) and site (argv[2]) from the flake's manurePackage (no host or
# delivered private-path fallback). Any future baseline for replay tests
# (e.g. MANURE_BASELINE_CLIENT for E1) must likewise be an explicit
# controller input, never a host/delivered path.
{ pkgs, manurePackage }:
let
  lib = pkgs.lib;
  python = pkgs.python3.withPackages (p: [ p.mcp ]);
  jq = pkgs.jq;
  driver = pkgs.writeText "manure-client-check.py" ''
    import base64, hashlib, json, os, secrets, socket, subprocess, sys
    import tempfile, time, urllib.request

    pkg = sys.argv[1]
    site = sys.argv[2]
    sys.path.insert(0, site)
    # Phase 0 — fail closed while the client sync is pending.
    import importlib.util
    for mod in ("manure.mcp", "manure.cli", "manure.client"):
        if importlib.util.find_spec(mod) is None:
            raise SystemExit(
                "manure-client: FAIL — %s absent (client sync pending)" % mod)
    work = tempfile.mkdtemp(prefix="manure-client-")
    data = os.path.join(work, "data")
    os.makedirs(data)

    def free_port():
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    port = free_port()
    raw = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    assert len(raw) == 43
    digest = hashlib.sha256(raw.encode()).hexdigest()
    token_file = os.path.join(work, "token")
    with open(token_file, "w") as fh:
        fh.write(raw + "\n")
    digest_file = os.path.join(work, "digest.sha256")
    with open(digest_file, "w") as fh:
        fh.write(digest + "\n")
    config = {
        "port": port,
        "data_dir": data,
        "api_origin": "http://127.0.0.1:%d" % port,
        "content_suffix": "artifacts.localhost",
        "loopback_dev": True,
        "users": [{"id": "check", "type": "agent",
                   "tokens": [{"id": "default", "hashFile": digest_file}]}],
    }
    cfg_path = os.path.join(work, "config.json")
    with open(cfg_path, "w") as fh:
        json.dump(config, fh)
    server = subprocess.Popen(
        [os.path.join(pkg, "bin", "manure-server"), "--config", cfg_path],
        cwd=work, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        base = "http://127.0.0.1:%d" % port
        for _ in range(200):
            try:
                with urllib.request.urlopen(base + "/api/v1/health",
                                            timeout=2) as r:
                    if r.status == 200:
                        break
            except Exception:
                time.sleep(0.05)
        else:
            raise SystemExit("server never became healthy")

        child_env = {
            "PATH": "/usr/bin:/bin",
            "MANURE_URL": base,
            "MANURE_TOKEN_FILE": token_file,
        }
        assert "MANURE_TOKEN" not in os.environ, "check env polluted"

        # Phase 1 — manual JSON-RPC exchange.
        mcp = subprocess.Popen(
            [os.path.join(pkg, "bin", "manure-mcp")],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=child_env, cwd=work)
        frames = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "manure-check", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "whoami", "arguments": {}}},
        ]
        blob = ("\n".join(json.dumps(f) for f in frames) + "\n").encode()
        try:
            out, err = mcp.communicate(blob, timeout=60)
        except subprocess.TimeoutExpired:
            mcp.kill()
            raise SystemExit("manure-mcp exchange timed out")
        assert mcp.returncode == 0, (mcp.returncode, err.decode()[-2000:])
        lines = [ln for ln in out.decode().split("\n") if ln.strip()]
        assert len(lines) >= 3, lines  # stdout purity: JSON-RPC only
        by_id = {}
        for ln in lines:
            assert not ln.startswith("Content-Length"), ln[:60]
            by_id[json.loads(ln).get("id", "notify")] = json.loads(ln)
        assert by_id[1]["result"]["protocolVersion"] == "2025-11-25", by_id[1]
        names = {t["name"] for t in by_id[2]["result"]["tools"]}
        for want in ("whoami", "list_artifacts", "get_artifact",
                     "get_manifest", "upload_artifact", "fetch_artifact",
                     "delete_artifact", "rotate_external_password"):
            assert want in names, names
        text = by_id[3]["result"]["content"][0]["text"]
        assert json.loads(text)["user_id"] == "check", text
        print("manure-client: manual MCP exchange OK (8 tools, whoami)")

        # Phase 2 — official SDK interop.
        import asyncio
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        async def sdk_exchange():
            params = StdioServerParameters(
                command=os.path.join(pkg, "bin", "manure-mcp"),
                args=[], env=child_env)
            async with stdio_client(params) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    return {t.name for t in tools.tools}

        sdk_names = asyncio.run(sdk_exchange())
        assert "whoami" in sdk_names and len(sdk_names) == 8, sdk_names
        print("manure-client: SDK interop OK")

        # Phase 3 — CLI cache precedence + resume + round-trip.
        # Records live at <cache>/uploads/<id>.json from init until a
        # completed publish, so precedence is observed by interrupting
        # an upload mid-flight (polled, then SIGKILLed) and resuming.
        cli = os.path.join(pkg, "bin", "manure")
        big = os.path.join(work, "big.bin")
        with open(big, "wb") as fh:
            fh.write(os.urandom(32 * 1048576))
        flag_cache = os.path.join(work, "flag-cache")
        env_cache = os.path.join(work, "env-cache")
        os.makedirs(flag_cache)
        os.makedirs(env_cache)

        def run_cli(args, extra_env):
            env = dict(child_env)
            env.update(extra_env)
            p = subprocess.run([cli] + args, capture_output=True, text=True,
                               env=env, cwd=work, timeout=300)
            assert p.returncode == 0, (args, p.returncode, p.stderr[-2000:])
            return json.loads(p.stdout) if "--json" in args else p.stdout

        def cache_records(cache):
            d = os.path.join(cache, "uploads")
            if not os.path.isdir(d):
                return []
            return [os.path.join(d, f) for f in os.listdir(d)
                    if f.endswith(".json")]

        def interrupt_upload(args, extra_env, cache):
            """Spawn an upload, SIGKILL once its record appears."""
            for _ in range(5):
                proc = subprocess.Popen(
                    [cli] + args, env={**child_env, **extra_env}, cwd=work,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                rec = None
                for _ in range(300):
                    recs = cache_records(cache)
                    if recs:
                        rec = recs[0]
                        break
                    if proc.poll() is not None:
                        break
                    time.sleep(0.02)
                proc.kill()
                proc.wait()
                if rec is not None and os.path.exists(rec):
                    return rec
            raise SystemExit("no cache record observed for %r" % (args,))

        def assert_no_secrets(path):
            body = open(path).read()
            assert raw not in body and digest not in body, path

        me = run_cli(["whoami", "--json"], {})
        assert me["user_id"] == "check", me
        # Flag wins over env: record lands in the flag cache only.
        rec = interrupt_upload(
            ["--cache-dir", flag_cache, "upload", big,
             "--access", "internal", "--json"],
            {"MANURE_CACHE_DIR": env_cache}, flag_cache)
        assert_no_secrets(rec)
        assert cache_records(env_cache) == [], "env cache untouched"
        rec_body = json.load(open(rec))
        aid = rec_body["artifact_id"]
        # Auto-resume (single matching record) completes the upload.
        run_cli(["--cache-dir", flag_cache, "upload", big,
                 "--access", "internal", "--json"],
                {"MANURE_CACHE_DIR": env_cache})
        assert cache_records(flag_cache) == [], "record cleaned"
        dest = os.path.join(work, "fetched")
        run_cli(["fetch", aid, dest, "--json"], {})
        assert open(os.path.join(dest, "big.bin"), "rb").read() == \
            open(big, "rb").read()
        # Env default applies when no flag is given.
        rec2 = interrupt_upload(
            ["upload", big, "--access", "internal", "--json"],
            {"MANURE_CACHE_DIR": env_cache}, env_cache)
        assert_no_secrets(rec2)
        aid2 = json.load(open(rec2))["artifact_id"]
        assert aid2 != aid
        run_cli(["upload", big, "--access", "internal",
                 "--resume", aid2, "--json"],
                {"MANURE_CACHE_DIR": env_cache})
        print("manure-client: CLI cache precedence + resume + round-trip OK")
    finally:
        server.terminate()
        server.wait(timeout=10)
  '';
in
pkgs.runCommand "manure-client-test"
{
  nativeBuildInputs = [ pkgs.coreutils python jq ];
} ''
  ${python}/bin/python "${driver}" "${manurePackage}" "${manurePackage}/${python.sitePackages}"
  touch $out
''
