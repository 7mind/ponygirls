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
        # Target-provider settings belong to the owned fixture, not to MCP
        # client credential resolution. Preserve only that exact allowlist so
        # this nested real-target case cannot fall back to a Python server.
        provider={"MANURE_TEST_SERVER_COMMAND_JSON","MANURE_TEST_ALLOW_CREATEDB",
                  "MANURE_TEST_JDBC_URL","MANURE_TEST_JDBC_USER",
                  "MANURE_TEST_JDBC_PASSWORD_FILE","MANURE_POSIX_LIBRARY"}
        env = {key: value for key, value in os.environ.items()
               if not key.startswith("MANURE_") or key in provider}
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
