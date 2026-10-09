"""MCP hardening: malformed lifecycle, constraints, continued operation (B6)."""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


def _run_seq(seq: list, env_extra: dict | None = None):
    here = pathlib.Path(__file__).resolve()
    proj = here.parents[1]
    worktree = here.parents[2]
    env = dict(os.environ)
    for k in list(env):
        if k.startswith("MANURE_"):
            del env[k]
    from manure.auth import generate_token as _gen_token  # canonical vectors (governor A1)
    _MCP_TOKEN = _gen_token()
    env.update({"MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": _MCP_TOKEN})
    if env_extra:
        env.update(env_extra)
    env["PYTHONPATH"] = str(proj) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    payload = "".join((json.dumps(o) if isinstance(o, dict) else o) + "\n" for o in seq)
    proc = subprocess.run([sys.executable, "-m", "manure.mcp"], input=payload,
                          capture_output=True, text=True, cwd=str(worktree), env=env, timeout=20)
    resps = [json.loads(l) for l in proc.stdout.splitlines() if l.strip()]
    return resps, proc.stderr, proc.returncode


class TestMcpHardening(unittest.TestCase):
    def test_initialize_list_version_crashes_then_recovers(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": [], "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        # list-version must be protocol error, not crash; second initialize works.
        self.assertEqual(by_id[1]["error"]["code"], -32602)
        self.assertEqual(by_id[2]["result"]["protocolVersion"], "2025-11-25")
        self.assertEqual(by_id[3]["result"], {})

    def test_missing_initialize_fields_rejected(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"capabilities": {}}},
            {"jsonrpc": "2.0", "id": 2, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 4, "method": "ping"},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[1]["error"]["code"], -32602)
        self.assertEqual(by_id[2]["error"]["code"], -32602)
        self.assertIn("result", by_id[3])
        self.assertIn("result", by_id[4])

    def test_invalid_method_id_types_and_idless(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": ["bad"], "method": "ping"},
            {"jsonrpc": "2.0", "id": 2, "method": 123},
            {"jsonrpc": "2.0", "method": "ping"},
            {"jsonrpc": "2.0", "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 3, "method": "ping"},
        ]
        resps, _, _ = _run_seq(seq)
        # id-less ping/tools/list must produce NO response; only ids 1,3 + 2 errors.
        ids = sorted(r.get("id") if isinstance(r.get("id"), int) else 999 for r in resps)
        # Responses: id=1 (init), invalid-id error (null), invalid-method error (2), id=3.
        self.assertEqual(len(resps), 4)
        by_id = {r.get("id"): r for r in resps}
        self.assertIn(1, by_id)
        self.assertIn(2, by_id)
        self.assertIn(3, by_id)
        self.assertEqual(by_id[2]["error"]["code"], -32600)

    def test_initialized_before_initialize_ignored(self):
        seq = [
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            {"jsonrpc": "2.0", "id": 2, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[1]["error"]["code"], -32002)
        self.assertIn("tools", by_id[3]["result"])

    def test_limit_minimum_enforced(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "list_artifacts", "arguments": {"limit": 0}}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
             "params": {"name": "list_artifacts", "arguments": {"limit": 5}}},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[2]["error"]["code"], -32602)
        # limit=5 reaches the tool (isError or result, but not invalid-params).
        self.assertIn("result", by_id[3])


if __name__ == "__main__":
    unittest.main()

class TestMcpOfficialSchemas(unittest.TestCase):
    def test_initialize_clientinfo_members(self):
        base = {"protocolVersion": "2025-11-25", "capabilities": {}}
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {**base}},
            {"jsonrpc": "2.0", "id": 2, "method": "initialize",
             "params": {**base, "clientInfo": {"name": "t"}}},
            {"jsonrpc": "2.0", "id": 3, "method": "initialize",
             "params": {**base, "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 4, "method": "ping"},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[1]["error"]["code"], -32602)
        self.assertEqual(by_id[2]["error"]["code"], -32602)
        self.assertIn("result", by_id[3])
        self.assertIn("result", by_id[4])

    def test_initialized_with_id_or_params_no_advance(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "id": 99, "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
            {"jsonrpc": "2.0", "method": "notifications/initialized",
             "params": {"bogus": 1}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list"},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/list"},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[2]["error"]["code"], -32002)
        self.assertEqual(by_id[3]["error"]["code"], -32002)
        self.assertIn("tools", by_id[4]["result"])

    def test_list_meta_accepted_ping_params_rejected(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list",
             "params": {"_meta": {"x": 1}}},
            {"jsonrpc": "2.0", "id": 3, "method": "tools/list",
             "params": {"limit": 1}},
            {"jsonrpc": "2.0", "id": 4, "method": "ping",
             "params": {"bogus": 1}},
            {"jsonrpc": "2.0", "id": 5, "method": "ping"},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertIn("tools", by_id[2]["result"])
        self.assertEqual(by_id[3]["error"]["code"], -32602)
        self.assertEqual(by_id[4]["error"]["code"], -32602)
        self.assertEqual(by_id[5]["result"], {})

class TestMcpNullAndCapabilities(unittest.TestCase):
    def test_null_id_and_null_params_rejected(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": None, "method": "ping"},
            {"jsonrpc": "2.0", "id": 2, "method": "ping", "params": None},
            {"jsonrpc": "2.0", "id": 3, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "t", "version": "0"}}},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {}
        null_errs = 0
        for r in resps:
            if r.get("id") is None and "error" in r:
                null_errs += 1
            elif r.get("id") in (2, 3):
                by_id[r["id"]] = r
        self.assertGreaterEqual(null_errs, 1)
        self.assertEqual(by_id[2]["error"]["code"], -32602)
        self.assertIn("result", by_id[3])

    def test_capabilities_members_typed(self):
        good = {"protocolVersion": "2025-11-25",
                "capabilities": {"roots": {"listChanged": True}},
                "clientInfo": {"name": "t", "version": "0"}}
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25",
                        "capabilities": {"roots": True},
                        "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "id": 2, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25",
                        "capabilities": {"roots": {"listChanged": "yes"}},
                        "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "id": 3, "method": "initialize", "params": good},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 4, "method": "tools/list",
             "params": {"cursor": "abc"}},
            {"jsonrpc": "2.0", "id": 5, "method": "tools/list",
             "params": {"cursor": 5}},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        self.assertEqual(by_id[1]["error"]["code"], -32602)
        self.assertEqual(by_id[2]["error"]["code"], -32602)
        self.assertIn("result", by_id[3])
        self.assertIn("tools", by_id[4]["result"])
        self.assertEqual(by_id[5]["error"]["code"], -32602)

    def test_nullable_tool_args_accepted(self):
        seq = [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": "2025-11-25", "capabilities": {},
                        "clientInfo": {"name": "t", "version": "0"}}},
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "fetch_artifact",
                        "arguments": {"artifact_id": "0" * 32, "dest_dir": "/tmp/x",
                                      "password": None}}},
        ]
        resps, _, _ = _run_seq(seq)
        by_id = {r.get("id"): r for r in resps}
        # Null password is schema-valid: result envelope (isError domain fault),
        # never -32602 invalid-params, and zero network is not required here
        # (domain fault proves validation passed).
        self.assertIn("result", by_id[2])
        self.assertTrue(by_id[2]["result"].get("isError"))
