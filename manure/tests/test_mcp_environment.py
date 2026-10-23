"""Behavioral regression coverage for credential-isolated MCP fixtures (#26)."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import unittest


class TestMcpFixtureEnvironment(unittest.TestCase):
    def test_fixtures_ignore_ambient_client_configuration(self):
        project = Path(__file__).resolve().parents[1]
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("MANURE_")}
        env.update({
            "PYTHONPATH": os.pathsep.join((str(project), str(project / "tests"))),
            "MANURE_TOKEN_FILE": "/nonexistent/example-test-token-file",
            "MANURE_URL_FILE": "/nonexistent/example-test-url-file",
            "MANURE_ALLOW_INSECURE_HTTP": "invalid-fixture-setting",
        })
        result = subprocess.run([
            sys.executable, "-m", "unittest", "-v",
            "test_mcp_protocol.TestMcpProtocol.test_tools_call_domain_fault_iserror",
            "test_mcp_protocol.TestMcpProtocol.test_tools_call_whoami_inprocess",
            "test_client_realserver.TestRealServer.test_mcp_stdio_management_calls_against_real_service",
        ], env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
