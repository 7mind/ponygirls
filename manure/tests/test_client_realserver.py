"""Real-server roundtrips: visibilities, token-free external, resume, grants.

Uses manure.server.create_server with port 0, api_origin http://127.0.0.1:0,
loopback_dev True, content_suffix artifacts.localhost, null shells.
Reports integration defects via failing output; never patches server/.

Fake-transport suites (test_client_transport/stateful, test_mcp_protocol
FakeHTTP) are complementary unit coverage only: they never substitute for
this live-service matrix (cookies, grants, pagination, TTL, stdio).
"""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path


def _make_server(tmp: str):
    from manure.domain import ServerConfig, UserConfig, TokenRef
    from manure.server import create_server
    from manure import auth as authmod
    token = authmod.generate_token()
    digest = authmod.sha256_hex(token)
    hash_file = os.path.join(tmp, "tok.hash")
    Path(hash_file).write_text(digest + "\n")
    token_file = os.path.join(tmp, "tok.txt")
    Path(token_file).write_text(token + "\n")
    data_dir = os.path.join(tmp, "data")
    os.makedirs(data_dir, exist_ok=True)
    cfg = ServerConfig(
        listen_address="127.0.0.1", port=0, data_dir=data_dir,
        api_origin="http://127.0.0.1:0", content_suffix="artifacts.localhost",
        loopback_dev=True, dashboard_dir=None, unlock_shell_dir=None,
        users=(UserConfig(id="u-agent", type="agent",
                          tokens=(TokenRef(id="t1", hash_file=hash_file),)),),
    )
    server = create_server(cfg)
    return server, token


class _LocalhostResolver:
    """Test-only resolver adapter (A2): map *.artifacts.localhost to 127.0.0.1.

    Preserves Host/Origin semantics (TCP dials loopback; HTTP Host header and
    Origin values are untouched), so no test skips on DNS.
    """

    def __init__(self, suffix: str = "artifacts.localhost"):
        self.suffix = suffix
        self._orig = None

    def __enter__(self):
        import socket
        self._orig = socket.getaddrinfo
        suffix = self.suffix

        def _patched(host, port, *args, **kwargs):
            if isinstance(host, str) and host.endswith("." + suffix):
                host = "127.0.0.1"
            return self._orig(host, port, *args, **kwargs)

        socket.getaddrinfo = _patched
        return self

    def __exit__(self, *exc):
        import socket
        socket.getaddrinfo = self._orig
        return False


