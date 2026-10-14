# Behavioral-Active-Effectual-GoodCommunication: real Pi, controlled local MCP.
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import tempfile
from threading import Thread
import unittest


class PiHeaderTest(unittest.TestCase):
    def test_environment_header_expansion(self):
        observed = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_POST(self):
                observed.append(self.headers.get("Authorization"))
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                if "id" not in request:
                    self.send_response(202)
                    self.end_headers()
                    return
                method = request["method"]
                if method == "initialize":
                    result = {
                        "protocolVersion": request["params"]["protocolVersion"],
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": "synthetic-atlassian", "version": "1"},
                    }
                elif method == "tools/list":
                    result = {"tools": []}
                else:
                    self.send_response(400)
                    self.end_headers()
                    return
                body = json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                expected = "Basic " + base64.b64encode(b"user@example.com:dummy-token").decode()
                config = {
                    "mcpServers": {"atlassian": {
                        "url": f"http://127.0.0.1:{server.server_port}/mcp",
                        "headers": {"Authorization": "${ATLASSIAN_AUTHORIZATION}"},
                        "exposure": "deferred",
                    }},
                }
                Path(directory, "mcp.json").write_text(json.dumps(config))
                env = os.environ | {
                    "PI_CODING_AGENT_DIR": directory,
                    "PI_OFFLINE": "1",
                    "PI_TELEMETRY": "0",
                    "ATLASSIAN_AUTHORIZATION": expected,
                }
                result = subprocess.run(
                    ["pi", "mcp", "list", "--json"], cwd=directory, env=env,
                    capture_output=True, text=True, timeout=30, check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(observed)
                self.assertTrue(all(value == expected for value in observed))
                self.assertNotIn(expected, result.stdout + result.stderr)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
