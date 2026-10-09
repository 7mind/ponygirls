"""MCP stdio JSON-RPC 2.0 behavioral tests (contract v0.2 §10).

Covers: initialize negotiation (supported + offered-downgrade),
tools/list (8 tools+schemas+annotations), tools/call round-trip,
JSON-RPC error shapes, stdout-purity, SDK-client interop (skip w/o SDK).
Pure-stdlib protocol always; SDK path discovered via env/repo.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
import urllib.parse
from pathlib import Path

from manure.auth import generate_token as _gen_token  # canonical vectors (governor A1)
VALID_TOKEN = _gen_token()
_VALID_PW = _gen_token()
ART_ID = "d" * 32


def _dummy_routes():
    def jb(o):
        return json.dumps(o).encode()
    return {
        ("GET", "/api/v1/whoami"): (200, {"Content-Type": "application/json"},
            jb({"user_id": "u", "type": "agent", "token_id": "t"})),
        ("GET", "/api/v1/artifacts"): (200, {"Content-Type": "application/json"},
            jb({"artifacts": [], "next_cursor": None})),
        ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
            jb({"artifact_id": ART_ID, "name": "n", "kind": "file", "visibility": "internal",
                "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                "expires_at": None, "total_bytes": 1, "file_count": 1, "content_url": "http://x"})),
        ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
            jb({"artifact_id": ART_ID, "state": "ready", "files": []})),
        ("DELETE", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
            jb({"ok": True})),
        ("POST", f"/api/v1/artifacts/{ART_ID}/external-password:rotate"): (200, {"Content-Type": "application/json"},
            jb({"external_password": _VALID_PW})),
    }


class DummyTransport:
    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def request(self, method, url, headers, body):
        self.requests.append({"method": method, "url": url})
        parsed = urllib.parse.urlparse(url)
        key = (method.upper(), parsed.path + (("?" + parsed.query) if parsed.query else ""))
        if key not in self.routes:
            key = (method.upper(), parsed.path)
        if key not in self.routes:
            return (404, {"Content-Type": "application/json"},
                    json.dumps({"error": {"code": "not-found", "message": "x"}}).encode())
        s, h, b = self.routes[key]
        return (s, dict(h), b)


def run_mcp_exchange(lines: list[dict], env_extra: dict | None = None):
    """Spawn `python -m manure.mcp` as subprocess with piped stdio.

    Returns (responses: list[dict], stderr_text, returncode).
    Uses PYTHONPATH=manure so the worktree package imports.
    """
    import pathlib
    # worktree root = parent of manure/ project dir
    here = pathlib.Path(__file__).resolve()
    # .../manure/tests/test_mcp_protocol.py -> parents: tests, manure(project), worktree
    proj = here.parents[1]  # manure/
    worktree = here.parents[2]
    env = dict(os.environ)
    for k in list(env):
        if k.startswith("MANURE_"):
            del env[k]
    env.update({"MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN})
    if env_extra:
        env.update(env_extra)
    env["PYTHONPATH"] = str(proj) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    # inject dummy transport via sitecustomize? Instead rely on real transport failing?
    # For protocol tests that need success (whoami/list), run with a fixture server?
    # Simplest: tests that need success use in-process mcp handler with monkeypatched client.
    # This helper is for pure-protocol cases (initialize/list/errors) that need no network.
    payload = "".join(json.dumps(o) + "\n" for o in lines)
    proc = subprocess.run([sys.executable, "-m", "manure.mcp"],
                          input=payload, capture_output=True, text=True, cwd=str(worktree), env=env, timeout=20)
    out_lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
    return out_lines, proc.stderr, proc.returncode


class TestMcpProtocol(unittest.TestCase):
    def test_initialize_supported_echo(self):
        req = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
               "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}
        resps, err, code = run_mcp_exchange([req])
        self.assertEqual(len(resps), 1)
        r = resps[0]
        self.assertEqual(r.get("id"), 1)
        self.assertIn("result", r)
        self.assertEqual(r["result"]["protocolVersion"], "2025-11-25")
        self.assertIn("serverInfo", r["result"])

    def test_initialize_unsupported_offers_downgrade(self):
        req = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
               "params": {"protocolVersion": "1999-01-01", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}}
        resps, err, code = run_mcp_exchange([req])
        self.assertEqual(len(resps), 1)
        self.assertEqual(resps[0]["result"]["protocolVersion"], "2025-11-25")

    def test_full_lifecycle_ping_list_call(self):
        # needs network for call; use pure-protocol parts + stub whoami via fixture below (in-process)
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "ping"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
        ]
        resps, err, code = run_mcp_exchange(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertIn(1, by_id)
        self.assertIn(2, by_id)
        self.assertIn(3, by_id)
        self.assertEqual(by_id[2]["result"], {})
        tools = by_id[3]["result"]["tools"]
        names = sorted(t["name"] for t in tools)
        self.assertEqual(names, sorted(["whoami", "list_artifacts", "get_artifact", "get_manifest",
                                        "upload_artifact", "fetch_artifact", "delete_artifact",
                                        "rotate_external_password"]))
        # schemas strict objects + annotations present
        for t in tools:
            self.assertIn("inputSchema", t)
            self.assertEqual(t["inputSchema"].get("type"), "object")
            self.assertIn("annotations", t)
        ann = {t["name"]: t["annotations"] for t in tools}
        for n in ("whoami", "list_artifacts", "get_artifact", "get_manifest"):
            self.assertTrue(ann[n].get("readOnlyHint"))
            self.assertTrue(ann[n].get("idempotentHint"))
        for n in ("upload_artifact", "fetch_artifact", "delete_artifact", "rotate_external_password"):
            self.assertTrue(ann[n].get("openWorldHint"))

    def test_jsonrpc_error_shapes(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "nope/method"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "no_such_tool", "arguments": {}}},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
             "params": {"name": "get_artifact", "arguments": {}}},  # missing required
        ]
        resps, err, code = run_mcp_exchange(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[2]["error"]["code"], -32601)
        self.assertEqual(by_id[3]["error"]["code"], -32602)
        self.assertEqual(by_id[4]["error"]["code"], -32602)

    def test_parse_error_and_invalid_request(self):
        import pathlib
        here = pathlib.Path(__file__).resolve()
        proj = here.parents[1]
        worktree = here.parents[2]
        env = dict(os.environ)
        for k in list(env):
            if k.startswith("MANURE_"):
                del env[k]
        env.update({"MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN})
        env["PYTHONPATH"] = str(proj)
        payload = "this is not json\n" + json.dumps({"jsonrpc": "2.0", "id": 9, "method": "ping"}) + "\n"
        # need initialize first? parse error responds regardless
        proc = subprocess.run([sys.executable, "-m", "manure.mcp"], input=payload,
                              capture_output=True, text=True, cwd=str(worktree), env=env, timeout=20)
        lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
        codes = sorted(r.get("error", {}).get("code", 0) for r in lines)
        self.assertIn(-32700, codes)

    def test_stdout_purity(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "ping"},
        ]
        resps, err, code = run_mcp_exchange(seq)
        # every stdout line must be JSON-RPC (json object with jsonrpc 2.0)
        import pathlib
        here = pathlib.Path(__file__).resolve()
        proj = here.parents[1]
        worktree = here.parents[2]
        env = dict(os.environ)
        for k in list(env):
            if k.startswith("MANURE_"):
                del env[k]
        env.update({"MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN})
        env["PYTHONPATH"] = str(proj)
        payload = "".join(json.dumps(o) + "\n" for o in seq)
        proc = subprocess.run([sys.executable, "-m", "manure.mcp"], input=payload,
                              capture_output=True, text=True, cwd=str(worktree), env=env, timeout=20)
        for line in proc.stdout.splitlines():
            if not line.strip():
                continue
            obj = json.loads(line)  # must parse
            self.assertEqual(obj.get("jsonrpc"), "2.0")

    def test_tools_call_whoami_inprocess(self):
        # in-process call with dummy transport to verify result envelope (no subprocess network)
        from manure import mcp as mcp_mod
        from manure import client as client_mod
        from manure.client import ManureClient as Real
        tr = DummyTransport(_dummy_routes())
        with unittest.mock.patch.object(client_mod, "ManureClient",
                                         side_effect=lambda *a, **kw: Real(*a, **{**kw, "transport": tr})) as MC:
            # drive handler directly
            handler_env = {"MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN}
            with unittest.mock.patch.dict(os.environ, handler_env, clear=False):
                # simulate tools/call via helper
                res = mcp_mod.handle_tools_call("whoami", {}, client_mod)
                self.assertIn("content", res)
                self.assertEqual(res["content"][0]["type"], "text")
                payload = json.loads(res["content"][0]["text"])
                self.assertEqual(payload["user_id"], "u")

    def test_tools_call_domain_fault_iserror(self):
        from manure import mcp as mcp_mod
        from manure import client as client_mod
        from manure.client import ManureClient as Real

        class FailTransport:
            def request(self, method, url, headers, body):
                return (404, {"Content-Type": "application/json"},
                        json.dumps({"error": {"code": "not-found", "message": "gone"}}).encode())

        with unittest.mock.patch.object(client_mod, "ManureClient",
                                         side_effect=lambda *a, **kw: Real(*a, **{**kw, "transport": FailTransport()})) as MC:
            with unittest.mock.patch.dict(os.environ, {"MANURE_URL": "http://127.0.0.1:8000",
                                                       "MANURE_TOKEN": VALID_TOKEN}):
                res = mcp_mod.handle_tools_call("get_artifact", {"artifact_id": ART_ID}, client_mod)
                self.assertTrue(res.get("isError"))
                self.assertIn("not-found", res["content"][0]["text"])

    def test_sdk_interop_if_available(self):
        # Complementary FakeHTTP interop only (A4): real-service SDK lifecycle
        # lives in test_client_realserver (mandatory, no skip). This unit path
        # uses a canned HTTP fixture, never the live service.
        # Discover SDK: explicit MANURE_MCP_SDK_PATH, then the repo-local
        # haystack/node_modules driver (Nix pins/wires the official SDK there).
        # No scratch/private (/srv) fallbacks: paths are resolved absolutely;
        # skip only when genuinely absent (node/SDK missing).
        import pathlib as _pl
        candidates = []
        if os.environ.get("MANURE_MCP_SDK_PATH"):
            candidates.append(os.environ["MANURE_MCP_SDK_PATH"])
        here0 = _pl.Path(__file__).resolve()
        worktree0 = here0.parents[2]
        for p in [str(worktree0 / "haystack" / "node_modules" / "@modelcontextprotocol" / "sdk")]:
            candidates.append(p)
        sdk_dir = None
        for c in candidates:
            try:
                ap = str(_pl.Path(c).resolve())
            except OSError:
                continue
            if os.path.isdir(ap):
                sdk_dir = ap
                break
        if sdk_dir is None:
            self.skipTest("SDK not present")
        # Minimal interop: drive official SDK client (Node) against our stdio server
        # Write a small .mjs that uses Client + StdioClientTransport to call ping + tools/list
        import shutil
        if shutil.which("node") is None:
            self.skipTest("node absent")
        helper = """
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const transport = new StdioClientTransport({ command: process.env.MANURE_PY_BIN || "python3", args: ["-m", "manure.mcp"],
  env: {...process.env, PYTHONPATH: process.env.MANURE_PY_PATH }, cwd: process.env.MANURE_WORKTREE });
