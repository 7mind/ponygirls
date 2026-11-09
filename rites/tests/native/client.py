"""Strict HTTP clients for the public Rites API and loopback fixture controls."""
from __future__ import annotations

import http.client
import json
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Mapping
from urllib.parse import urlsplit


JsonObject = dict[str, object]
NO_BODY = object()


@dataclass(frozen=True)
class Response:
    status: int
    headers: Mapping[str, str]
    json: object


class LoopbackTransport:
    def __init__(self, base_url: str, timeout_seconds: float):
        split = urlsplit(base_url)
        if split.scheme != "http" or split.hostname != "127.0.0.1" or split.port is None:
            raise ValueError("acceptance HTTP transport requires explicit loopback HTTP")
        self.base_url = base_url.rstrip("/")
        self.host = split.hostname
        self.port = split.port
        self.prefix = split.path.rstrip("/")
        self.timeout_seconds = timeout_seconds

    def request(self, method: str, path: str, body: object, headers: Mapping[str, str]) -> Response:
        if not path.startswith("/") or "://" in path:
            raise ValueError("request path must remain on the loopback origin")
        payload = None if body is NO_BODY else json.dumps(body, separators=(",", ":")).encode()
        connection = http.client.HTTPConnection(self.host, self.port, timeout=self.timeout_seconds)
        try:
            connection.request(method, self.prefix + path, body=payload, headers=dict(headers))
            raw = connection.getresponse()
            data = raw.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise AssertionError("HTTP response exceeded acceptance bound")
            content_type = raw.headers.get("Content-Type", "").split(";", 1)[0]
            parsed: object
            if not data:
                parsed = None
            elif content_type == "application/json":
                parsed = json.loads(data)
            else:
                parsed = data.decode("utf-8", errors="replace")
            response_headers = {key.lower(): value for key, value in raw.headers.items()}
            return Response(raw.status, response_headers, parsed)
        finally:
            connection.close()


class FixtureControl:
    def __init__(self, base_url: str):
        self.transport = LoopbackTransport(base_url, 10)

    def observation(self) -> JsonObject:
        response = self.transport.request("GET", "/__fixture/observation", NO_BODY, {})
        if response.status != 200 or not isinstance(response.json, dict):
            raise AssertionError(f"fixture observation failed with HTTP {response.status}")
        return response.json

    def model(self, kind: str, content: str, hold: bool) -> None:
        self.post("/__fixture/model", {"kind": kind, "content": content, "hold": hold})

    def release_model(self) -> None:
        self.post("/__fixture/model/release", {})

    def oauth(self, mode: str) -> None:
        self.post("/__fixture/oauth", {"mode": mode})

    def external_proposal(self, forge: str, project: str, state: str, marker: str) -> None:
        self.post("/__fixture/proposal", {"forge": forge, "project": project, "state": state, "marker": marker})

    def post(self, path: str, body: JsonObject) -> None:
        response = self.transport.request("POST", path, body, {"Content-Type": "application/json"})
        if response.status != 200:
            raise AssertionError(f"fixture control failed with HTTP {response.status}")

    def project(self, forge: str, project: str) -> JsonObject:
        observation = self.observation()
        projects = observation.get("projects")
        if not isinstance(projects, list):
            raise AssertionError("fixture project observation missing")
        for candidate in projects:
            if isinstance(candidate, dict) and candidate.get("forge") == forge and candidate.get("project") == project:
                return candidate
        raise AssertionError("fixture project not found")

    def proposals(self, forge: str, project: str) -> list[JsonObject]:
        values = self.project(forge, project).get("proposals")
        if not isinstance(values, list) or not all(isinstance(value, dict) for value in values):
            raise AssertionError("fixture proposal observation missing")
        return values


class ApiSession:
    def __init__(self, base_url: str, login: str, user_id: str, password: str):
        self.transport = LoopbackTransport(base_url, 15)
        self.base_url = base_url
        self.login_name = login
        self.user_id = user_id
        self.password = password
        self.cookie = ""

    def login(self) -> JsonObject:
        self.cookie = ""
        response = self.transport.request(
            "POST", "/api/login", {"login": self.login_name, "password": self.password},
            {"Origin": self.base_url, "Content-Type": "application/json", "X-Rites-Version": "0.2.0"},
        )
        if response.status != 200 or not isinstance(response.json, dict):
            raise AssertionError(f"login failed with HTTP {response.status}")
        set_cookie = response.headers.get("set-cookie")
        if set_cookie is None:
            raise AssertionError("login response did not issue a session cookie")
        parsed = SimpleCookie()
        parsed.load(set_cookie)
        morsel = parsed.get("rites_session")
        if morsel is None or not morsel.value:
            raise AssertionError("login response did not contain a nonempty Rites session")
        if morsel["httponly"] is None or morsel["samesite"].lower() != "strict" or morsel["path"] != "/":
            raise AssertionError("session cookie lacks required browser protections")
        self.cookie = f"rites_session={morsel.value}"
        return response.json

    def request(self, method: str, path: str, body: object, expected_status: int | set[int], authenticated: bool) -> Response:
        headers = {"Origin": self.base_url, "X-Rites-Version": "0.2.0", "Accept": "application/json"}
        if authenticated:
            if not self.cookie:
                raise AssertionError("authenticated request requires a current session")
            headers["Cookie"] = self.cookie
            headers["X-Rites-User"] = self.user_id
        if body is not NO_BODY:
            headers["Content-Type"] = "application/json"
        response = self.transport.request(method, path, body, headers)
        expected = {expected_status} if isinstance(expected_status, int) else expected_status
        if response.status not in expected:
            code = response.json.get("code") if isinstance(response.json, dict) else "non-json"
            raise AssertionError(f"{method} {path}: expected HTTP {sorted(expected)}, got {response.status} ({code})")
        if authenticated and response.status < 400 and response.headers.get("x-rites-user") != self.user_id:
            raise AssertionError(f"{method} {path}: authenticated actor echo missing or incorrect")
        return response

    def object(self, method: str, path: str, body: object, expected_status: int | set[int] = 200, authenticated: bool = True) -> JsonObject:
        response = self.request(method, path, body, expected_status, authenticated)
        if not isinstance(response.json, dict):
            raise AssertionError(f"{method} {path}: expected JSON object")
        return response.json

    def logout(self) -> None:
        self.object("POST", "/api/logout", {})
        self.cookie = ""

    def run(self, run_id: str) -> JsonObject:
        result = self.object("GET", f"/api/runs/{run_id}", NO_BODY)
        run = result.get("run")
        if not isinstance(run, dict):
            raise AssertionError("run response has no run object")
        return run

    def manual(self, repository_id: str, rite_id: str, request_id: str, expected_status: int | set[int] = 200) -> JsonObject:
        result = self.object("POST", "/api/runs", {
            "repositoryId": repository_id, "riteId": rite_id, "requestId": request_id,
        }, expected_status=expected_status)
        run = result.get("run")
        if isinstance(expected_status, int) and expected_status == 200 and not isinstance(run, dict):
            raise AssertionError("manual run response has no run object")
        return run if isinstance(run, dict) else result
