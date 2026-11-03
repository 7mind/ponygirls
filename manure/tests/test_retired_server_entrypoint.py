"""Regression: the portable Python package must never activate SQLite HTTP.

Real scrubbed child entrypoints + real owned filesystem/audit boundary. The
probe prevents forbidden effects rather than starting a legacy service to test
its retirement. Historical import helpers remain unsupported test/oracle seams.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path


class RetiredServerEntrypointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="manure-retired-entry-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.project = Path(__file__).resolve().parents[1]
        self.scripts = tomllib.loads((self.project / "pyproject.toml").read_text())[
            "project"
        ]["scripts"]
        self.config = self.root / "invalid-owned-config.json"
        self.config.write_bytes(
            b"not JSON; this file must never be opened by the entrypoint"
        )
        self.missing = self.root / "nonexistent-owned-config.json"
        self.credential = self.root / "owned-credential"
        self.credential.write_bytes(b"owned synthetic unread credential canary")
        self.guard = self.root / "guard"
        self.guard.mkdir()
        (self.guard / "sitecustomize.py").write_text("""import json, os, sys
forbidden = set(json.loads(os.environ["RETIREMENT_GUARD_FILES"]))
def deny(event, args):
    rejected = event in {"socket.__new__", "socket.bind", "socket.connect", "sqlite3.connect",
        "os.mkdir", "os.remove", "os.rmdir", "os.rename", "os.link", "os.symlink",
        "os.system", "os.exec", "os.fork", "os.posix_spawn", "subprocess.Popen"}
    if event == "open":
        path, mode, flags = args
        rejected = path in forbidden or (isinstance(mode, str) and any(c in mode for c in "wax+"))
        rejected = rejected or bool(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND))
    if rejected:
        os.write(2, b"RETIREMENT_FORBIDDEN_EFFECT\\n")
        raise RuntimeError("retirement boundary blocked an effect")
sys.addaudithook(deny)
os.write(2, b"RETIREMENT_GUARD_READY\\n")
""")

    def environment(self, **extra):
        # No ambient MANURE_*, HOME, PYTHONPATH, proxy, credentials or service
        # settings. Every supplied reference belongs to this disposable test.
        return {
            "PATH": str(Path(sys.executable).parent),
            "HOME": str(self.root),
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PYTHONPATH": os.pathsep.join((str(self.guard), str(self.project))),
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "RETIREMENT_GUARD_FILES": json.dumps(
                [str(self.config), str(self.missing), str(self.credential)]
            ),
            **extra,
        }

    def child(self, module, arguments=(), *, payload="", **environment):
        result = subprocess.run(
            [sys.executable, "-m", module, *arguments],
            input=payload,
            cwd=self.root,
            env=self.environment(**environment),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        self.assertIn("RETIREMENT_GUARD_READY", result.stderr)
        return result

    def inventory(self):
        return {
            str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in self.root.rglob("*")
            if p.is_file()
        }

    def test_python_server_console_script_is_not_registered(self):
        self.assertNotIn("manure-server", self.scripts)
        self.assertNotIn("manure.server:main", self.scripts.values())

    def test_public_module_refuses_before_parser_config_credentials_database_or_network(
        self,
    ):
        before = self.inventory()
        probes = [
            (("--config", str(self.config)), {}),
            (("--config", str(self.missing)), {}),
            ((), {"MANURE_CONFIG": str(self.config)}),
            ((), {"MANURE_CONFIG": str(self.missing)}),
            (("--help",), {}),
            (("--unknown", "owned-argument-canary"), {}),
            ((), {}),
        ]
        for arguments, environment in probes:
            with self.subTest(arguments=arguments, environment=environment):
                result = self.child("manure.server", arguments, **environment)
                self.assertNotIn("RETIREMENT_FORBIDDEN_EFFECT", result.stderr)
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertIn("manure.server is retired", result.stderr)
                self.assertIn("built Scala manure-server binary", result.stderr)
                self.assertIn("no Python proxy", result.stderr)
                self.assertNotIn("Traceback", result.stderr)
                self.assertNotIn("owned-argument-canary", result.stderr)
                self.assertNotIn(str(self.config), result.stderr)
                self.assertEqual(self.inventory(), before)
        self.assertEqual(self.inventory(), before)
        self.assertFalse((self.root / "manure.db").exists())
        self.assertFalse((self.root / "staging").exists())
        self.assertFalse((self.root / "live").exists())

    def test_portable_cli_registration_and_help_remain_usable(self):
        self.assertEqual(self.scripts.get("manure"), "manure.cli:main")
        before = self.inventory()
        result = self.child("manure.cli", ("--help",))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("upload", result.stdout)
        self.assertIn("fetch", result.stdout)
        self.assertNotIn("RETIREMENT_FORBIDDEN_EFFECT", result.stderr)
        self.assertEqual(self.inventory(), before)

    def test_portable_mcp_registration_and_real_stdio_remain_usable(self):
        self.assertEqual(self.scripts.get("manure-mcp"), "manure.mcp:main")
        requests = [
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-11-25",
                    "capabilities": {},
                    "clientInfo": {"name": "owned-retirement-test", "version": "1"},
                },
            },
            {"jsonrpc": "2.0", "method": "notifications/initialized"},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
            {"jsonrpc": "2.0", "id": 3, "method": "ping", "params": {}},
        ]
        before = self.inventory()
        result = self.child(
            "manure.mcp", payload="".join(json.dumps(r) + "\n" for r in requests)
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("RETIREMENT_FORBIDDEN_EFFECT", result.stderr)
        responses = {r["id"]: r for r in map(json.loads, result.stdout.splitlines())}
        self.assertEqual(set(responses), {1, 2, 3})
        self.assertEqual(responses[1]["result"]["protocolVersion"], "2025-11-25")
        self.assertEqual(len(responses[2]["result"]["tools"]), 8)
        self.assertEqual(responses[3]["result"], {})
        self.assertEqual(self.inventory(), before)

    def test_unsupported_historical_helpers_remain_importable_without_effects(self):
        before = self.inventory()
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                (
                    "from manure.server import ServerConfig, create_server; "
                    "from manure.storage import ArtifactStore; "
                    "assert callable(create_server) and callable(ArtifactStore) and callable(ServerConfig)"
                ),
            ],
            cwd=self.root,
            env=self.environment(),
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "")
        self.assertIn("RETIREMENT_GUARD_READY", result.stderr)
        self.assertNotIn("RETIREMENT_FORBIDDEN_EFFECT", result.stderr)
        self.assertEqual(self.inventory(), before)


if __name__ == "__main__":
    unittest.main()
