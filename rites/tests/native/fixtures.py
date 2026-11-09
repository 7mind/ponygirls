"""Loopback-only Rites acceptance fixtures; no live forge or model access."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import threading
from dataclasses import dataclass, field
from types import MappingProxyType
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Mapping
from urllib.parse import parse_qs, unquote, urlsplit


JsonObject = dict[str, object]
FORGE_PROJECTS: Mapping[str, str] = MappingProxyType({
    "Github": "fixture/github-repository",
    "Gitlab": "fixture/gitlab-repository",
})
EXPECTED_TOOLS = frozenset({
    "rites_read", "rites_bash", "rites_edit", "rites_write",
    "rites_grep", "rites_find", "rites_ls",
})
MODEL_KEY = "synthetic-model-key"
FORGE_KEY = "synthetic-github-token"
PROBE_WITNESS = re.compile(r"PROBE_EXECUTED\+(?:DENIED|EXPOSED|ERROR):(?:credential-content|model-content|forge-content|credential-search|\.rites-model\.json)")
PROBE_DENIALS = ("PROBE_EXECUTED+DENIED:credential-content", "PROBE_EXECUTED+DENIED:.rites-model.json")
PROBE_COMMAND = (
    "exposed=0; "
    "grep -R -q -F -- '" + MODEL_KEY + "' /workspace >/dev/null 2>&1; status=$?; "
    "if test \"$status\" -eq 0; then printf 'PROBE_EXECUTED+EXPOSED:model-content\\n'; exposed=1; "
    "elif test \"$status\" -ne 1; then printf 'PROBE_EXECUTED+ERROR:credential-search\\n'; exposed=2; fi; "
    "grep -R -q -F -- '" + FORGE_KEY + "' /workspace >/dev/null 2>&1; status=$?; "
    "if test \"$status\" -eq 0; then printf 'PROBE_EXECUTED+EXPOSED:forge-content\\n'; exposed=1; "
    "elif test \"$status\" -ne 1; then printf 'PROBE_EXECUTED+ERROR:credential-search\\n'; exposed=2; fi; "
    "if test \"$exposed\" -eq 0; then printf 'PROBE_EXECUTED+DENIED:credential-content\\n'; fi; "
    "if test -r /workspace/.rites-model.json; then printf 'PROBE_EXECUTED+EXPOSED:.rites-model.json\\n'; "
    "else printf 'PROBE_EXECUTED+DENIED:.rites-model.json\\n'; fi"
)
OPERATOR_CLIENT = "fixture-operator"
OPERATOR_SECRET = "synthetic-operator-secret"
REDIRECT_PATH = "/oauth/callback"


class FixtureProblem(Exception):
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


@dataclass
class Proposal:
    remote_id: int
    forge: str
    project: str
    title: str
    source: str
    target: str
    marker: str
    author: str
    state: str
    merged: bool = False

    def public(self, base_url: str) -> JsonObject:
        if self.forge == "Github":
            repository = {"full_name": self.project}
            return {
                "number": self.remote_id,
                "html_url": f"{base_url}/github/pull/{self.remote_id}",
                "user": {"id": numeric_user_id(self.author), "login": "fixture-user"},
                "head": {"ref": self.source, "repo": repository},
                "base": {"ref": self.target, "repo": repository},
                "body": self.marker,
                "state": self.state,
                "merged": self.merged,
                "title": self.title,
            }
        project_id = stable_project_id(self.project)
        return {
            "iid": self.remote_id,
            "web_url": f"{base_url}/gitlab/merge_requests/{self.remote_id}",
            "author": {"id": numeric_user_id(self.author), "username": "fixture-user"},
            "source_branch": self.source,
            "target_branch": self.target,
            "description": self.marker,
            "state": self.state,
            "merged": self.merged,
            "title": self.title,
            "source_project_id": project_id,
            "target_project_id": project_id,
        }


@dataclass
class ProjectState:
    forge: str
    project: str
    bare_path: Path
    base_revision: str
    prompt_digest: str
    static_tokens: set[str]
    proposals: dict[int, Proposal] = field(default_factory=dict)
    next_proposal_id: int = 1


@dataclass
class OAuthState:
    access_token: str
    refresh_token: str
    generation: int = 0
    drop_next_response: bool = False
    refresh_calls: int = 0


@dataclass
class ModelState:
    kind: str = "write"
    content: str = "fixture-result\n"
    hold: bool = False
    turn: int = 0
    calls: int = 0
    waiting: bool = False
    release: threading.Event = field(default_factory=threading.Event)
    observed_tool_sets: list[list[str]] = field(default_factory=list)
    emitted_tool_calls: list[str] = field(default_factory=list)
    witnesses: list[str] = field(default_factory=list)


@dataclass
class FixtureState:
    projects: dict[str, ProjectState]
    oauth: OAuthState
    model: ModelState = field(default_factory=ModelState)
    events: list[JsonObject] = field(default_factory=list)
    lock: threading.RLock = field(default_factory=threading.RLock)

    def project(self, forge: str, project: str) -> ProjectState:
        key = f"{forge}:{project}"
        selected = self.projects.get(key)
        if selected is None:
            raise FixtureProblem(404, "unknown-project")
        return selected

    def oauth_token_valid(self, token: str) -> bool:
        with self.lock:
            return hmac.compare_digest(token, self.oauth.access_token)

    def token_valid(self, project: ProjectState, token: str) -> bool:
        with self.lock:
            static = any(hmac.compare_digest(token, candidate) for candidate in project.static_tokens)
            return static or (project.forge == "Gitlab" and hmac.compare_digest(token, self.oauth.access_token))


def stable_project_id(project: str) -> int:
    return 10000 + int.from_bytes(hashlib.sha256(project.encode()).digest()[:2], "big")


def numeric_user_id(author: str) -> int:
    if author == "fixture-github-user":
        return 41001
    if author == "fixture-gitlab-user":
        return 42001
    return 49000


def selected_user_id(forge: str) -> int:
    return numeric_user_id("fixture-github-user" if forge == "Github" else "fixture-gitlab-user")


def run_git(arguments: list[str], cwd: Path, input_bytes: bytes, env: Mapping[str, str] | None) -> subprocess.CompletedProcess[bytes]:
    clean_env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": str(cwd),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0",
    }
    if env is not None:
        clean_env.update(env)
    return subprocess.run(
        ["git", *arguments], cwd=cwd, input=input_bytes, env=clean_env,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False,
    )


def seed_project(state_root: Path, forge: str, project: str, prompt: str) -> ProjectState:
    bare = state_root / "repositories" / f"{project}.git"
    work = state_root / "seed" / forge.lower()
    bare.parent.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=False)
    commands = [
        (["init", "--bare", "--initial-branch=main", str(bare)], state_root),
        (["init", "--initial-branch=main", "."], work),
        (["config", "user.name", "Fixture Seed"], work),
        (["config", "user.email", "fixture@localhost"], work),
    ]
    for arguments, cwd in commands:
        result = run_git(arguments, cwd, b"", None)
        if result.returncode != 0:
            raise RuntimeError(f"fixture git initialization failed: {arguments[0]}")
    (work / "prompt.md").write_text(prompt, encoding="utf-8")
    (work / "README.md").write_text(f"# {forge} acceptance fixture\n", encoding="utf-8")
    for arguments in (["add", "prompt.md", "README.md"], ["commit", "-m", "Seed fixture"], ["push", str(bare), "main:main"]):
        result = run_git(arguments, work, b"", None)
        if result.returncode != 0:
            raise RuntimeError(f"fixture git seed failed: {arguments[0]}")
    revision_result = run_git(["--git-dir", str(bare), "rev-parse", "refs/heads/main"], state_root, b"", None)
    config_result = run_git(["--git-dir", str(bare), "config", "http.receivepack", "true"], state_root, b"", None)
    if revision_result.returncode != 0 or config_result.returncode != 0:
        raise RuntimeError("fixture git metadata initialization failed")
    return ProjectState(
        forge=forge,
        project=project,
        bare_path=bare,
        base_revision=revision_result.stdout.decode().strip(),
        prompt_digest=hashlib.sha256(prompt.encode()).hexdigest(),
        static_tokens={FORGE_KEY} if forge == "Github" else set(),
    )


def model_config(base_url: str) -> JsonObject:
    return {
        "provider": "fixture",
        "modelsJson": {
            "providers": {
                "fixture": {
                    "baseUrl": f"{base_url}/model",
                    "api": "openai-completions",
                    "models": [{
                        "id": "fixture-model", "name": "Fixture", "reasoning": False,
                        "input": ["text"], "contextWindow": 4096, "maxTokens": 256,
                        "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
                        "compat": {"supportsDeveloperRole": False, "maxTokensField": "max_tokens"},
                    }],
                }
            }
        },
        "credential": {"type": "api_key", "key": MODEL_KEY},
    }


class FixtureHandler(BaseHTTPRequestHandler):
    server: "FixtureHttpServer"
    protocol_version = "HTTP/1.1"

    def log_message(self, message_format: str, *arguments: object) -> None:
        return

    def do_GET(self) -> None:
        self.dispatch("GET")

    def do_POST(self) -> None:
        self.dispatch("POST")

    def do_PUT(self) -> None:
        self.dispatch("PUT")

    def do_PATCH(self) -> None:
        self.dispatch("PATCH")

    def dispatch(self, method: str) -> None:
        try:
            if self.client_address[0] != "127.0.0.1":
                raise FixtureProblem(403, "loopback-required")
            if self.server.state.model.waiting and method == "GET" and self.path == "/__fixture/observation":
                self.json_response(200, self.server.observation())
                return
            split = urlsplit(self.path)
            path = split.path
            if path.startswith("/__fixture/"):
                self.control(method, path)
            elif path.startswith("/model/"):
                self.model(method)
            elif path == "/gitlab/oauth/token":
                self.oauth(method)
            elif "/git/" in path:
                self.git_http(method, path)
            elif path.startswith("/github/api/v3/"):
                self.forge_rest(method, path, "Github", split.query)
            elif path.startswith("/gitlab/api/v4/"):
                self.forge_rest(method, path, "Gitlab", split.query)
            else:
                raise FixtureProblem(404, "not-found")
        except FixtureProblem as problem:
            self.json_response(problem.status, {"error": problem.code})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:
            self.json_response(500, {"error": "fixture-internal"})

    def body(self, maximum: int = 2 * 1024 * 1024) -> bytes:
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            return b""
        length = int(length_header)
        if length < 0 or length > maximum:
            raise FixtureProblem(413, "body-too-large")
        data = self.rfile.read(length)
        if len(data) != length:
            raise FixtureProblem(400, "incomplete-body")
        return data

    def json_body(self) -> JsonObject:
        try:
            value = json.loads(self.body())
        except (ValueError, UnicodeDecodeError):
            raise FixtureProblem(400, "invalid-json")
        if not isinstance(value, dict):
            raise FixtureProblem(400, "object-required")
        return value

    def json_response(self, status: int, value: object) -> None:
        data = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def control(self, method: str, path: str) -> None:
        if method == "GET" and path == "/__fixture/observation":
            self.json_response(200, self.server.observation())
            return
        if method != "POST":
            raise FixtureProblem(404, "not-found")
        body = self.json_body()
        state = self.server.state
        if path == "/__fixture/model":
            kind = body.get("kind")
            content = body.get("content")
            hold = body.get("hold")
            if kind not in {"write", "nochange", "partial-error", "partial-length", "credential-probe"} or not isinstance(content, str) or not isinstance(hold, bool):
                raise FixtureProblem(400, "invalid-model-phase")
            with state.lock:
                if state.model.waiting:
                    state.model.release.set()
                state.model = ModelState(kind=kind, content=content, hold=hold)
                if not hold:
                    state.model.release.set()
        elif path == "/__fixture/model/release":
            with state.lock:
                state.model.release.set()
                state.model.waiting = False
        elif path == "/__fixture/oauth":
            mode = body.get("mode")
            with state.lock:
                if mode == "drop-next":
                    state.oauth.drop_next_response = True
                elif mode == "replace":
                    generation = state.oauth.generation + 1
                    state.oauth.access_token = f"synthetic-replacement-access-{generation}"
                    state.oauth.refresh_token = f"synthetic-replacement-refresh-{generation}"
                    state.oauth.generation = generation
                    state.oauth.drop_next_response = False
                else:
                    raise FixtureProblem(400, "invalid-oauth-mode")
        elif path == "/__fixture/proposal":
            self.insert_external_proposal(body)
        else:
            raise FixtureProblem(404, "not-found")
        self.json_response(200, {"ok": True})

    def insert_external_proposal(self, body: JsonObject) -> None:
        forge = body.get("forge")
        project_name = body.get("project")
        state = body.get("state")
        marker = body.get("marker")
        if not isinstance(forge, str) or not isinstance(project_name, str) or state not in {"open", "opened", "closed", "merged"} or not isinstance(marker, str):
            raise FixtureProblem(400, "invalid-proposal")
        project = self.server.state.project(forge, project_name)
        with self.server.state.lock:
            proposal = Proposal(
                remote_id=project.next_proposal_id, forge=forge, project=project.project,
                title="External fixture proposal", source="external/unowned", target="main",
                marker=marker, author="external-user", state="opened" if forge == "Gitlab" and state == "open" else state,
                merged=state == "merged",
            )
            project.next_proposal_id += 1
            project.proposals[proposal.remote_id] = proposal

    def bearer_project(self, forge: str, suffix: str) -> ProjectState:
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            raise FixtureProblem(401, "authorization-required")
        token = authorization.removeprefix("Bearer ")
        if forge == "Github" and suffix.startswith("repos/"):
            encoded = suffix.removeprefix("repos/").split("/pulls", 1)[0]
        elif forge == "Gitlab" and suffix.startswith("projects/"):
            encoded = suffix.removeprefix("projects/").split("/merge_requests", 1)[0]
        else:
            encoded = ""
        project_name = unquote(encoded)
        project = self.server.state.project(forge, project_name)
        if not self.server.state.token_valid(project, token):
            raise FixtureProblem(401, "invalid-token")
        return project

    def user(self, forge: str) -> None:
        token = self.headers.get("Authorization", "").removeprefix("Bearer ")
        if forge == "Github":
            valid = self.server.state.token_valid(self.server.state.project(forge, FORGE_PROJECTS[forge]), token)
        else:
            valid = self.server.state.oauth_token_valid(token) or any(
                hmac.compare_digest(token, candidate) for candidate in self.server.state.project(forge, FORGE_PROJECTS[forge]).static_tokens
            )
        if not valid:
            raise FixtureProblem(401, "invalid-token")
        self.json_response(200, {"id": selected_user_id(forge), "login": "fixture-user", "username": "fixture-user"})

    def forge_rest(self, method: str, path: str, forge: str, query: str) -> None:
        suffix = path.removeprefix("/github/api/v3/" if forge == "Github" else "/gitlab/api/v4/")
        if suffix == "user" and method == "GET":
            self.user(forge)
            return
        project = self.bearer_project(forge, suffix)
        proposal_root = "pulls" if forge == "Github" else "merge_requests"
        marker = f"/{proposal_root}"
        if marker not in suffix or not suffix.startswith(("repos/", "projects/")):
            raise FixtureProblem(404, "not-found")
        tail = suffix.split(marker, 1)[1]
        state = self.server.state
        if method == "GET" and tail == "":
            with state.lock:
                values = [p.public(self.server.base_url) for p in project.proposals.values() if p.state in {"open", "opened"}]
            self.json_response(200, values)
            return
        if method == "POST" and tail == "":
            body = self.json_body()
            source = body.get("head" if forge == "Github" else "source_branch")
            target = body.get("base" if forge == "Github" else "target_branch")
            marker_text = body.get("body" if forge == "Github" else "description")
            title = body.get("title")
            if not all(isinstance(value, str) and value for value in (source, target, marker_text, title)):
                raise FixtureProblem(400, "invalid-proposal")
            if target != "main" or not isinstance(source, str) or not source.startswith("rites/"):
                raise FixtureProblem(422, "publication-denied")
            with state.lock:
                proposal = Proposal(
                    remote_id=project.next_proposal_id, forge=forge, project=project.project,
                    title=title, source=source, target=target, marker=marker_text,
                    author="fixture-github-user" if forge == "Github" else "fixture-gitlab-user",
                    state="open" if forge == "Github" else "opened",
                )
                project.next_proposal_id += 1
                project.proposals[proposal.remote_id] = proposal
                state.events.append({"event": "create", "forge": forge, "id": proposal.remote_id, "source": source})
                result = proposal.public(self.server.base_url)
            self.json_response(201, result)
            return
        if not tail.startswith("/") or not tail[1:].isdigit():
            raise FixtureProblem(404, "not-found")
        remote_id = int(tail[1:])
        with state.lock:
            proposal = project.proposals.get(remote_id)
            if proposal is None:
                raise FixtureProblem(404, "not-found")
            if method == "GET":
                result = proposal.public(self.server.base_url)
            elif method == "PATCH" and forge == "Github" and self.json_body().get("state") == "closed":
                proposal.state = "closed"
                state.events.append({"event": "close", "forge": forge, "id": remote_id, "source": proposal.source})
                result = proposal.public(self.server.base_url)
            elif method == "PUT" and forge == "Gitlab" and self.json_body().get("state_event") == "close":
                proposal.state = "closed"
                state.events.append({"event": "close", "forge": forge, "id": remote_id, "source": proposal.source})
                result = proposal.public(self.server.base_url)
            else:
                raise FixtureProblem(400, "unsupported-proposal-change")
        self.json_response(200, result)

    def oauth(self, method: str) -> None:
        if method != "POST":
            raise FixtureProblem(404, "not-found")
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
        if content_type != "application/x-www-form-urlencoded":
            raise FixtureProblem(400, "form-required")
        try:
            form = parse_qs(self.body(65536).decode(), strict_parsing=True)
        except (ValueError, UnicodeDecodeError):
            raise FixtureProblem(400, "invalid-form")
        state = self.server.state
        with state.lock:
            state.oauth.refresh_calls += 1
            valid = (
                form.get("grant_type") == ["refresh_token"]
                and form.get("client_id") == [OPERATOR_CLIENT]
                and form.get("client_secret") == [OPERATOR_SECRET]
                and form.get("redirect_uri") == [f"{self.server.base_url}{REDIRECT_PATH}"]
                and form.get("refresh_token") == [state.oauth.refresh_token]
            )
            if not valid:
                self.json_response(400, {"error": "invalid_grant"})
                return
            state.oauth.generation += 1
            state.oauth.access_token = f"synthetic-oauth-access-{state.oauth.generation}"
            state.oauth.refresh_token = f"synthetic-oauth-refresh-{state.oauth.generation}"
            drop = state.oauth.drop_next_response
            state.oauth.drop_next_response = False
            response = {
                "access_token": state.oauth.access_token,
                "refresh_token": state.oauth.refresh_token,
                "expires_in": 3600,
                "token_type": "Bearer",
            }
        if drop:
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.connection.close()
            return
        self.json_response(200, response)

    def model(self, method: str) -> None:
        if method != "POST" or self.path not in {"/model/chat/completions", "/model/v1/chat/completions"}:
            raise FixtureProblem(404, "not-found")
        body = self.json_body()
        if not hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {MODEL_KEY}"):
            raise FixtureProblem(401, "invalid-model-key")
        raw_tools = body.get("tools")
        tools: list[str] = []
        if isinstance(raw_tools, list):
            for raw in raw_tools:
                if isinstance(raw, dict):
                    function = raw.get("function")
                    if isinstance(function, dict) and isinstance(function.get("name"), str):
                        tools.append(function["name"])
        if set(tools) != EXPECTED_TOOLS or len(tools) != len(EXPECTED_TOOLS):
            raise FixtureProblem(400, "brokered-tools-required")
        state = self.server.state
        witnesses = PROBE_WITNESS.findall(json.dumps(body.get("messages", []), separators=(",", ":")))
        state = self.server.state
        with state.lock:
            model = state.model
            model.calls += 1
            model.turn += 1
            model.observed_tool_sets.append(sorted(tools))
            for witness in witnesses:
                if witness not in model.witnesses:
                    model.witnesses.append(witness)
            turn = model.turn
            hold = model.hold and turn == 1
            kind = model.kind
            content = model.content
            if hold:
                model.waiting = True
                release = model.release
            else:
                release = None
        if release is not None:
            if not release.wait(timeout=90):
                with state.lock:
                    model.waiting = False
                raise FixtureProblem(503, "model-hold-deadline")
            with state.lock:
                model.waiting = False
        if (kind == "partial-error" and turn > 1):
            self.json_response(500, {"error": {"message": "synthetic scripted failure", "type": "synthetic"}})
            return
        planned_tool: tuple[str, JsonObject] | None = None
        response_text = "synthetic fixture response"
        if turn == 1 and kind in {"write", "partial-error", "partial-length"}:
            planned_tool = ("rites_write", {"path": "result.txt", "content": content})
        elif kind == "credential-probe" and turn == 1:
            planned_tool = ("rites_bash", {"command": PROBE_COMMAND})
        elif kind == "credential-probe" and turn == 2 and witnesses == list(PROBE_DENIALS):
            planned_tool = ("rites_write", {"path": "result.txt", "content": "PROBE_EXECUTED+DENIED:credential-content\nPROBE_EXECUTED+DENIED:.rites-model.json\n"})
        elif kind == "credential-probe" and turn == 2:
            response_text = "PROBE_EXECUTED+EXPOSED" if any("+EXPOSED:" in witness for witness in witnesses) else "PROBE_WITNESS_MISSING"
        if planned_tool is not None:
            with state.lock:
                model.emitted_tool_calls.append(planned_tool[0])
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        if planned_tool is not None:
            name, arguments = planned_tool
            self.model_tool(name, arguments)
        else:
            finish = "length" if kind == "partial-length" and turn > 1 else "stop"
            self.sse(self.model_chunk({"role": "assistant", "content": response_text}, None))
            self.sse(self.model_chunk({}, finish))
        self.sse({"id": "chatcmpl-rites-fixture", "object": "chat.completion.chunk", "choices": [], "usage": {"prompt_tokens": 16, "completion_tokens": 8, "total_tokens": 24}})
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()
        self.close_connection = True

    def model_tool(self, name: str, arguments: JsonObject) -> None:
        self.sse({
            "id": "chatcmpl-rites-fixture", "object": "chat.completion.chunk", "created": 1700000000,
            "model": "fixture-model",
            "choices": [{"index": 0, "delta": {"role": "assistant", "tool_calls": [{
                "index": 0, "id": "call_rites_fixture", "type": "function",
                "function": {"name": name, "arguments": json.dumps(arguments)},
            }]}, "finish_reason": None}],
        })
        self.sse(self.model_chunk({}, "tool_calls"))

    def model_chunk(self, delta: JsonObject, finish: str | None) -> JsonObject:
        return {
            "id": "chatcmpl-rites-fixture", "object": "chat.completion.chunk", "created": 1700000000,
            "model": "fixture-model", "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }

    def sse(self, value: JsonObject) -> None:
        self.wfile.write(b"data: " + json.dumps(value, separators=(",", ":")).encode() + b"\n\n")

    def git_http(self, method: str, path: str) -> None:
        prefix = "/github/git/" if path.startswith("/github/git/") else "/gitlab/git/" if path.startswith("/gitlab/git/") else ""
        if not prefix:
            raise FixtureProblem(404, "not-found")
        forge = "Github" if "github" in prefix else "Gitlab"
        repository_path = path.removeprefix(prefix)
        project_name = unquote(repository_path.split(".git", 1)[0])
        project = self.server.state.project(forge, project_name)
        authorization = self.headers.get("Authorization", "")
        valid = False
        if authorization.startswith("Basic "):
            try:
                decoded = base64.b64decode(authorization.removeprefix("Basic "), validate=True).decode()
                username, token = decoded.split(":", 1)
                expected_user = "x-access-token" if forge == "Github" else "oauth2"
                valid = username == expected_user and self.server.state.token_valid(project, token)
            except (ValueError, UnicodeDecodeError):
                valid = False
        operation = "receive-pack" if repository_path.endswith("git-receive-pack") else "upload-pack" if repository_path.endswith("git-upload-pack") else "info-refs"
        with self.server.state.lock:
            self.server.state.events.append({"event": "git-auth", "forge": forge, "operation": operation, "accepted": valid})
        if not valid:
            data = b"authentication required\n"
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="rites-fixture"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        body = self.body(16 * 1024 * 1024)
        path_info = "/" + repository_path
        env = {
            "GIT_PROJECT_ROOT": str(self.server.root / "repositories"),
            "GIT_HTTP_EXPORT_ALL": "1",
            "PATH_INFO": path_info,
            "REQUEST_METHOD": method,
            "QUERY_STRING": urlsplit(self.path).query,
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": str(len(body)),
            "REMOTE_USER": "x-access-token" if forge == "Github" else "oauth2",
            "REMOTE_ADDR": "127.0.0.1",
            "SERVER_PROTOCOL": "HTTP/1.1",
        }
        result = run_git(["http-backend"], self.server.root, body, env)
        if result.returncode != 0:
            raise FixtureProblem(500, "git-backend-failed")
        header_bytes, response_body = result.stdout.split(b"\r\n\r\n", 1) if b"\r\n\r\n" in result.stdout else result.stdout.split(b"\n\n", 1)
        status = 200
        headers: dict[str, str] = {}
        for raw_line in header_bytes.replace(b"\r", b"").split(b"\n"):
            key, value = raw_line.decode().split(":", 1)
            if key.lower() == "status":
                status = int(value.strip().split(" ", 1)[0])
            else:
                headers[key] = value.strip()
        self.send_response(status)
        for key, value in headers.items():
            if key.lower() not in {"content-length", "connection"}:
                self.send_header(key, value)
        self.send_header("Content-Length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)


class FixtureHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, state: FixtureState, root: Path):
        self.state = state
        self.root = root
        super().__init__(("127.0.0.1", 0), FixtureHandler)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server_port}"

    def observation(self) -> JsonObject:
        with self.state.lock:
            proposals: list[JsonObject] = []
            projects: list[JsonObject] = []
            for project in self.state.projects.values():
                public = [proposal.public(self.base_url) for proposal in sorted(project.proposals.values(), key=lambda item: item.remote_id)]
                projects.append({
                    "forge": project.forge, "project": project.project,
                    "baseRevision": project.base_revision, "promptDigest": project.prompt_digest,
                    "proposals": public,
                })
                proposals.extend(public)
            return {
                "projects": projects,
                "events": list(self.state.events),
                "model": {
                    "calls": self.state.model.calls, "turn": self.state.model.turn,
                    "waiting": self.state.model.waiting,
                    "toolSets": list(self.state.model.observed_tool_sets),
                    "emittedTools": list(self.state.model.emitted_tool_calls),
                    "witnesses": list(self.state.model.witnesses),
                },
                "oauth": {"generation": self.state.oauth.generation, "refreshCalls": self.state.oauth.refresh_calls},
                "proposalCount": len(proposals),
            }


class FixtureServer:
    def __init__(self, root: Path):
        self.root = root
        prompt = "Update result.txt using the brokered workspace tools.\n"
        projects = {
            f"{forge}:{project}": seed_project(root, forge, project, prompt)
            for forge, project in FORGE_PROJECTS.items()
        }
        oauth = OAuthState(access_token="synthetic-oauth-access-0", refresh_token="synthetic-oauth-refresh-0")
        self.state = FixtureState(projects=projects, oauth=oauth)
        self.httpd = FixtureHttpServer(self.state, root)
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="rites-loopback-fixtures", daemon=True)
        self.base_url = self.httpd.base_url
        self.started = False

    def start(self) -> None:
        assert self.httpd.server_address[0] == "127.0.0.1"
        self.thread.start()
        self.started = True

    def close(self) -> None:
        with self.state.lock:
            self.state.model.release.set()
        if self.started:
            self.httpd.shutdown()
        self.httpd.server_close()
        if self.thread.is_alive():
            self.thread.join(timeout=10)
        if self.thread.is_alive():
            raise RuntimeError("fixture server did not stop")
