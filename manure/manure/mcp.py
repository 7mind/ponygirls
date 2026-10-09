"""manure MCP stdio server: real JSON-RPC 2.0 + MCP (contract v0.2 §10).

Stdlib only. Newline-delimited JSON-RPC on stdin/stdout, logs to stderr.
No module-level mutable state: versions are tuples, tool schemas are built
fresh per call and never shared-mutated.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

MCP_VERSION = "2025-11-25"
SUPPORTED_VERSIONS = ("2025-11-25",)
SERVER_NAME = "manure"
SERVER_VERSION = "0.2.0"


def _tool_defs() -> list[dict[str, Any]]:
    ro = {"readOnlyHint": True, "destructiveHint": False,
          "idempotentHint": True, "openWorldHint": False}
    rw = {"readOnlyHint": False, "destructiveHint": True,
          "idempotentHint": False, "openWorldHint": True}
    return [
        {"name": "whoami", "description": "Return authenticated identity (user_id, type, token_id).",
         "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
         "annotations": dict(ro)},
        {"name": "list_artifacts",
         "description": "List artifacts (paginated).",
         "inputSchema": {"type": "object",
                         "properties": {"limit": {"type": "integer", "minimum": 1},
                                        "cursor": {"type": "string"},
                                        "include_expired": {"type": "boolean"}},
                         "additionalProperties": False},
         "annotations": dict(ro)},
        {"name": "get_artifact", "description": "Inspect one artifact.",
         "inputSchema": {"type": "object",
                         "properties": {"artifact_id": {"type": "string"}},
                         "required": ["artifact_id"], "additionalProperties": False},
         "annotations": dict(ro)},
        {"name": "get_manifest", "description": "Authorized manifest with hashes and empty dirs.",
         "inputSchema": {"type": "object",
                         "properties": {"artifact_id": {"type": "string"}},
                         "required": ["artifact_id"], "additionalProperties": False},
         "annotations": dict(ro)},
        {"name": "upload_artifact", "description": "Upload a file or directory (chunk-resumed, atomic publish).",
         "inputSchema": {"type": "object",
                         "properties": {"local_path": {"type": "string"},
                                        "access": {"type": "string", "enum": ["internal", "external", "public"]},
                                        "expires_in_s": {"type": ["integer", "null"]},
                                        "name": {"type": "string"}},
                         "required": ["local_path", "access"], "additionalProperties": False},
         "annotations": dict(rw)},
        {"name": "fetch_artifact", "description": "Fetch an artifact to a directory (resumed, verified).",
         "inputSchema": {"type": "object",
                         "properties": {"artifact_id": {"type": "string"},
                                        "dest_dir": {"type": "string"},
                                        "password": {"type": ["string", "null"]}},
                         "required": ["artifact_id", "dest_dir"], "additionalProperties": False},
         "annotations": dict(rw)},
        {"name": "delete_artifact", "description": "Delete an artifact (any state).",
         "inputSchema": {"type": "object",
                         "properties": {"artifact_id": {"type": "string"}},
                         "required": ["artifact_id"], "additionalProperties": False},
         "annotations": dict(rw)},
        {"name": "rotate_external_password", "description": "Rotate an external password (returns once).",
         "inputSchema": {"type": "object",
                         "properties": {"artifact_id": {"type": "string"}},
                         "required": ["artifact_id"], "additionalProperties": False},
         "annotations": dict(rw)},
    ]


def _tool_schema(name: str) -> dict[str, Any] | None:
    for t in _tool_defs():
        if t["name"] == name:
            return t
    return None


def _client_from_env(client_module: Any | None = None):
    from manure.client import ManureClient, resolve_secret_pair, strip_secret_value
    mod = client_module
    MC = getattr(mod, "ManureClient", None) if mod is not None else None
    if MC is None:
        from manure.client import ManureClient as MC  # type: ignore
    url_direct = os.environ.get("MANURE_URL")
    url_file = os.environ.get("MANURE_URL_FILE")
    url_file_s = strip_secret_value(url_file) if url_file is not None else None
    if url_file is not None and url_file_s is None:
        url_file = None
    else:
        url_file = url_file_s
    tok_direct = os.environ.get("MANURE_TOKEN")
    tok_file = os.environ.get("MANURE_TOKEN_FILE")
    tok_file_s = strip_secret_value(tok_file) if tok_file is not None else None
    if tok_file is not None and tok_file_s is None:
        tok_file = None
    else:
        tok_file = tok_file_s
    try:
        api_base = resolve_secret_pair(url_direct, url_file, kind="url")
    except Exception as e:
        from manure.client import ManureError
        code = getattr(e, "code", "missing-credentials")
        raise ManureError(code, "bad url credentials")
    token: str | None = None
    from manure.client import read_token_file, _exact_credential
    try:
        d = _exact_credential(tok_direct)
    except Exception as e:
        from manure.client import ManureError
        code = getattr(e, "code", "missing-credentials")
        raise ManureError(code, "bad token credentials")
    fval: str | None = None
    if tok_file is not None:
        try:
            fval = read_token_file(tok_file)
        except Exception as e:
            from manure.client import ManureError
            code = getattr(e, "code", "missing-credentials")
            raise ManureError(code, "bad token credentials")
    from manure.client import AmbiguousCredentials
    if d is not None and fval is not None:
        raise AmbiguousCredentials("both MANURE_TOKEN and MANURE_TOKEN_FILE set")
    token = d if d is not None else fval
    cache_env = os.environ.get("MANURE_CACHE_DIR")
    from manure.client import strip_secret_value as ssv
    cache_s = ssv(cache_env) if cache_env is not None else None
    cache_dir = Path(cache_s) if cache_s is not None else Path.home() / ".cache" / "manure"
    if api_base is None:
        from manure.client import MissingCredentials
        raise MissingCredentials("MANURE_URL is required")
    return MC(api_base, token=token, cache_dir=cache_dir)


def _validate_call_args(name: str, args: Any) -> str | None:
    """Return error string if invalid params, else None (enforces minima)."""
    schema = _tool_schema(name)
    if schema is None:
        return f"unknown tool: {name}"
    if not isinstance(args, dict):
        return "arguments must be an object"
    props = schema["inputSchema"].get("properties", {})
    required = schema["inputSchema"].get("required", [])
    for r in required:
        if r not in args:
            return f"missing required: {r}"
    for k in args:
        if k not in props:
            return f"unexpected argument: {k}"
    for k, v in args.items():
        spec = props.get(k, {})
        t = spec.get("type")
        allowed = [t] if isinstance(t, str) else list(t or [])
        if v is None and "null" in allowed:
            continue  # explicit null: contract-valid omitted value
        if t == "string" and not isinstance(v, str):
            return f"{k} must be string"
        if isinstance(t, list) and "string" in t and not isinstance(v, str):
            return f"{k} must be string"
        if t == "integer" and not (isinstance(v, int) and not isinstance(v, bool)):
            return f"{k} must be integer"
        if isinstance(t, list) and "integer" in t and not (isinstance(v, int) and not isinstance(v, bool)):
            return f"{k} must be integer"
        if t == "boolean" and not isinstance(v, bool):
            return f"{k} must be boolean"
        if "minimum" in spec and isinstance(v, int) and not isinstance(v, bool):
            if v < int(spec["minimum"]):
                return f"{k} below minimum"
        if k == "access" and v not in ("internal", "external", "public"):
            return "access must be internal|external|public"
    return None


def handle_tools_call(name: str, arguments: dict[str, Any], client_module: Any | None = None) -> dict[str, Any]:
    """Execute one tool call; domain faults -> isError envelope (never raise)."""
    from manure.client import ManureError
    try:
        client = _client_from_env(client_module)
    except ManureError as e:
        return {"content": [{"type": "text", "text": json.dumps({"code": e.code, "message": e.message})}],
                "isError": True}
    except Exception:
        return {"content": [{"type": "text", "text": json.dumps({"code": "missing-credentials", "message": "bad credentials"})}],
                "isError": True}
    try:
        if name == "whoami":
            res = client.whoami()
        elif name == "list_artifacts":
            res = client.list_artifacts(limit=arguments.get("limit"), cursor=arguments.get("cursor"),
                                        include_expired=bool(arguments.get("include_expired", False)))
        elif name == "get_artifact":
            res = client.get_artifact(arguments["artifact_id"])
        elif name == "get_manifest":
            res = client.get_manifest(arguments["artifact_id"])
        elif name == "upload_artifact":
            res = client.upload_path(arguments["local_path"], access=arguments["access"],
                                     name=arguments.get("name"),
                                     expires_in_s=arguments.get("expires_in_s"))
        elif name == "fetch_artifact":
            res = client.fetch_to_dest(arguments["artifact_id"], arguments["dest_dir"],
                                       password=arguments.get("password"))
        elif name == "delete_artifact":
            res = client.delete(arguments["artifact_id"])
        elif name == "rotate_external_password":
            res = client.rotate_password(arguments["artifact_id"])
        else:
            return {"content": [{"type": "text", "text": json.dumps({"code": "bad-envelope", "message": "unknown tool"})}],
                    "isError": True}
    except ManureError as e:
        return {"content": [{"type": "text", "text": json.dumps({"code": e.code, "message": e.message})}],
                "isError": True}
    except Exception:
        # Sanitized: never echo arguments (may contain password/paths).
        return {"content": [{"type": "text", "text": json.dumps({"code": "internal", "message": "tool failed"})}],
                "isError": True}
    return {"content": [{"type": "text", "text": json.dumps(res, sort_keys=True)}]}


def _err(id_val: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": id_val, "error": {"code": code, "message": message}}


def _valid_id(value: Any) -> bool:
    # Explicit null IDs are invalid (absent id = notification instead).
    if value is None:
        return False
    if isinstance(value, bool):
        return False
    return isinstance(value, (str, int))


def _validate_initialize_params(params: Any) -> str | None:
    # Official MCP initialize schema: protocolVersion (string, required),
    # capabilities (object, required), clientInfo (object with name/version).
    if not isinstance(params, dict):
        return "params must be an object"
    ver = params.get("protocolVersion")
    if not isinstance(ver, str):
        return "protocolVersion must be a string"
    caps = params.get("capabilities")
    if not isinstance(caps, dict):
        return "capabilities must be an object"
    # Typed standard capability members (MCP lifecycle schema): known members
    # must be objects; roots.listChanged, if present, must be boolean.
    for member in ("roots", "sampling", "elicitation", "experimental",
                   "tools", "resources", "prompts", "logging", "completions"):
        if member in caps and not isinstance(caps[member], dict):
            return f"capabilities.{member} must be an object"
    roots = caps.get("roots")
    if isinstance(roots, dict) and "listChanged" in roots \
            and not isinstance(roots["listChanged"], bool):
        return "capabilities.roots.listChanged must be a boolean"
    ci = params.get("clientInfo")
    if not isinstance(ci, dict):
        return "clientInfo must be an object"
    if not isinstance(ci.get("name"), str) or not isinstance(ci.get("version"), str):
        return "clientInfo.name/version must be strings"
    return None


def _validate_no_or_meta_params(params: Any) -> str | None:
    """ping accepts absent/empty or {_meta: {...}} only (B6)."""
    if params is None:
        # Distinguish absent (caller passes {}) from explicit null upstream;
        # direct None here means absent.
        return None
    if not isinstance(params, dict):
        return "params must be an object"
    if not params:
        return None
    if set(params.keys()) == {"_meta"} and isinstance(params["_meta"], dict):
        return None
    return "Invalid params"


def _validate_list_params(params: Any) -> str | None:
    """tools/list accepts absent/empty, {_meta}, and optional string cursor."""
    if params is None:
        return None
    if not isinstance(params, dict):
        return "params must be an object"
    allowed = {"_meta", "cursor"}
    for k in params:
        if k not in allowed:
            return f"unexpected param: {k}"
    if "_meta" in params and not isinstance(params["_meta"], dict):
        return "_meta must be an object"
    if "cursor" in params and not isinstance(params["cursor"], str):
        return "cursor must be a string"
    return None


def main() -> None:
    stdin = sys.stdin.buffer
    stdout = sys.stdout
    initialized = False
    notified = False
    for raw in stdin:
        try:
            try:
                line = raw.decode("utf-8")
            except Exception:
                stdout.write(json.dumps(_err(None, -32700, "Parse error")) + "\n")
                stdout.flush()
                continue
            if line.strip() == "":
                continue
            try:
                msg = json.loads(line)
            except Exception:
                stdout.write(json.dumps(_err(None, -32700, "Parse error")) + "\n")
                stdout.flush()
                continue
            if isinstance(msg, list):
                stdout.write(json.dumps(_err(None, -32600, "Invalid Request")) + "\n")
                stdout.flush()
                continue
            if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
                mid0 = msg.get("id") if isinstance(msg, dict) and "id" in msg else None
                mid0 = mid0 if _valid_id(mid0) else None
                stdout.write(json.dumps(_err(mid0, -32600, "Invalid Request")) + "\n")
                stdout.flush()
                continue
            method = msg.get("method")
            if not isinstance(method, str):
                mid1 = msg.get("id") if "id" in msg else None
                mid1 = mid1 if _valid_id(mid1) else None
                stdout.write(json.dumps(_err(mid1, -32600, "Invalid Request")) + "\n")
                stdout.flush()
                continue
            has_id = "id" in msg
            mid = msg.get("id")
            if has_id and not _valid_id(mid):
                stdout.write(json.dumps(_err(None, -32600, "Invalid Request")) + "\n")
                stdout.flush()
                continue
            if "params" in msg and msg["params"] is None:
                # Explicit null params are invalid for every MCP request/notification.
                if has_id:
                    stdout.write(json.dumps(_err(mid, -32602, "Invalid params")) + "\n")
                    stdout.flush()
                continue
            params = msg.get("params", {})
            # notifications/* never get a response (distinguished by absent id
            # for generic notifications, and by prefix for lifecycle).
            if method.startswith("notifications/"):
                if method == "notifications/initialized":
                    # B6: only a valid id-less notification advances lifecycle.
                    if has_id:
                        stdout.write(json.dumps(_err(None, -32600, "Invalid Request")) + "\n")
                        stdout.flush()
                        continue
                    if params is None or params == {}:
                        valid_notif = True
                    elif isinstance(params, dict) and set(params.keys()) == {"_meta"} and isinstance(params["_meta"], dict):
                        valid_notif = True
                    else:
                        valid_notif = False
                    if valid_notif and initialized:
                        notified = True
                continue
            if has_id is False:
                # Notification-form request (no id): no response per JSON-RPC.
                continue
            if method == "initialize":
                perr = _validate_initialize_params(params)
                if perr is not None:
                    stdout.write(json.dumps(_err(mid, -32602, perr)) + "\n")
                    stdout.flush()
                    continue
                asked = params.get("protocolVersion")
                chosen = asked if asked in SUPPORTED_VERSIONS else MCP_VERSION
                initialized = True
                stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid,
                                         "result": {"protocolVersion": chosen,
                                                    "capabilities": {"tools": {}},
                                                    "serverInfo": {"name": SERVER_NAME,
                                                                   "version": SERVER_VERSION}}}) + "\n")
                stdout.flush()
                continue
            if method == "ping":
                perr = _validate_no_or_meta_params(params)
                if perr is not None:
                    stdout.write(json.dumps(_err(mid, -32602, perr)) + "\n")
                    stdout.flush()
                    continue
                stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": {}}) + "\n")
                stdout.flush()
                continue
            if method == "tools/list":
                if not (initialized and notified):
                    stdout.write(json.dumps(_err(mid, -32002, "Server not initialized")) + "\n")
                    stdout.flush()
                    continue
                perr = _validate_list_params(params)
                if perr is not None:
                    stdout.write(json.dumps(_err(mid, -32602, perr)) + "\n")
                    stdout.flush()
                    continue
                stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid,
                                         "result": {"tools": _tool_defs()}}) + "\n")
                stdout.flush()
                continue
            if method == "tools/call":
                if not (initialized and notified):
                    stdout.write(json.dumps(_err(mid, -32002, "Server not initialized")) + "\n")
                    stdout.flush()
                    continue
                if not isinstance(params, dict):
                    stdout.write(json.dumps(_err(mid, -32602, "Invalid params")) + "\n")
                    stdout.flush()
                    continue
                tname = params.get("name")
                targs = params.get("arguments", {})
                if not isinstance(tname, str) or not isinstance(targs, dict):
                    stdout.write(json.dumps(_err(mid, -32602, "Invalid params")) + "\n")
                    stdout.flush()
                    continue
                perr = _validate_call_args(tname, targs)
                if perr is not None:
                    stdout.write(json.dumps(_err(mid, -32602, perr)) + "\n")
                    stdout.flush()
                    continue
                try:
                    result = handle_tools_call(tname, targs, None)
                except Exception:
                    stdout.write(json.dumps(_err(mid, -32603, "Internal error")) + "\n")
                    stdout.flush()
                    continue
                stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid, "result": result}) + "\n")
                stdout.flush()
                continue
            stdout.write(json.dumps(_err(mid, -32601, "Method not found")) + "\n")
            stdout.flush()
        except Exception:
            try:
                stdout.write(json.dumps(_err(None, -32603, "Internal error")) + "\n")
                stdout.flush()
            except Exception:
                pass


if __name__ == "__main__":
    main()