class TestRealServer(unittest.TestCase):
    def test_internal_roundtrip(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                src = os.path.join(td, "hello.txt")
                Path(src).write_bytes(b"real-internal-" * 1000)
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                res = c.upload_path(src, access="internal", fresh=True)
                self.assertEqual(res["access"], "internal")
                who = c.whoami()
                self.assertEqual(who["user_id"], "u-agent")
                dest = os.path.join(td, "out")
                out = c.fetch_to_dest(res["artifact_id"], dest)
                self.assertEqual(Path(os.path.join(dest, "hello.txt")).read_bytes(),
                                 Path(src).read_bytes())
            finally:
                server.close()

    def test_public_anon_fetch(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                src = os.path.join(td, "pub.txt")
                Path(src).write_bytes(b"public-bytes")
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                res = c.upload_path(src, access="public", fresh=True)
                aid = res["artifact_id"]
                # Anonymous API fetch (public) without token: manifest + bytes.
                anon = ManureClient(base, token=None, cache_dir=os.path.join(td, "c2"))
                man = anon.get_manifest(aid)
                self.assertTrue(any(f["path"] == "pub.txt" for f in man["files"]))
                dest = os.path.join(td, "out")
                anon.fetch_to_dest(aid, dest)
                self.assertEqual(Path(os.path.join(dest, "pub.txt")).read_bytes(),
                                 b"public-bytes")
            finally:
                server.close()

    def test_external_token_free_fetch(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                src = os.path.join(td, "ext.txt")
                Path(src).write_bytes(b"external-secret-bytes")
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                res = c.upload_path(src, access="external", fresh=True)
                pw = res.get("external_password")
                self.assertIsNotNone(pw)
                content_url = res["content_url"]
                # Token-free fetch from content URL with password only.
                # Content hosts are <id>.artifacts.localhost; loopback HTTP needs
                # host resolution to 127.0.0.1. Use Host override via direct IP?
                # The server dispatches by Host header; our client sends Host from
                # URL. Map *.artifacts.localhost to 127.0.0.1 via explicit origin
                # rewrite: replace host with 127.0.0.1 while preserving Host header?
                # StdlibTransport uses URL host for TCP + Host header implicitly.
                # For offline localhost, rely on resolver; if it fails, exercise
                # password flow at the HTTP layer and report as integration note.
                with _LocalhostResolver():
                    anon = ManureClient(base, token=None, cache_dir=os.path.join(td, "c2"))
                    dest = os.path.join(td, "out")
                    out = anon.fetch_to_dest(content_url, dest, password=pw)
                    self.assertEqual(Path(os.path.join(dest, "ext.txt")).read_bytes(), b"external-secret-bytes")
            finally:
                server.close()

    def test_chunk_resume_real_server(self):
        from manure.client import ManureClient, StdlibTransport
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                src = os.path.join(td, "big.bin")
                Path(src).write_bytes(b"R" * 2500000)
                cache = os.path.join(td, "cache")

                class KillOnce:
                    def __init__(self, inner):
                        self.inner = inner
                        self.n = 0

                    def request(self, method, url, headers, body):
                        if method == "PUT":
                            self.n += 1
                            if self.n > 1:
                                raise ConnectionError("killed")
                        return self.inner.request(method, url, headers, body)

                c1 = ManureClient(base, token=token, cache_dir=cache, transport=KillOnce(StdlibTransport()))
                with self.assertRaises(Exception):
                    c1.upload_path(src, access="internal", fresh=True)
                c2 = ManureClient(base, token=token, cache_dir=cache)
                res = c2.upload_path(src, access="internal")
                dest = os.path.join(td, "out")
                c2.fetch_to_dest(res["artifact_id"], dest)
                self.assertEqual(Path(os.path.join(dest, "big.bin")).read_bytes(), b"R" * 2500000)
            finally:
                server.close()

    def test_grant_isolation_real_server(self):
        # Bearer must never go to content hosts; covered at unit level, but
        # smoke-test that API reads need auth for internal artifacts.
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                src = os.path.join(td, "s.txt")
                Path(src).write_bytes(b"s")
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                res = c.upload_path(src, access="internal", fresh=True)
                anon = ManureClient(base, token=None, cache_dir=os.path.join(td, "c2"))
                with self.assertRaises(Exception):
                    anon.get_manifest(res["artifact_id"])
                # Authenticated one-time grant issues for ready internal artifacts.
                grant = c.create_grant(res["artifact_id"])
                self.assertIn("grant", grant)
                self.assertIn("expires_in_s", grant)
                # Consume the grant on the content host (Origin = api_origin),
                # then read bytes with the grant cookie; a forged grant is
                # isolated with grant-invalid and reads nothing.
                import http.client as _hc
                aid = res["artifact_id"]
                content_url = res["content_url"]
                parsed = urllib.parse.urlparse(content_url)
                cog = f"{parsed.scheme}://{parsed.hostname}" \
                    + (f":{parsed.port}" if parsed.port else "")
                with _LocalhostResolver():
                    conn = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    payload = json.dumps({"grant": grant["grant"]}).encode()
                    conn.request("POST", "/__manure/grant", body=payload,
                                 headers={"Content-Type": "application/json",
                                          "Origin": base,
                                          "Content-Length": str(len(payload))})
                    resp = conn.getresponse()
                    self.assertEqual(resp.status, 200, msg=resp.read()[:200])
                    cookie = resp.getheader("Set-Cookie")
                    self.assertIsNotNone(cookie)
                    resp.read()
                    conn.close()
                    # Wrong grant value is isolated.
                    conn2 = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    bad = json.dumps({"grant": "bogus-grant-value"}).encode()
                    conn2.request("POST", "/__manure/grant", body=bad,
                                  headers={"Content-Type": "application/json",
                                           "Origin": base,
                                           "Content-Length": str(len(bad))})
                    resp2 = conn2.getresponse()
                    self.assertEqual(resp2.status, 403)
                    resp2.read()
                    conn2.close()
                    # Redeemed cookie reads the file bytes inline.
                    conn3 = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    conn3.request("GET", "/s.txt", headers={"Cookie": cookie.split(";")[0]})
                    resp3 = conn3.getresponse()
                    self.assertEqual(resp3.status, 200)
                    self.assertEqual(resp3.read(), b"s")
                    conn3.close()
            finally:
                server.close()



    def test_cli_matrix_against_real_service(self):
        """CLI management matrix vs the real service (A2): upload, whoami,
        list, info, fetch-by-id, rotate-password (external), delete."""
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                worktree = str(Path(__file__).resolve().parents[2])
                env = dict(os.environ)
                for k in list(env):
                    if k.startswith("MANURE_"):
                        del env[k]
                env.update({"MANURE_URL": base, "MANURE_TOKEN": token,
                            "MANURE_CACHE_DIR": os.path.join(td, "cache"),
                            "PYTHONPATH": str(Path(__file__).resolve().parents[1])})

                def cli(*args):
                    proc = subprocess.run(
                        [sys.executable, "-m", "manure.cli", *args],
                        capture_output=True, text=True, cwd=worktree, env=env,
                        timeout=60)
                    return proc

                src = os.path.join(td, "site.txt")
                Path(src).write_bytes(b"cli-matrix-bytes")
                up = cli("upload", src, "--access", "external", "--json")
                self.assertEqual(up.returncode, 0, msg=up.stderr)
                up_obj = json.loads(up.stdout)
                aid = up_obj["artifact_id"]
                self.assertIsNotNone(up_obj.get("external_password"))
                self.assertEqual(cli("whoami", "--json").returncode, 0)
                lst = cli("list", "--json")
                self.assertEqual(lst.returncode, 0, msg=lst.stderr)
                self.assertIn(aid, lst.stdout)
                self.assertEqual(cli("info", aid, "--json").returncode, 0)
                self.assertEqual(cli("fetch", aid, os.path.join(td, "d")).returncode, 0)
                self.assertEqual(Path(td, "d", "site.txt").read_bytes(), b"cli-matrix-bytes")
                rot = cli("rotate-password", aid, "--json")
                self.assertEqual(rot.returncode, 0, msg=rot.stderr)
                self.assertIsNotNone(json.loads(rot.stdout).get("external_password"))
                self.assertEqual(cli("delete", aid).returncode, 0)
                gone = cli("info", aid, "--json")
                self.assertNotEqual(gone.returncode, 0)
                # CLI external token-free fetch with the test-only resolver.
                src2 = os.path.join(td, "ext2.txt")
                Path(src2).write_bytes(b"cli-external-bytes")
                up2 = cli("upload", src2, "--access", "external", "--json")
                self.assertEqual(up2.returncode, 0, msg=up2.stderr)
                up2_obj = json.loads(up2.stdout)
                pw2 = up2_obj["external_password"]
                with _LocalhostResolver():
                    import manure.cli as _cli
                    old = dict(os.environ)
                    for k in list(os.environ):
                        if k.startswith("MANURE_"):
                            del os.environ[k]
                    os.environ.update({"MANURE_URL": base,
                                       "MANURE_CACHE_DIR": os.path.join(td, "cache2")})
                    try:
                        # In-process CLI so the patched resolver applies.
                        code = _cli.main(["fetch", up2_obj["content_url"],
                                          os.path.join(td, "d2"),
                                          "--password", pw2])
                    finally:
                        os.environ.clear()
                        os.environ.update(old)
                self.assertEqual(code, 0)
                self.assertEqual(Path(td, "d2", "ext2.txt").read_bytes(), b"cli-external-bytes")
            finally:
                server.close()

    def test_mcp_matrix_against_real_service(self):
        """All MCP tools against the real service (A2, in-process transport)."""
        import unittest.mock as _mock
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                from manure import mcp as _mcp
                from manure import client as _client
                base = server.effective_api_origin
                env = {"MANURE_URL": base, "MANURE_TOKEN": token,
                       "MANURE_CACHE_DIR": os.path.join(td, "mcp-cache")}
                src = os.path.join(td, "mcp.txt")
                Path(src).write_bytes(b"mcp-matrix-bytes")
                dest = os.path.join(td, "mcp-out")
                with _mock.patch.dict(os.environ, env, clear=False):
                    for k in list(os.environ):
                        if k.startswith("MANURE_") and k not in env:
                            del os.environ[k]
                    r = _mcp.handle_tools_call("whoami", {}, _client)
                    self.assertNotIn("isError", r)
                    r = _mcp.handle_tools_call("upload_artifact",
                                               {"local_path": src, "access": "internal"}, _client)
                    self.assertNotIn("isError", r, msg=r)
                    aid = json.loads(r["content"][0]["text"])["artifact_id"]
                    r = _mcp.handle_tools_call("list_artifacts", {"limit": 5}, _client)
                    self.assertNotIn("isError", r)
                    self.assertIn(aid, r["content"][0]["text"])
                    r = _mcp.handle_tools_call("get_artifact", {"artifact_id": aid}, _client)
                    self.assertNotIn("isError", r)
                    r = _mcp.handle_tools_call("get_manifest", {"artifact_id": aid}, _client)
                    self.assertNotIn("isError", r)
                    r = _mcp.handle_tools_call("fetch_artifact",
                                               {"artifact_id": aid, "dest_dir": dest,
                                                "password": None}, _client)
                    self.assertNotIn("isError", r, msg=r)
                    self.assertEqual(Path(dest, "mcp.txt").read_bytes(), b"mcp-matrix-bytes")
                    r = _mcp.handle_tools_call("delete_artifact", {"artifact_id": aid}, _client)
                    self.assertNotIn("isError", r)
                    # Rotate needs an external artifact.
                    src2 = os.path.join(td, "mcp-ext.txt")
                    Path(src2).write_bytes(b"mcp-ext-bytes")
                    r = _mcp.handle_tools_call("upload_artifact",
                                               {"local_path": src2, "access": "external"},
                                               _client)
                    self.assertNotIn("isError", r, msg=r)
                    aid2 = json.loads(r["content"][0]["text"])["artifact_id"]
                    r = _mcp.handle_tools_call("rotate_external_password",
                                               {"artifact_id": aid2}, _client)
                    self.assertNotIn("isError", r, msg=r)
                    self.assertIn("external_password", r["content"][0]["text"])
            finally:
                server.close()



    def test_mcp_stdio_matrix_against_real_service(self):
        """MCP tools over real stdio transport vs the live service (A2)."""
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                worktree = str(Path(__file__).resolve().parents[2])
                proj = str(Path(__file__).resolve().parents[1])
                src = os.path.join(td, "stdio.txt")
                Path(src).write_bytes(b"stdio-matrix-bytes")
                dest = os.path.join(td, "stdio-out")
                env = dict(os.environ)
                for k in list(env):
                    if k.startswith("MANURE_"):
                        del env[k]
                env.update({"MANURE_URL": base, "MANURE_TOKEN": token,
                            "MANURE_CACHE_DIR": os.path.join(td, "mcp-cache"),
                            "PYTHONPATH": proj})
                seq = [
                    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                     "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                                "clientInfo": {"name": "t", "version": "0"}}},
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 2, "method": "ping"},
                    {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
                    {"jsonrpc": "2.0", "id": 4, "method": "tools/call",
                     "params": {"name": "whoami", "arguments": {}}},
                    {"jsonrpc": "2.0", "id": 5, "method": "tools/call",
                     "params": {"name": "upload_artifact",
                                "arguments": {"local_path": src, "access": "internal"}}},
                ]
                payload = "".join(json.dumps(o) + "\n" for o in seq)
                proc = subprocess.run(
                    [sys.executable, "-m", "manure.mcp"], input=payload,
                    capture_output=True, text=True, cwd=worktree, env=env,
                    timeout=60)
                # Stdout purity: every line is a protocol message.
                lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
                self.assertTrue(lines)
                resps = [json.loads(ln) for ln in lines]
                by_id = {r.get("id"): r for r in resps}
                self.assertEqual(by_id[2]["result"], {})
                self.assertEqual(len(by_id[3]["result"]["tools"]), 8)
                self.assertNotIn("isError", by_id[4]["result"])
                self.assertNotIn("isError", by_id[5]["result"],
                                 msg=by_id[5]["result"])
                aid = json.loads(by_id[5]["result"]["content"][0]["text"])["artifact_id"]
                # Second exchange: fetch + delete over the same stdio server.
                seq2 = [
                    {"jsonrpc": "2.0", "id": 11, "method": "initialize",
                     "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                                "clientInfo": {"name": "t", "version": "0"}}},
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 12, "method": "tools/call",
                     "params": {"name": "fetch_artifact",
                                "arguments": {"artifact_id": aid, "dest_dir": dest,
                                              "password": None}}},
                    {"jsonrpc": "2.0", "id": 13, "method": "tools/call",
                     "params": {"name": "delete_artifact",
                                "arguments": {"artifact_id": aid}}},
                ]
                payload2 = "".join(json.dumps(o) + "\n" for o in seq2)
                proc2 = subprocess.run(
                    [sys.executable, "-m", "manure.mcp"], input=payload2,
                    capture_output=True, text=True, cwd=worktree, env=env,
                    timeout=60)
                resps2 = [json.loads(ln) for ln in proc2.stdout.splitlines() if ln.strip()]
                by_id2 = {r.get("id"): r for r in resps2}
                self.assertNotIn("isError", by_id2[12]["result"], msg=by_id2[12])
                self.assertNotIn("isError", by_id2[13]["result"])
                self.assertEqual(Path(dest, "stdio.txt").read_bytes(), b"stdio-matrix-bytes")
            finally:
                server.close()

    def test_cross_artifact_cookie_isolation_real_server(self):
        """A2: grant cookie for A must not read B (401), same-artifact 200."""
        from manure.client import ManureClient
        import http.client as _hc
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                aids = {}
                curls = {}
                for name, content in (("a.txt", b"AAA"), ("b.txt", b"BBB")):
                    p = os.path.join(td, name)
                    Path(p).write_bytes(content)
                    r = c.upload_path(p, access="internal", fresh=True)
                    aids[name] = r["artifact_id"]
                    curls[name] = r["content_url"]
                gA = c.create_grant(aids["a.txt"])
                parsedA = urllib.parse.urlparse(curls["a.txt"])
                parsedB = urllib.parse.urlparse(curls["b.txt"])
                with _LocalhostResolver():
                    conn = _hc.HTTPConnection(parsedA.hostname, parsedA.port, timeout=30)
                    payload = json.dumps({"grant": gA["grant"]}).encode()
                    conn.request("POST", "/__manure/grant", body=payload,
                                 headers={"Content-Type": "application/json",
                                          "Origin": base,
                                          "Content-Length": str(len(payload))})
                    resp = conn.getresponse()
                    self.assertEqual(resp.status, 200)
                    cookieA = resp.getheader("Set-Cookie")
                    self.assertIsNotNone(cookieA)
                    resp.read()
                    conn.close()
                    # Cross-artifact: cookieA on B host is isolated (401).
                    conn2 = _hc.HTTPConnection(parsedB.hostname, parsedB.port, timeout=30)
                    conn2.request("GET", "/b.txt",
                                    headers={"Cookie": cookieA.split(";")[0]})
                    resp2 = conn2.getresponse()
                    self.assertEqual(resp2.status, 401)
                    resp2.read()
                    conn2.close()
                    # Same-artifact still 200 with exact bytes.
                    conn3 = _hc.HTTPConnection(parsedA.hostname, parsedA.port, timeout=30)
                    conn3.request("GET", "/a.txt",
                                    headers={"Cookie": cookieA.split(";")[0]})
                    resp3 = conn3.getresponse()
                    self.assertEqual(resp3.status, 200)
                    self.assertEqual(resp3.read(), b"AAA")
                    conn3.close()
            finally:
                server.close()

    def test_grant_revocation_real_server(self):
        """A2: rotate revokes old external cookie/password; artifact lives on.

        Discriminating: 404-after-delete alone proves removal, not revocation.
        Here the artifact remains accessible with the new password while the
        old cookie and old password both fail. Plus single-use internal
        grants (403 on reuse) with the artifact still present."""
        from manure.client import ManureClient
        import http.client as _hc
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                # External artifact for password/cookie rotation.
                src = os.path.join(td, "e.txt")
                Path(src).write_bytes(b"EXTDATA")
                r = c.upload_path(src, access="external", fresh=True)
                aid = r["artifact_id"]
                curl = r["content_url"]
                old_pw = r["external_password"]
                self.assertIsNotNone(old_pw)
                parsed = urllib.parse.urlparse(curl)
                cog = f"{parsed.scheme}://{parsed.hostname}" \
                    + (f":{parsed.port}" if parsed.port else "")
                with _LocalhostResolver():
                    conn = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    payload = json.dumps({"password": old_pw}).encode()
                    conn.request("POST", "/__manure/unlock", body=payload,
                                 headers={"Content-Type": "application/json",
                                          "Origin": cog,
                                          "Content-Length": str(len(payload))})
                    resp = conn.getresponse()
                    self.assertEqual(resp.status, 200)
                    old_cookie = resp.getheader("Set-Cookie")
                    self.assertIsNotNone(old_cookie)
                    resp.read()
                    conn.close()
                    # Old cookie reads before rotate.
                    conn0 = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    conn0.request("GET", "/e.txt",
                                    headers={"Cookie": old_cookie.split(";")[0]})
                    resp0 = conn0.getresponse()
                    self.assertEqual(resp0.status, 200)
                    self.assertEqual(resp0.read(), b"EXTDATA")
                    conn0.close()
                # Rotate via the client; artifact must survive.
                rot = c.rotate_password(aid)
                new_pw = rot.get("external_password")
                self.assertIsNotNone(new_pw)
                self.assertNotEqual(new_pw, old_pw)
                info = c.get_artifact(aid)
                self.assertEqual(info["artifact_id"], aid)
                with _LocalhostResolver():
                    # Old cookie revoked (artifact still exists).
                    conn1 = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    conn1.request("GET", "/e.txt",
                                    headers={"Cookie": old_cookie.split(";")[0]})
                    resp1 = conn1.getresponse()
                    self.assertIn(resp1.status, (401, 403, 404))
                    resp1.read()
                    conn1.close()
                    # Old password revoked.
                    conn2 = _hc.HTTPConnection(parsed.hostname, parsed.port, timeout=30)
                    payload_old = json.dumps({"password": old_pw}).encode()
                    conn2.request("POST", "/__manure/unlock", body=payload_old,
                                  headers={"Content-Type": "application/json",
                                           "Origin": cog,
                                           "Content-Length": str(len(payload_old))})
                    resp2 = conn2.getresponse()
                    self.assertEqual(resp2.status, 401)
                    resp2.read()
                    conn2.close()
                # New password still serves (artifact accessible).
                c2 = ManureClient(base, token=None, cache_dir=os.path.join(td, "c2"))
                with _LocalhostResolver():
                    dest2 = os.path.join(td, "out2")
                    c2.fetch_to_dest(curl, dest2, password=new_pw)
                    self.assertEqual(Path(dest2, "e.txt").read_bytes(), b"EXTDATA")
                # Internal one-time grants: reuse fails while artifact lives.
                src_i = os.path.join(td, "r.txt")
                Path(src_i).write_bytes(b"REVOKE-ME")
                ri = c.upload_path(src_i, access="internal", fresh=True)
                aid_i = ri["artifact_id"]
                curli = ri["content_url"]
                parsedi = urllib.parse.urlparse(curli)
                gi = c.create_grant(aid_i)
                with _LocalhostResolver():
                    conn3 = _hc.HTTPConnection(parsedi.hostname, parsedi.port, timeout=30)
                    payi = json.dumps({"grant": gi["grant"]}).encode()
                    conn3.request("POST", "/__manure/grant", body=payi,
                                  headers={"Content-Type": "application/json",
                                           "Origin": base,
                                           "Content-Length": str(len(payi))})
                    resp3 = conn3.getresponse()
                    self.assertEqual(resp3.status, 200)
                    resp3.read()
                    conn3.close()
                    conn4 = _hc.HTTPConnection(parsedi.hostname, parsedi.port, timeout=30)
                    conn4.request("POST", "/__manure/grant", body=payi,
                                  headers={"Content-Type": "application/json",
                                           "Origin": base,
                                           "Content-Length": str(len(payi))})
                    resp4 = conn4.getresponse()
                    self.assertEqual(resp4.status, 403)
                    resp4.read()
                    conn4.close()
                # Artifact still present after single-use exhaustion.
                info_i = c.get_artifact(aid_i)
                self.assertEqual(info_i["artifact_id"], aid_i)
            finally:
                server.close()

    def test_pagination_filters_real_server(self):
        """A2: limit/cursor exhausts; state/include_expired discriminate.

        Fixtures: 1 uploading (init-only), 2 ready live, 1 ready expired
        (deterministic past expires_at_s via test-only store, unswept).
        Ignoring state or include_expired must fail."""
        from manure.client import ManureClient
        import time as _time
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                # Uploading fixture (init without publish).
                import hashlib as _hl
                uh = _hl.sha256(b"abc").hexdigest()
                up = c.init_upload("up", "file", "internal",
                                    [{"path": "u.txt", "kind": "file",
                                      "size": 3, "sha256": uh}])
                aid_up = up["artifact_id"]
                # Ready live fixtures.
                aids_live: dict[str, str] = {}
                for vis, name in (("internal", "i.txt"), ("public", "p.txt")):
                    p = os.path.join(td, name)
                    Path(p).write_bytes(b"x-" + vis.encode())
                    r = c.upload_path(p, access=vis, fresh=True)
                    aids_live[vis] = r["artifact_id"]
                # Ready expired fixture (deterministic past, no sweep).
                p_exp = os.path.join(td, "x.txt")
                Path(p_exp).write_bytes(b"expired-bytes")
                r_exp = c.upload_path(p_exp, access="internal", fresh=True)
                aid_exp = r_exp["artifact_id"]
                past = int(_time.time()) - 100
                store = getattr(server, "_store", None)
                self.assertIsNotNone(store)
                assert store is not None
                db = getattr(store, "_db", None)
                self.assertIsNotNone(db)
                db.execute("UPDATE artifacts SET expires_at_s=? WHERE id=?",
                           (float(past), aid_exp))
                # Paginate live (exclude expired) limit=1 until exhausted.
                seen: list[str] = []
                cursor: str | None = None
                for _ in range(10):
                    page = c.list_artifacts(limit=1, cursor=cursor) if cursor \
                        else c.list_artifacts(limit=1)
                    self.assertLessEqual(len(page["artifacts"]), 1)
                    for a in page["artifacts"]:
                        seen.append(a["artifact_id"])
                    cursor = page.get("next_cursor")
                    if not cursor:
                        break
                self.assertEqual(sorted(seen),
                                 sorted([aid_up] + list(aids_live.values())))
                # State discriminates: uploading vs ready-live vs ready-expired.
                only_up = c.list_artifacts(state="uploading")
                self.assertEqual([a["artifact_id"] for a in only_up["artifacts"]],
                                 [aid_up])
                ready_default = c.list_artifacts(state="ready")
                self.assertEqual(sorted(a["artifact_id"] for a in ready_default["artifacts"]),
                                 sorted(aids_live.values()))
                ready_inc = c.list_artifacts(state="ready", include_expired=True)
                self.assertEqual(sorted(a["artifact_id"] for a in ready_inc["artifacts"]),
                                 sorted(list(aids_live.values()) + [aid_exp]))
                # include_expired exclusion/inclusion over all states.
                default_all = c.list_artifacts(limit=50)
                self.assertEqual(sorted(a["artifact_id"] for a in default_all["artifacts"]),
                                 sorted([aid_up] + list(aids_live.values())))
                inc_all = c.list_artifacts(limit=50, include_expired=True)
                self.assertEqual(sorted(a["artifact_id"] for a in inc_all["artifacts"]),
                                 sorted([aid_up] + list(aids_live.values()) + [aid_exp]))
                # Visibility still isolates among live (expired internal hidden by default).
                only_int = c.list_artifacts(visibility="internal")
                self.assertEqual(sorted(a["artifact_id"] for a in only_int["artifacts"]),
                                 sorted([aid_up, aids_live["internal"]]))
            finally:
                server.close()

    def test_ttl_updates_real_server(self):
        """A2: PATCH TTL ordering + GET persistence; bounds hold.

        Discriminating: assert shortening decreases, extension increases
        (not merely non-null), and every PATCH persists through a fresh GET."""
        from manure.client import ManureClient
        import datetime as _dt

        def _parse(exp: str | None) -> float | None:
            if exp is None:
                return None
            return _dt.datetime.fromisoformat(exp.replace("Z", "+00:00")).timestamp()

        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                c = ManureClient(base, token=token, cache_dir=os.path.join(td, "c"))
                src = os.path.join(td, "t.txt")
                Path(src).write_bytes(b"ttl-bytes")
                r = c.upload_path(src, access="internal", fresh=True)
                aid = r["artifact_id"]
                self.assertIsNone(c.get_artifact(aid).get("expires_at"))
                p1 = c.patch_artifact(aid, expires_in_s=3600)
                t1 = _parse(p1.get("expires_at"))
                self.assertIsNotNone(t1)
                assert t1 is not None
                self.assertEqual(_parse(c.get_artifact(aid).get("expires_at")), t1)
                p2 = c.patch_artifact(aid, expires_in_s=1800)
                t2 = _parse(p2.get("expires_at"))
                self.assertIsNotNone(t2)
                assert t2 is not None
                self.assertLess(t2, t1)
                self.assertEqual(_parse(c.get_artifact(aid).get("expires_at")), t2)
                p3 = c.patch_artifact(aid, expires_in_s=7200)
                t3 = _parse(p3.get("expires_at"))
                self.assertIsNotNone(t3)
                assert t3 is not None
                self.assertGreater(t3, t2)
                self.assertEqual(_parse(c.get_artifact(aid).get("expires_at")), t3)
                p4 = c.patch_artifact(aid, expires_in_s=None)
                self.assertIsNone(p4.get("expires_at"))
                self.assertIsNone(c.get_artifact(aid).get("expires_at"))
                with self.assertRaises(Exception) as ctx:
                    c.patch_artifact(aid, expires_in_s=10)
                self.assertIn(getattr(ctx.exception, "code", ""), ("invalid-ttl", "bad-envelope"))
                self.assertIsNone(c.get_artifact(aid).get("expires_at"))
            finally:
                server.close()

    def test_mcp_stdio_management_calls_against_real_service(self):
        """A2: remaining stdio management calls (list/get/manifest/rotate)."""
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                worktree = str(Path(__file__).resolve().parents[2])
                proj = str(Path(__file__).resolve().parents[1])
                src = os.path.join(td, "mgmt.txt")
                Path(src).write_bytes(b"mgmt-bytes")
                src_ext = os.path.join(td, "mgmt-ext.txt")
                Path(src_ext).write_bytes(b"mgmt-ext-bytes")
                env = dict(os.environ)
                for k in list(env):
                    if k.startswith("MANURE_"):
                        del env[k]
                env.update({"MANURE_URL": base, "MANURE_TOKEN": token,
                            "MANURE_CACHE_DIR": os.path.join(td, "mcp-cache"),
                            "PYTHONPATH": proj})
                # Seed two artifacts via in-process upload (internal + external)
                # so stdio can exercise list/get/manifest/rotate without nesting.
                from manure import client as _client
                from manure import mcp as _mcp
                import unittest.mock as _mock
                with _mock.patch.dict(os.environ,
                                       {"MANURE_URL": base, "MANURE_TOKEN": token,
                                        "MANURE_CACHE_DIR": os.path.join(td, "mcp-cache")}):
                    r1 = _mcp.handle_tools_call("upload_artifact",
                                                {"local_path": src, "access": "internal"}, _client)
                    self.assertNotIn("isError", r1, msg=r1)
                    aid = json.loads(r1["content"][0]["text"])["artifact_id"]
                    r2 = _mcp.handle_tools_call("upload_artifact",
                                                {"local_path": src_ext, "access": "external"}, _client)
                    self.assertNotIn("isError", r2, msg=r2)
                    aid_ext = json.loads(r2["content"][0]["text"])["artifact_id"]
                seq = [
                    {"jsonrpc": "2.0", "id": 21, "method": "initialize",
                     "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                                "clientInfo": {"name": "t", "version": "0"}}},
                    {"jsonrpc": "2.0", "method": "notifications/initialized"},
                    {"jsonrpc": "2.0", "id": 22, "method": "tools/call",
                     "params": {"name": "list_artifacts", "arguments": {"limit": 5}}},
                    {"jsonrpc": "2.0", "id": 23, "method": "tools/call",
                     "params": {"name": "get_artifact", "arguments": {"artifact_id": aid}}},
                    {"jsonrpc": "2.0", "id": 24, "method": "tools/call",
                     "params": {"name": "get_manifest", "arguments": {"artifact_id": aid}}},
                    {"jsonrpc": "2.0", "id": 25, "method": "tools/call",
                     "params": {"name": "rotate_external_password",
                                "arguments": {"artifact_id": aid_ext}}},
                    {"jsonrpc": "2.0", "id": 26, "method": "tools/call",
                     "params": {"name": "get_artifact",
                                "arguments": {"artifact_id": "0" * 32}}},
                ]
                payload = "".join(json.dumps(o) + "\n" for o in seq)
                proc = subprocess.run(
                    [sys.executable, "-m", "manure.mcp"], input=payload,
                    capture_output=True, text=True, cwd=worktree, env=env,
                    timeout=60)
                lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
                self.assertTrue(lines)
                resps = [json.loads(ln) for ln in lines]
                by_id = {r.get("id"): r for r in resps}
                self.assertNotIn("isError", by_id[22]["result"], msg=by_id[22])
                self.assertIn(aid, by_id[22]["result"]["content"][0]["text"])
                self.assertNotIn("isError", by_id[23]["result"], msg=by_id[23])
                self.assertNotIn("isError", by_id[24]["result"], msg=by_id[24])
                self.assertNotIn("isError", by_id[25]["result"], msg=by_id[25])
                self.assertIn("external_password", by_id[25]["result"]["content"][0]["text"])
                # Unknown artifact is a domain isError (not a protocol error).
                self.assertIn("isError", by_id[26]["result"])
            finally:
                server.close()

    def test_official_sdk_lifecycle_against_real_service(self):
        """A4: official SDK (mandatory) vs live service + real Python stdio.

        Release provision: the official @modelcontextprotocol/sdk client must
        drive the controller lifecycle (initialize/initialized/ping) and both
        a successful tools/call (whoami 200) and a domain isError
        (get_artifact 404). No private /srv fallbacks; no successful skips:
        missing node/SDK fails (FakeHTTP in test_mcp_protocol remains
        complementary unit coverage only). Mirrors
        debug/20261009-0035-manure-real-sdk-probe.py (SDK 1.32.1 verified)."""
        import pathlib as _pl
        import shutil as _shutil
        import subprocess as _sp
        import sys as _sys
        with tempfile.TemporaryDirectory() as td:
            server, token = _make_server(td)
            try:
                base = server.effective_api_origin
                # Mandatory discovery: explicit env, then repo-local driver.
                # Never hardcode private /srv fallbacks; absent ⇒ FAIL.
                candidates: list[str] = []
                env_sdk = os.environ.get("MANURE_MCP_SDK_PATH")
                if env_sdk:
                    candidates.append(env_sdk)
                here0 = _pl.Path(__file__).resolve()
                worktree0 = here0.parents[2]
                candidates.append(str(worktree0 / "haystack" / "node_modules"
                                      / "@modelcontextprotocol" / "sdk"))
                sdk_dir: str | None = None
                for cand in candidates:
                    try:
                        ap = str(_pl.Path(cand).resolve())
                    except OSError:
                        continue
                    if os.path.isdir(ap):
                        # Verify it is the official SDK (name check, no version pin).
                        try:
                            meta = json.loads(_pl.Path(ap, "package.json").read_text())
                        except OSError:
                            continue
                        if meta.get("name") == "@modelcontextprotocol/sdk":
                            sdk_dir = ap
                            break
                self.assertIsNotNone(sdk_dir,
                    msg="A4 FAIL — official MCP SDK absent (set MANURE_MCP_SDK_PATH; "
                          "no /srv fallback, no skip in required checks)")
                assert sdk_dir is not None
                node_bin = _shutil.which("node")
                self.assertIsNotNone(node_bin,
                    msg="A4 FAIL — node absent (official SDK lifecycle requires node; no skip)")
                # Real Python stdio server (installed worktree package, not fake).
                proj = str(_pl.Path(__file__).resolve().parents[1])
                cache = os.path.join(td, "sdk-cache")
                os.makedirs(cache, exist_ok=True)
                node_src = """
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const p = JSON.parse(fs.readFileSync(0, 'utf8'));
const { Client } = await import(pathToFileURL(p.sdk + '/dist/esm/client/index.js'));
const { StdioClientTransport } = await import(pathToFileURL(p.sdk + '/dist/esm/client/stdio.js'));
const transport = new StdioClientTransport({ command: p.python, args: ['-m', 'manure.mcp'],
  cwd: p.cwd, env: { ...process.env, PYTHONPATH: p.modules,
    MANURE_URL: p.origin, MANURE_TOKEN: p.token, MANURE_CACHE_DIR: p.cache } });
const client = new Client({ name: 'manure-real-service-probe', version: '1' }, { capabilities: {} });
try {
  await client.connect(transport);
  await client.ping();
  const tools = await client.listTools();
  const good = await client.callTool({ name: 'whoami', arguments: {} });
  const bad = await client.callTool({ name: 'get_artifact', arguments: { artifact_id: '0'.repeat(32) } });
  if (tools.tools.length !== 8 || good.isError || !bad.isError)
    throw new Error('official SDK lifecycle/tools/call invariant failed');
  const identity = JSON.parse(good.content.find(c => c.type === 'text').text);
  if (!identity.user_id)
    throw new Error('authenticated identity missing user_id');
  console.log(JSON.stringify({ toolCount: tools.tools.length,
    successfulToolsCall: !good.isError, domainErrorToolsCall: !!bad.isError,
    userId: identity.user_id }));
} finally {
  await client.close();
}
"""
                payload = {
                    "sdk": sdk_dir,
                    "python": _sys.executable,
                    "cwd": str(worktree0),
                    "modules": proj,
                    "origin": base,
                    "token": token,
                    "cache": cache,
                }
                proc = _sp.run([node_bin, "--input-type=module", "-e", node_src],
                               input=json.dumps(payload), text=True, capture_output=True,
                               timeout=60)
                self.assertEqual(proc.returncode, 0,
                    msg=f"A4 FAIL — official SDK lifecycle failed: {proc.stderr[:2000]}")
                obj = json.loads(proc.stdout.strip().splitlines()[-1])
                self.assertEqual(obj["toolCount"], 8)
                self.assertTrue(obj["successfulToolsCall"])
                self.assertTrue(obj["domainErrorToolsCall"])
            finally:
                server.close()


if __name__ == "__main__":
    unittest.main()
