"""BG: exercise the shipped bridge against its actual SDK, entirely offline.

Regression: MCP SDK 2 removed the low-level decorators used by Crawl4AI 0.9.5.
This checks registration and schema generation, not a browser or live SSE session.
"""
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel


class FixtureInput(BaseModel):
    url: str
    screenshot: bool = False


def check_bridge(server_root: Path) -> None:
    sys.path.insert(0, str(server_root))
    from mcp_bridge import attach_mcp, mcp_tool

    app = FastAPI()

    @app.get("/fixture")
    @mcp_tool("fixture")
    def fixture() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/structured")
    @mcp_tool("structured")
    def structured(body: FixtureInput) -> dict[str, str]:
        """A tool with a validated request body."""
        return {"url": body.url}

    @app.get("/not-a-tool")
    def ordinary_route() -> dict[str, bool]:
        return {"ok": True}

    # Only schema requests run; no proxy calls, browser, Redis or network.
    attach_mcp(app, base_url="http://127.0.0.1:1")
    paths = {route.path for route in app.routes}
    assert {"/mcp/sse", "/mcp/messages", "/mcp/ws", "/mcp/schema"} <= paths
    with TestClient(app) as client:
        response = client.get("/mcp/schema")
        assert response.status_code == 200, response.text
        schema = response.json()
        tools = {tool["name"]: tool for tool in schema["tools"]}
        assert set(tools) == {"fixture", "structured"}, schema
        assert tools["fixture"]["inputSchema"]["type"] == "object", schema
        body_schema = tools["structured"]["inputSchema"]
        assert body_schema["type"] == "object", schema
        assert body_schema["required"] == ["url"], schema
        assert body_schema["properties"]["url"]["type"] == "string", schema
        assert body_schema["properties"]["screenshot"]["default"] is False, schema
        assert tools["structured"]["description"] == structured.__doc__, schema
        assert schema["resources"] == [] and schema["resource_templates"] == [], schema
    print("Crawl4AI bridge registration, transport routes and tool schemas passed")


if __name__ == "__main__":
    check_bridge(Path(sys.argv[1]))