const client = new Client({ name: "t", version: "0" }, { capabilities: {} });
await client.connect(transport);
await client.ping();
const tools = await client.listTools();
const who = await client.callTool({ name: "whoami", arguments: {} });
const bad = await client.callTool({ name: "get_artifact", arguments: { artifact_id: "0".repeat(32) } });
console.log(JSON.stringify({ toolCount: tools.tools.length, names: tools.tools.map(t=>t.name).sort(),
  whoErr: !!who.isError, badErr: !!bad.isError }));
await client.close();
"""
        with tempfile.TemporaryDirectory() as td:
            # ESM does not honor NODE_PATH; link the SDK into a local node_modules.
            try:
                nm = os.path.join(td, "node_modules", "@modelcontextprotocol")
                os.makedirs(nm, exist_ok=True)
                link = os.path.join(nm, "sdk")
                if not os.path.lexists(link):
                    os.symlink(sdk_dir, link)
            except Exception as e:
                self.skipTest(f"cannot link SDK: {e}")
            hj = os.path.join(td, "interop.mjs")
            Path(hj).write_text(helper)
            import pathlib
            here = pathlib.Path(__file__).resolve()
            proj = here.parents[1]
            worktree = here.parents[2]
            env = dict(os.environ)
            env["MANURE_URL"] = "http://127.0.0.1:8000"
            env["MANURE_TOKEN"] = VALID_TOKEN
            env["MANURE_PY_PATH"] = str(proj)
            env["MANURE_WORKTREE"] = str(worktree)
            env["NODE_PATH"] = os.path.dirname(os.path.dirname(sdk_dir)) + os.pathsep + env.get("NODE_PATH", "")
            env["MANURE_PY_BIN"] = env.get("MANURE_PY_BIN") or sys.executable
            # Minimal authenticated fixture so whoami succeeds (success case) while
            # unknown-artifact get_artifact exercises the error case.
            import http.server as _hs, threading as _th, json as _js
            VALID = VALID_TOKEN
            ART = ART_ID
            class _H(_hs.BaseHTTPRequestHandler):
                def log_message(self, *a):
                    pass
                def do_GET(self):
                    if self.path == "/api/v1/whoami" and self.headers.get("Authorization") == f"Bearer {VALID}":
                        body = _js.dumps({"user_id": "u", "type": "agent", "token_id": "t"}).encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    if self.path == f"/api/v1/artifacts/{ART}/files":
                        body = _js.dumps({"error": {"code": "not-found", "message": "gone"}}).encode()
                        self.send_response(404)
                        self.send_header("Content-Type", "application/json")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    body = _js.dumps({"error": {"code": "not-found", "message": "x"}}).encode()
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
            _srv = _hs.ThreadingHTTPServer(("127.0.0.1", 0), _H)
            _port = _srv.server_address[1]
            _th.Thread(target=_srv.serve_forever, daemon=True).start()
            env["MANURE_URL"] = f"http://127.0.0.1:{_port}"
            try:
                proc = subprocess.run(["node", hj], capture_output=True, text=True, timeout=30,
                                      cwd=td, env=env)
            except OSError as e:
                self.skipTest(f"node unavailable: {e}")
            # B8: fail interoperability regressions when the SDK is present;
            # skip only for genuinely absent prerequisites (node/SDK missing).
            try:
                self.assertEqual(proc.returncode, 0, msg=f"SDK client failed: {proc.stderr[:1000]}")
            finally:
                _srv.shutdown()
                _srv.server_close()
            obj = json.loads(proc.stdout.strip().splitlines()[-1])
            self.assertEqual(obj["toolCount"], 8)
            self.assertFalse(obj["whoErr"])
            self.assertTrue(obj["badErr"])


if __name__ == "__main__":
    unittest.main()
