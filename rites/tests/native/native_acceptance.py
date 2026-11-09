"""Controlled native Rites acceptance over real PG, Pi worker, bwrap and Git HTTP."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Callable, Mapping

from client import ApiSession, FixtureControl, JsonObject, NO_BODY, Response
from fixtures import FORGE_KEY, FORGE_PROJECTS, OPERATOR_CLIENT, OPERATOR_SECRET, PROBE_DENIALS, REDIRECT_PATH, FixtureServer, model_config


TERMINAL_STATES = frozenset({"NoChange", "Published", "Failed", "PublicationUncertain", "SupersessionPending", "Cancelled"})
SYNTHETIC_SECRET = re.compile(r"(?:(?:synthetic|fixture)-(?:[a-z0-9]+-)*(?:token|key|secret|password|access-[0-9]+|refresh-[0-9]+)(?:[a-z0-9-]*)|(?:owner|editor|viewer)-password)", re.IGNORECASE)
BEARER = re.compile(r"(?i)(bearer\s+)[^\s,;\"']+")


def sanitize(text: str) -> str:
    return BEARER.sub(r"\1[REDACTED]", SYNTHETIC_SECRET.sub("[REDACTED]", text))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_private(path: Path, content: str | bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, str):
        path.write_text(content, encoding="utf-8")
    else:
        path.write_bytes(content)
    path.chmod(0o600)


def free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def expect_keys(value: JsonObject, expected: set[str], label: str) -> None:
    if set(value) != expected:
        raise AssertionError(f"{label} fields differ from current schema")


def object_list(value: JsonObject, field_name: str) -> list[JsonObject]:
    items = value.get(field_name)
    if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
        raise AssertionError(f"missing object list: {field_name}")
    return items


@dataclass
class CommandRecord:
    argv: list[str]
    cwd: str
    returnCode: int | None
    durationSeconds: float


@dataclass
class CaseRecord:
    name: str
    outcome: str = "passed"
    detail: str = ""
    durationSeconds: float = 0.0


class Reporter:
    def __init__(self, report_root: Path, native_launcher: Path, worker: Path, native_elf: Path, source_root: Path):
        self.root = report_root
        self.root.mkdir(parents=True, exist_ok=False)
        self.root.chmod(0o700)
        self.commands: list[CommandRecord] = []
        self.cases: list[CaseRecord] = []
        self.native_execution = "not-executed"
        self.started = datetime.now(timezone.utc)
        self.artifacts = {
            "nativeLauncher": str(native_launcher), "nativeLauncherSha256": sha256_file(native_launcher),
            "worker": str(worker), "workerSha256": sha256_file(worker),
            "nativeElf": str(native_elf), "nativeElfSha256": sha256_file(native_elf),
        }
        revision = subprocess.run(["git", "-C", str(source_root), "rev-parse", "HEAD"], capture_output=True, timeout=10, check=False)
        dirty = subprocess.run(["git", "-C", str(source_root), "status", "--porcelain", "--", "rites/tests/native", "rites/scripts/test-native.sh"], cwd=source_root, capture_output=True, timeout=10, check=False)
        self.source = {
            "root": str(source_root),
            "revision": revision.stdout.decode().strip() if revision.returncode == 0 else "unavailable",
            "ownedPathsDirtyAtStart": dirty.returncode != 0 or bool(dirty.stdout.strip()),
        }

    def command(self, argv: list[str], cwd: Path, input_bytes: bytes, env: Mapping[str, str] | None, timeout: int) -> subprocess.CompletedProcess[bytes]:
        started = time.monotonic()
        try:
            result = subprocess.run(argv, cwd=cwd, input=input_bytes, env=dict(env) if env is not None else None, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
            self.commands.append(CommandRecord(argv=list(argv), cwd=str(cwd), returnCode=result.returncode, durationSeconds=time.monotonic() - started))
            if result.returncode != 0:
                diagnostic = sanitize(result.stderr.decode(errors="replace")[-2000:])
                raise RuntimeError(f"command failed ({result.returncode}): {Path(argv[0]).name}: {diagnostic}")
            return result
        except subprocess.TimeoutExpired:
            self.commands.append(CommandRecord(argv=list(argv), cwd=str(cwd), returnCode=None, durationSeconds=time.monotonic() - started))
            raise RuntimeError(f"command deadline exceeded: {Path(argv[0]).name}")

    def case(self, name: str, operation: Callable[[], None]) -> None:
        record = CaseRecord(name=name)
        started = time.monotonic()
        try:
            operation()
            record.outcome = "passed"
        except AssertionError as error:
            record.outcome = "failed"
            record.detail = sanitize(str(error))
        except Exception as error:
            record.outcome = "error"
            record.detail = sanitize(f"{type(error).__name__}: {error}")
        record.durationSeconds = time.monotonic() - started
        self.cases.append(record)

    def log(self, name: str, content: str) -> None:
        write_private(self.root / name, sanitize(content))

    def finish(self) -> None:
        failures = sum(case.outcome == "failed" for case in self.cases)
        errors = sum(case.outcome == "error" for case in self.cases)
        document = {
            "schema": "rites-native-acceptance-report-v1",
            "startedAt": self.started.isoformat(), "finishedAt": datetime.now(timezone.utc).isoformat(),
            "source": self.source, "artifacts": self.artifacts,
            "counts": {"tests": len(self.cases), "failures": failures, "errors": errors, "skipped": 0, "passed": len(self.cases) - failures - errors},
            "cases": [asdict(case) for case in self.cases],
            "commands": [asdict(command) for command in self.commands],
            "networkPolicy": "loopback-owned-fixtures-only",
            "nativeExecution": self.native_execution,
        }
        write_private(self.root / "report.json", json.dumps(document, indent=2, sort_keys=True) + "\n")
        suite = ET.Element("testsuite", {
            "name": "rites-native-acceptance", "tests": str(len(self.cases)),
            "failures": str(failures), "errors": str(errors), "skipped": "0",
        })
        for case in self.cases:
            element = ET.SubElement(suite, "testcase", {"name": case.name, "time": f"{case.durationSeconds:.3f}"})
            if case.outcome != "passed":
                child = ET.SubElement(element, "failure" if case.outcome == "failed" else "error")
                child.set("message", case.detail[:1000])
        ET.ElementTree(suite).write(self.root / "junit.xml", encoding="utf-8", xml_declaration=True)
        (self.root / "junit.xml").chmod(0o600)
        print(json.dumps({"report": str(self.root), "counts": document["counts"]}, sort_keys=True))


class OwnedPostgres:
    def __init__(self, runtime: Path, port: int, reporter: Reporter):
        self.postgres_home = Path(os.environ.get("POSTGRES_HOME", ""))
        if not self.postgres_home.is_absolute():
            raise RuntimeError("POSTGRES_HOME must identify the pinned Nix PostgreSQL installation")
        for executable in ("initdb", "pg_ctl", "psql", "createdb"):
            if not (self.postgres_home / "bin" / executable).is_file():
                raise RuntimeError(f"pinned PostgreSQL executable unavailable: {executable}")
        self.runtime = runtime
        self.data = runtime / "pg-data"
        self.socket = runtime / "pg-socket"
        self.socket.mkdir()
        self.port = port
        self.reporter = reporter
        self.user = "rites_native"
        self.database = "rites_native"
        self.password = "synthetic-database-password"
        self.password_file = runtime / "database-password"
        write_private(self.password_file, self.password + "\n")
        self.marker = self.data / ".rites-native-owned"
        self.started = False

    def binary(self, name: str) -> str:
        return str(self.postgres_home / "bin" / name)

    def environment(self) -> dict[str, str]:
        return {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "PGPASSWORD": self.password,
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
        }

    def run(self, name: str, arguments: list[str], timeout: int) -> subprocess.CompletedProcess[bytes]:
        return self.reporter.command([self.binary(name), *arguments], self.runtime, b"", self.environment(), timeout)

    def start(self) -> None:
        self.run("initdb", [
            "--pgdata", str(self.data), "--username", self.user,
            "--auth-local", "scram-sha-256", "--auth-host", "scram-sha-256",
            "--pwfile", str(self.password_file), "--set", "password_encryption=scram-sha-256", "--no-instructions",
        ], 60)
        write_private(self.marker, "owned fresh Rites native acceptance cluster\n")
        options = f"-F -p {self.port} -k {self.socket} -h 127.0.0.1"
        self.run("pg_ctl", ["--pgdata", str(self.data), "--log", str(self.runtime / "postgres.log"), "--options", options, "--wait", "start"], 60)
        self.started = True
        common = ["--host", "127.0.0.1", "--port", str(self.port), "--username", self.user, "--dbname", "postgres", "--no-password", "--tuples-only", "--no-align"]
        actual = self.run("psql", [*common, "--command", "SHOW data_directory"], 15).stdout.decode().strip()
        if not actual or Path(actual).resolve() != self.data.resolve() or not self.marker.is_file():
            raise RuntimeError("refusing PostgreSQL cluster whose data_directory is not the owned fresh directory")
        scram = self.run("psql", [*common, "--command", "SELECT rolpassword FROM pg_authid WHERE rolname='rites_native'"], 15).stdout.decode().strip()
        if not scram.startswith("SCRAM-SHA-256$"):
            raise RuntimeError("fresh PostgreSQL role does not use SCRAM authentication")
        self.run("createdb", ["--host", "127.0.0.1", "--port", str(self.port), "--username", self.user, "--no-password", self.database], 30)

    @property
    def jdbc_url(self) -> str:
        return f"jdbc:postgresql://127.0.0.1:{self.port}/{self.database}"

    def stop(self) -> None:
        if self.started and self.marker.is_file() and self.data.resolve().parent == self.runtime.resolve():
            self.reporter.command([self.binary("pg_ctl"), "--pgdata", str(self.data), "--wait", "--mode", "fast", "stop"], self.runtime, b"", self.environment(), 30)
            self.started = False


class NativeAcceptance:
    def __init__(self, launcher: Path, worker: Path, native_elf: Path, report_namespace: str = "native-validation-runs"):
        self.source_root = Path(__file__).resolve().parents[3]
        self.rites_root = self.source_root / "rites"
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        report_root = self.rites_root / "server/target" / report_namespace / f"{stamp}-{os.getpid()}"
        self.reporter = Reporter(report_root, launcher, worker, native_elf, self.source_root)
        self.runtime_path = Path(tempfile.mkdtemp(prefix="rites-native-acceptance-"))
        self.runtime_path.chmod(0o700)
        self.launcher = launcher
        self.worker = worker
        self.native_elf = native_elf
        self.fixtures: FixtureServer | None = None
        self.control: FixtureControl | None = None
        self.postgres: OwnedPostgres | None = None
        self.native_process: subprocess.Popen[bytes] | None = None
        self.native_log_path = self.runtime_path / "native.raw.log"
        self.git_trace_path = self.runtime_path / "native-git.trace"
        self.native_log_handle = None
        # Replaced with the allocated native origin before any request is made.
        pending_origin = "http://127.0.0.1:1"
        self.owner = ApiSession(pending_origin, "owner", "owner", "owner-password")
        self.editor = ApiSession(pending_origin, "editor", "editor", "editor-password")
        self.viewer = ApiSession(pending_origin, "viewer", "viewer", "viewer-password")
        self.credentials: dict[str, str] = {}
        self.repositories: dict[str, JsonObject] = {}
        self.github_first: JsonObject = {}
        self.github_second: JsonObject = {}
        self.gitlab_first: JsonObject = {}
        self.native_base = ""
        self.web_root: Path | None = None

    def start(self) -> None:
        for artifact in (self.launcher, self.worker, self.native_elf):
            if not artifact.is_file() or not os.access(artifact, os.X_OK):
                raise RuntimeError(f"required executable artifact is invalid: {artifact}")
        with self.native_elf.open("rb") as elf:
            if elf.read(4) != b"\x7fELF":
                raise RuntimeError("NATIVE_ELF is not an actual ELF artifact")
        self.fixtures = FixtureServer(self.runtime_path / "fixtures")
        self.fixtures.start()
        self.control = FixtureControl(self.fixtures.base_url)
        self.postgres = OwnedPostgres(self.runtime_path, free_loopback_port(), self.reporter)
        self.postgres.start()
        self.native_base = f"http://127.0.0.1:{free_loopback_port()}"
        for session in (self.owner, self.editor, self.viewer):
            fresh = ApiSession(self.native_base, session.login_name, session.user_id, session.password)
            if session.user_id == "owner":
                self.owner = fresh
            elif session.user_id == "editor":
                self.editor = fresh
            else:
                self.viewer = fresh
        config = self.write_config()
        self.reporter.command([str(self.launcher), "check-config", str(config)], self.runtime_path, b"", None, 30)
        self.reporter.command([str(self.launcher), "migrate", str(config)], self.runtime_path, b"", None, 60)
        real_git = shutil.which("git")
        if real_git is None:
            raise RuntimeError("real Git executable unavailable for native acceptance")
        monitor_bin = self.runtime_path / "monitor-bin"
        monitor_bin.mkdir()
        monitored_git = monitor_bin / "git"
        monitor_script = "#!/bin/sh\n{\nprintf 'git'\nfor argument in \"$@\"; do printf ' %s' \"$argument\"; done\nprintf '\\n'\n} >> " + str(self.git_trace_path) + "\nexec " + real_git + " \"$@\"\n"
        write_private(monitored_git, monitor_script)
        monitored_git.chmod(0o700)
        native_environment = {
            "PATH": str(monitor_bin) + os.pathsep + os.environ.get("PATH", "/usr/bin:/bin"),
            "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
        }
        self.native_log_handle = self.native_log_path.open("wb")
        self.native_process = subprocess.Popen(
            [str(self.launcher), "serve", str(config)], cwd=self.runtime_path,
            stdin=subprocess.DEVNULL, stdout=self.native_log_handle, stderr=subprocess.STDOUT,
            start_new_session=True, env=native_environment,
        )
        self.wait_ready()
        executable = Path(f"/proc/{self.native_process.pid}/exe").resolve()
        if not executable.samefile(self.native_elf):
            raise RuntimeError("native serve PID does not resolve to the supplied NATIVE_ELF")
        self.reporter.native_execution = "executed"
        for session in (self.owner, self.editor, self.viewer):
            session.login()

    def write_config(self) -> Path:
        if self.fixtures is None or self.postgres is None:
            raise RuntimeError("fixtures must start before configuration")
        secret_root = self.runtime_path / "private"
        users = []
        for session in (self.owner, self.editor, self.viewer):
            result = self.reporter.command([str(self.launcher), "password-hash"], self.runtime_path, (session.password + "\n").encode(), None, 30)
            password_hash = secret_root / f"{session.user_id}-password-hash"
            write_private(password_hash, result.stdout)
            users.append({"id": session.user_id, "login": session.login_name, "passwordHashFile": str(password_hash), "enabled": True})
        model_file = secret_root / "model.json"
        write_private(model_file, json.dumps(model_config(self.fixtures.base_url), separators=(",", ":")))
        master_key = secret_root / "master-key"
        write_private(master_key, secrets.token_urlsafe(32))
        client_secret = secret_root / "operator-client-secret"
        write_private(client_secret, OPERATOR_SECRET)
        database_password = self.postgres.password_file
        workspace = self.runtime_path / "workspaces"
        cache = self.runtime_path / "git-cache"
        config = {
            "listenHost": "127.0.0.1", "listenPort": int(self.native_base.rsplit(":", 1)[1]),
            "allowedOrigin": self.native_base, "secureCookies": False, "allowInsecureHttp": True,
            "jdbcUrl": self.postgres.jdbc_url, "databaseUser": self.postgres.user,
            "databasePasswordFile": str(database_password),
            "databaseLimits": {
                "maxConnections": 8, "maxQueued": 32, "queueTimeoutMs": 5000, "connectTimeoutMs": 5000,
                "statementTimeoutMs": 10000, "lockTimeoutMs": 5000, "idleTransactionTimeoutMs": 10000, "socketTimeoutMs": 15000,
            },
            "users": users, "masterKeyFile": str(master_key), "workerCommand": str(self.worker),
            "webRoot": str(self.web_root) if self.web_root is not None else None,
            "workspaceRoot": str(workspace), "cacheRoot": str(cache),
            "maxBodyBytes": 65536, "sessionTtlSeconds": 3600, "maxPromptBytes": 65536,
            "maxFileBytes": 1048576, "maxRunFiles": 1000,
            "scheduler": {"pollMilliseconds": 100, "queueBound": 32, "concurrency": 1, "runTimeoutSeconds": 90},
            "forges": [
                {"kind": "Github", "host": "127.0.0.1", "apiBase": self.fixtures.base_url + "/github/api/v3", "cloneBase": self.fixtures.base_url + "/github/git"},
                {"kind": "Gitlab", "host": "127.0.0.1", "apiBase": self.fixtures.base_url + "/gitlab/api/v4", "cloneBase": self.fixtures.base_url + "/gitlab/git"},
            ],
            "models": [{"id": "fixture", "provider": "fixture", "model": "fixture-model", "thinkingLevel": "off", "configFile": str(model_file)}],
            "oauthClients": [{
                "id": OPERATOR_CLIENT, "host": "127.0.0.1", "label": "Synthetic fixture operator",
                "tokenEndpoint": self.fixtures.base_url + "/gitlab/oauth/token", "clientId": OPERATOR_CLIENT,
                "clientSecretFile": str(client_secret), "redirectUri": self.fixtures.base_url + REDIRECT_PATH,
                "expiryLeadSeconds": 300,
            }],
            "testMode": True,
        }
        path = self.runtime_path / "config.json"
        write_private(path, json.dumps(config, indent=2, sort_keys=True))
        return path

    def wait_ready(self) -> None:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if self.native_process is None or self.native_process.poll() is not None:
                raise RuntimeError("native server exited before readiness")
            response: Response | None = None
            try:
                response = self.owner.transport.request("GET", "/api/version", NO_BODY, {"X-Rites-Version": "0.2.0"})
            except (OSError, ConnectionError):
                pass
            if response is not None and response.status == 200:
                return
            time.sleep(0.1)
        raise RuntimeError("native server readiness deadline exceeded")

    def controls(self) -> FixtureControl:
        if self.control is None:
            raise RuntimeError("fixtures unavailable")
        return self.control

    def wait_terminal(self, session: ApiSession, run: JsonObject) -> JsonObject:
        run_id = run.get("id")
        if not isinstance(run_id, str):
            raise AssertionError("manual run lacks UUID")
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            current = session.run(run_id)
            state = current.get("state")
            if state in TERMINAL_STATES:
                return current
            if state not in {"Queued", "Running"}:
                raise AssertionError("unknown run state")
            if self.native_process is not None and self.native_process.poll() is not None:
                raise AssertionError("native server exited while run was active")
            time.sleep(0.15)
        raise AssertionError("run terminal-state deadline exceeded")

    def create_credential(self, forge: str, mode: str) -> str:
        oauth = mode == "Oauth"
        body = {
            "id": None, "name": f"fixture-{forge.lower()}", "forge": forge, "host": "127.0.0.1",
            "secret": "synthetic-oauth-access-0" if oauth else FORGE_KEY,
            "expectedRevision": 0, "mode": mode,
            "oauthClientId": OPERATOR_CLIENT if oauth else None,
            "refreshToken": "synthetic-oauth-refresh-0" if oauth else None,
            "expiresAt": "2000-01-01T00:00:00Z" if oauth else None,
        }
        credential = self.owner.object("PUT", "/api/credentials", body)["credential"]
        if not isinstance(credential, dict):
            raise AssertionError("credential result missing")
        expect_keys(credential, {"id", "name", "forge", "host", "revision", "createdAt", "updatedAt", "mode", "oauthClientId", "expiresAt", "refreshHealth"}, "CredentialInfo")
        if credential.get("revision") != 1 or credential.get("mode") != mode or not isinstance(credential.get("id"), str):
            raise AssertionError("new credential identity or revision invalid")
        serialized = json.dumps(credential)
        if "secret" in serialized or "synthetic-oauth-access-0" in serialized or "synthetic-github-token" in serialized:
            raise AssertionError("credential API echoed secret material")
        return credential["id"]

    def case_sessions_and_metadata(self) -> None:
        public = self.owner.object("GET", "/api/version", NO_BODY, authenticated=False)
        if public != {"current": "0.2.0", "minimum": "0.2.0", "supported": ["0.2.0"]}:
            raise AssertionError("API version mismatch")
        me = self.owner.object("GET", "/api/me", NO_BODY)
        if me != {"id": "owner", "login": "owner"}:
            raise AssertionError("owner identity mismatch")
        models = object_list(self.owner.object("GET", "/api/models", NO_BODY), "items")
        if models != [{"id": "fixture", "provider": "fixture", "model": "fixture-model", "thinkingLevel": "off"}]:
            raise AssertionError("selected model metadata mismatch")
        users = object_list(self.owner.object("GET", "/api/users", NO_BODY), "items")
        if {item.get("id") for item in users} != {"owner", "editor", "viewer"}:
            raise AssertionError("static users unavailable")
        clients = object_list(self.owner.object("GET", "/api/oauth-clients", NO_BODY), "items")
        if len(clients) != 1 or clients[0].get("id") != OPERATOR_CLIENT:
            raise AssertionError("OAuth client metadata unavailable")
        status = self.owner.object("GET", "/api/status", NO_BODY)
        expect_keys(status, {"queuedRuns", "activeRuns", "schedulerEnabled"}, "StatusInfo")
        self.owner.cookie = "rites_session=definitely-invalid"
        self.owner.object("GET", "/api/me", NO_BODY, expected_status=401)
        self.owner.cookie = ""
        self.owner.login()
        revoked_session = self.owner.cookie
        self.owner.logout()
        self.owner.cookie = revoked_session
        self.owner.object("GET", "/api/me", NO_BODY, expected_status=401)
        self.owner.login()

    def case_credentials_repositories_and_grants(self) -> None:
        self.credentials["Github"] = self.create_credential("Github", "Token")
        self.credentials["Gitlab"] = self.create_credential("Gitlab", "Oauth")
        own = object_list(self.owner.object("GET", "/api/credentials", NO_BODY), "items")
        other = object_list(self.editor.object("GET", "/api/credentials", NO_BODY), "items")
        if len(own) != 2 or other:
            raise AssertionError("credential ownership isolation failed")
        forge_by_id = {item.get("id"): item.get("forge") for item in own}
        for forge, project in FORGE_PROJECTS.items():
            body = {
                "id": forge.lower(), "forge": forge, "host": "127.0.0.1", "project": project,
                "baseBranch": "main", "credentialId": self.credentials[forge], "expectedRevision": 0,
            }
            saved = self.owner.object("PUT", "/api/repositories", body)["repository"]
            if not isinstance(saved, dict):
                raise AssertionError("repository result missing")
            repository = saved
            for user_id, role in (("editor", "Editor"), ("viewer", "Viewer")):
                granted = self.owner.object("POST", "/api/grants", {
                    "repositoryId": repository["id"], "userId": user_id, "role": role,
                    "expectedRevision": repository["revision"],
                })["repository"]
                if not isinstance(granted, dict):
                    raise AssertionError("grant result missing")
                repository = granted
            self.repositories[forge] = repository
            rite = self.editor.object("PUT", "/api/rites", {
                "repositoryId": repository["id"], "id": "site", "schedule": "0 0 1 1 *",
                "promptPath": "prompt.md", "modelId": "fixture", "enabled": True, "expectedRevision": 0,
            })["rite"]
            if not isinstance(rite, dict) or rite.get("revision") != 1:
                raise AssertionError("editor could not create rite")
            self.viewer.manual(str(repository["id"]), "site", str(uuid.uuid4()), expected_status={403, 404})
            self.controls().external_proposal(forge, project, "merged", "rites-run:00000000-0000-0000-0000-000000000001")
            self.controls().external_proposal(forge, project, "open", "rites-run:00000000-0000-0000-0000-000000000002")
        if forge_by_id.get(self.credentials["Github"]) != "Github" or forge_by_id.get(self.credentials["Gitlab"]) != "Gitlab":
            raise AssertionError("credential forge binding mismatch")

    def manual_and_wait(self, forge: str, content: str, kind: str = "write") -> JsonObject:
        self.controls().model(kind, content, False)
        repository_id = forge.lower()
        run = self.owner.manual(repository_id, "site", str(uuid.uuid4()))
        if not run:
            raise AssertionError("manual run failed")
        return self.wait_terminal(self.owner, run)

    def assert_publication(self, forge: str, run: JsonObject, content: str) -> JsonObject:
        if run.get("state") != "Published" or run.get("failureCode") is not None:
            oauth = self.controls().observation()["oauth"]
            raise AssertionError(f"run did not publish: state={run.get('state')} failure={run.get('failureCode')} oauth={oauth}")
        project = self.controls().project(forge, FORGE_PROJECTS[forge])
        if run.get("baseRevision") != project.get("baseRevision") or run.get("promptDigest") != project.get("promptDigest"):
            raise AssertionError("run did not record fresh base and exact prompt digest")
        branch = run.get("branch")
        if not isinstance(branch, str) or not branch.endswith(str(run.get("id"))) or not branch.startswith(f"rites/{forge.lower()}/site/"):
            raise AssertionError("publication branch is not bound to run identity")
        candidates = [proposal for proposal in self.controls().proposals(forge, FORGE_PROJECTS[forge]) if proposal.get("head", {}).get("ref") == branch or proposal.get("source_branch") == branch]
        if len(candidates) != 1:
            raise AssertionError("real remote proposal does not match publication branch")
        proposal = candidates[0]
        marker = proposal.get("body") if forge == "Github" else proposal.get("description")
        if not isinstance(marker, str) or f"rites-run:{run['id']}" not in marker.splitlines() or "base-target:main" not in marker.splitlines():
            raise AssertionError("proposal ownership marker or base target missing")
        if run.get("proposalUrl") != proposal.get("html_url" if forge == "Github" else "web_url"):
            raise AssertionError("proposal URL was not recorded")
        bare = self.runtime_path / "fixtures/repositories" / f"{FORGE_PROJECTS[forge]}.git"
        result = self.reporter.command(["git", "--git-dir", str(bare), "show", f"{branch}:result.txt"], self.runtime_path, b"", None, 15)
        if result.stdout.decode() != content:
            raise AssertionError("real remote branch does not contain the SDK tool write")
        return proposal

    def case_workspace_inference_credential_denied(self) -> None:
        # Regression: the coordinator must never place MODEL_CONFIG in the
        # canonical workspace mounted into every brokered tool sandbox.
        self.controls().model("credential-probe", "", False)
        admitted = self.owner.manual("github", "site", str(uuid.uuid4()))
        terminal = self.wait_terminal(self.owner, admitted)
        observation = self.controls().observation()
        model = observation["model"]
        witnesses = model.get("witnesses")
        if any("+EXPOSED:" in witness or "+ERROR:" in witness for witness in witnesses):
            raise AssertionError(f"credential content EXPOSED or probe failed in /workspace: {witnesses}")
        if witnesses != list(PROBE_DENIALS):
            git_evidence = [event for event in observation.get("events", []) if event.get("event") == "git-auth"]
            raise AssertionError(f"credential probe lacked DENIED witness: state={terminal.get('state')} failure={terminal.get('failureCode')} modelCalls={model.get('calls')} git={git_evidence}")
        if model.get("emittedTools") != ["rites_bash", "rites_write"]:
            raise AssertionError("credential guard did not execute the scripted brokered tools")
        self.assert_publication("Github", terminal, "PROBE_EXECUTED+DENIED:credential-content\nPROBE_EXECUTED+DENIED:.rites-model.json\n")

    def case_github_publishes_real_branch_and_pr(self) -> None:
        before_model_calls = self.controls().observation()["model"]["calls"]
        self.controls().model("write", "github-first\n", False)
        request_id = str(uuid.uuid4())
        admitted = self.owner.manual("github", "site", request_id)
        if not admitted:
            raise AssertionError("first GitHub run not admitted")
        replay = self.owner.manual("github", "site", request_id)
        if replay.get("id") != admitted.get("id"):
            raise AssertionError("idempotent retry created another run")
        self.github_first = self.wait_terminal(self.owner, admitted)
        self.assert_publication("Github", self.github_first, "github-first\n")
        observation = self.controls().observation()
        model = observation.get("model")
        if not isinstance(model, dict) or model.get("calls") != before_model_calls + 2:
            raise AssertionError("exact request retry repeated agent work")
        tool_sets = model.get("toolSets")
        if isinstance(tool_sets, list):
            tool_sets = tool_sets[-2:]
        if tool_sets != [["rites_bash", "rites_edit", "rites_find", "rites_grep", "rites_ls", "rites_read", "rites_write"], ["rites_bash", "rites_edit", "rites_find", "rites_grep", "rites_ls", "rites_read", "rites_write"]]:
            raise AssertionError("actual SDK did not expose exactly the seven brokered tools")
        viewer_run = self.viewer.run(str(admitted["id"]))
        if viewer_run.get("proposalUrl") != self.github_first.get("proposalUrl"):
            raise AssertionError("viewer cannot read published run metadata")

    def case_github_creates_replacement_before_closing_old(self) -> None:
        self.github_second = self.manual_and_wait("Github", "github-second\n")
        new = self.assert_publication("Github", self.github_second, "github-second\n")
        old_branch = self.github_first.get("branch")
        proposals = self.controls().proposals("Github", FORGE_PROJECTS["Github"])
        old = next(proposal for proposal in proposals if proposal.get("head", {}).get("ref") == old_branch)
        if old.get("state") != "closed" or new.get("state") != "open":
            raise AssertionError("old proposal was not closed after replacement")
        new_id = new.get("number")
        old_id = old.get("number")
        events = [event for event in self.controls().observation()["events"] if event.get("forge") == "Github"]
        create_index = next(index for index, event in enumerate(events) if event.get("event") == "create" and event.get("id") == new_id)
        close_index = next(index for index, event in enumerate(events) if event.get("event") == "close" and event.get("id") == old_id)
        if create_index >= close_index:
            raise AssertionError("predecessor closed before replacement creation")

    def case_nochange_and_partial_error_leave_predecessor_open(self) -> None:
        nochange = self.manual_and_wait("Github", "", "nochange")
        if nochange.get("state") != "NoChange":
            raise AssertionError(f"no-change run state incorrect: {nochange.get('state')}")
        failed = self.manual_and_wait("Github", "should-not-publish\n", "partial-error")
        if failed.get("state") != "Failed" or failed.get("failureCode") != "agent-failed":
            raise AssertionError(f"partial model error was not bounded failure: {failed.get('state')}/{failed.get('failureCode')}")
        proposals = self.controls().proposals("Github", FORGE_PROJECTS["Github"])
        current = next(proposal for proposal in proposals if proposal.get("head", {}).get("ref") == self.github_second.get("branch"))
        if current.get("state") != "open":
            raise AssertionError("failed or unchanged run closed predecessor")
        failed_branch = failed.get("branch")
        if failed_branch is not None and any(proposal.get("head", {}).get("ref") == failed_branch for proposal in proposals):
            raise AssertionError("partial model error published a proposal")

    def assert_oauth_ciphertext_persisted(self) -> None:
        if self.postgres is None:
            raise AssertionError("owned PostgreSQL unavailable for encrypted persistence audit")
        result = self.postgres.run("psql", [
            "--host", "127.0.0.1", "--port", str(self.postgres.port), "--username", self.postgres.user,
            "--dbname", self.postgres.database, "--no-password", "--tuples-only", "--no-align",
            "--command", "SELECT octet_length(ciphertext),coalesce(octet_length(refresh_ciphertext),0) FROM rt_credentials WHERE mode='Oauth'",
        ], 15)
        rows = [row for row in result.stdout.decode().splitlines() if row]
        if len(rows) != 1:
            raise AssertionError("expected one encrypted GitLab credential row")
        access_length, refresh_length = (int(value) for value in rows[0].split("|"))
        if access_length < 32 or refresh_length < 32:
            raise AssertionError("OAuth access/refresh ciphertext was not persisted")

    def case_gitlab_refresh_and_publication(self) -> None:
        before = self.controls().observation()["oauth"]
        self.gitlab_first = self.manual_and_wait("Gitlab", "gitlab-first\n")
        self.assert_publication("Gitlab", self.gitlab_first, "gitlab-first\n")
        after = self.controls().observation()["oauth"]
        if before.get("generation") != 0 or after.get("generation") != 1 or after.get("refreshCalls") != 1:
            raise AssertionError("expired GitLab pair was not refreshed exactly once")
        credential = next(item for item in object_list(self.owner.object("GET", "/api/credentials", NO_BODY), "items") if item.get("id") == self.credentials["Gitlab"])
        if credential.get("refreshHealth") != "Healthy" or credential.get("revision") != 1:
            raise AssertionError("rotated OAuth pair did not persist under encrypted credential identity")
        self.assert_oauth_ciphertext_persisted()

    def case_oauth_uncertainty_blocks_blind_retry_until_replacement(self) -> None:
        before = self.controls().observation()
        before_calls = before["oauth"]["refreshCalls"]
        before_model = before["model"]["calls"]
        current = next(item for item in object_list(self.owner.object("GET", "/api/credentials", NO_BODY), "items") if item.get("id") == self.credentials["Gitlab"])
        self.owner.object("PUT", "/api/credentials", {
            "id": self.credentials["Gitlab"], "name": "fixture-gitlab", "forge": "Gitlab", "host": "127.0.0.1",
            "secret": "synthetic-oauth-access-1", "expectedRevision": current["revision"], "mode": "Oauth",
            "oauthClientId": OPERATOR_CLIENT, "refreshToken": "synthetic-oauth-refresh-1", "expiresAt": "2000-01-01T00:00:00Z",
        })
        self.controls().oauth("drop-next")
        self.controls().model("write", "must-not-run-during-uncertainty\n", False)
        request_id = str(uuid.uuid4())
        admitted = self.owner.manual("gitlab", "site", request_id)
        failed = self.wait_terminal(self.owner, admitted)
        if failed.get("state") not in {"Failed", "PublicationUncertain"} or failed.get("failureCode") != "refresh-uncertain":
            raise AssertionError(f"lost OAuth refresh response did not become uncertain: {failed.get('state')}/{failed.get('failureCode')}")
        credential = next(item for item in object_list(self.owner.object("GET", "/api/credentials", NO_BODY), "items") if item.get("id") == self.credentials["Gitlab"])
        if credential.get("refreshHealth") != "Uncertain":
            raise AssertionError("OAuth uncertainty not exposed to owner")
        replay = self.owner.manual("gitlab", "site", request_id)
        replayed = self.wait_terminal(self.owner, replay)
        after_replay = self.controls().observation()
        if replayed.get("id") != failed.get("id") or after_replay["oauth"]["refreshCalls"] != before_calls + 1 or after_replay["model"]["calls"] != before_model:
            raise AssertionError("uncertain refresh was blindly retried or replayed agent work")
        replacement_generation = after_replay["oauth"]["generation"] + 1
        self.controls().oauth("replace")
        replaced = self.owner.object("PUT", "/api/credentials", {
            "id": self.credentials["Gitlab"], "name": "fixture-gitlab", "forge": "Gitlab", "host": "127.0.0.1",
            "secret": f"synthetic-replacement-access-{replacement_generation}", "expectedRevision": credential["revision"], "mode": "Oauth",
            "oauthClientId": OPERATOR_CLIENT, "refreshToken": f"synthetic-replacement-refresh-{replacement_generation}",
            "expiresAt": "2999-01-01T00:00:00Z",
        })["credential"]
        if not isinstance(replaced, dict) or replaced.get("refreshHealth") != "Healthy":
            raise AssertionError("owner OAuth replacement did not restore health")
        recovered = self.manual_and_wait("Gitlab", "gitlab-recovered\n")
        self.assert_publication("Gitlab", recovered, "gitlab-recovered\n")
        final = self.controls().observation()
        if final["oauth"]["refreshCalls"] != before_calls + 1:
            raise AssertionError("owner replacement unexpectedly reused refresh grant")
        old = next(proposal for proposal in self.controls().proposals("Gitlab", FORGE_PROJECTS["Gitlab"]) if proposal.get("source_branch") == self.gitlab_first.get("branch"))
        if old.get("state") != "closed":
            raise AssertionError("recovered run did not supersede its owned predecessor")

    def case_revocation_prevents_inflight_publication_and_replay(self) -> None:
        self.controls().model("write", "revoked-must-not-publish\n", True)
        request_id = str(uuid.uuid4())
        admitted = self.owner.manual("github", "site", request_id)
        if not admitted:
            raise AssertionError("held run was not admitted")
        deadline = time.monotonic() + 30
        while not self.controls().observation()["model"]["waiting"] and time.monotonic() < deadline:
            time.sleep(0.1)
        if not self.controls().observation()["model"]["waiting"]:
            raise AssertionError("model hold was not reached before revocation")
        proposals_before = len(self.controls().proposals("Github", FORGE_PROJECTS["Github"]))
        model_calls_before = self.controls().observation()["model"]["calls"]
        credential = next(item for item in object_list(self.owner.object("GET", "/api/credentials", NO_BODY), "items") if item.get("id") == self.credentials["Github"])
        self.owner.object("PUT", "/api/credentials", {
            "id": self.credentials["Github"], "name": "fixture-github", "forge": "Github", "host": "127.0.0.1",
            "secret": FORGE_KEY, "expectedRevision": credential["revision"], "mode": "Token",
            "oauthClientId": None, "refreshToken": None, "expiresAt": None,
        })
        self.controls().release_model()
        revoked = self.wait_terminal(self.owner, admitted)
        if revoked.get("state") not in {"Failed", "PublicationUncertain"} or revoked.get("failureCode") != "authorization-revoked":
            raise AssertionError(f"in-flight authority revocation ignored: {revoked.get('state')}/{revoked.get('failureCode')}")
        replay = self.owner.manual("github", "site", request_id)
        if replay.get("id") != admitted.get("id"):
            raise AssertionError("revoked run replay created replacement metadata")
        terminal_replay = self.wait_terminal(self.owner, replay)
        if terminal_replay.get("state") != revoked.get("state"):
            raise AssertionError("revoked run replay changed terminal state")
        proposals_after = self.controls().proposals("Github", FORGE_PROJECTS["Github"])
        if len(proposals_after) != proposals_before:
            raise AssertionError("revoked in-flight run published proposal metadata")
        expected_branch = f"rites/github/site/{admitted['id']}"
        if any(proposal.get("head", {}).get("ref") == expected_branch for proposal in proposals_after):
            raise AssertionError("revoked run branch appeared remotely")
        if self.controls().observation()["model"]["calls"] != model_calls_before + 1:
            raise AssertionError("revoked run retry repeated agent work")
        self.assert_external_proposals_untouched()

    def assert_external_proposals_untouched(self) -> None:
        for forge, project_name in FORGE_PROJECTS.items():
            proposals = self.controls().proposals(forge, project_name)
            merged = next(proposal for proposal in proposals if proposal.get("source_branch") == "external/unowned" and proposal.get("merged") is True)
            unowned = next(proposal for proposal in proposals if proposal.get("source_branch") == "external/unowned" and proposal.get("merged") is False)
            expected_merged = "merged"
            expected_open = "opened" if forge == "Gitlab" else "open"
            if merged.get("state") != expected_merged or unowned.get("state") != expected_open:
                raise AssertionError(f"old merged or unowned {forge} proposal was changed")

    def cases(self) -> list[tuple[str, Callable[[], None]]]:
        return [
            ("sessions_metadata_invalid_cookie", self.case_sessions_and_metadata),
            ("credential_ownership_repository_grants", self.case_credentials_repositories_and_grants),
            ("workspace_inference_credential_denied", self.case_workspace_inference_credential_denied),
            ("github_real_sdk_git_pr_and_idempotency", self.case_github_publishes_real_branch_and_pr),
            ("github_create_before_predecessor_close", self.case_github_creates_replacement_before_closing_old),
            ("nochange_partial_error_keep_predecessor", self.case_nochange_and_partial_error_leave_predecessor_open),
            ("gitlab_oauth_refresh_real_mr", self.case_gitlab_refresh_and_publication),
            ("oauth_uncertainty_requires_owner_replacement", self.case_oauth_uncertainty_blocks_blind_retry_until_replacement),
            ("revocation_blocks_inflight_publication_and_replay", self.case_revocation_prevents_inflight_publication_and_replay),
        ]

    def close(self) -> None:
        failures: list[str] = []

        def attempt(name: str, operation: Callable[[], None]) -> None:
            try:
                operation()
            except Exception:
                failures.append(name)

        if self.control is not None:
            attempt("model-release", self.control.release_model)
        if self.native_process is not None:
            def stop_native() -> None:
                try:
                    os.killpg(self.native_process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    self.native_process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
                # A dead group leader proves nothing about its worker descendants.
                try:
                    os.killpg(self.native_process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.native_process.wait(timeout=10)
            attempt("native-process", stop_native)
        if self.native_log_handle is not None:
            attempt("native-log-close", self.native_log_handle.close)
        if self.native_log_path.exists():
            attempt("native-log-copy", lambda: self.reporter.log("native.log", self.native_log_path.read_text(errors="replace")))
        if self.git_trace_path.exists():
            attempt("git-trace-copy", lambda: self.reporter.log("native-git.trace", self.git_trace_path.read_text(errors="replace")))
        if self.postgres is not None:
            attempt("postgres", self.postgres.stop)
        postgres_log = self.runtime_path / "postgres.log"
        if postgres_log.exists():
            attempt("postgres-log-copy", lambda: self.reporter.log("postgres.log", postgres_log.read_text(errors="replace")))
        if self.fixtures is not None:
            attempt("fixtures", self.fixtures.close)
        attempt("runtime-removal", lambda: shutil.rmtree(self.runtime_path))
        if failures:
            raise RuntimeError("owned cleanup failed: " + ",".join(failures))


def main(arguments: list[str]) -> int:
    if len(arguments) != 3:
        print("usage: test-native.sh NATIVE_LAUNCHER WORKER_EXECUTABLE NATIVE_ELF", file=sys.stderr)
        return 2
    paths = [Path(value).resolve() for value in arguments]
    acceptance = NativeAcceptance(paths[0], paths[1], paths[2])
    try:
        try:
            acceptance.start()
        except Exception as error:
            acceptance.reporter.cases.append(CaseRecord(name="native_setup", outcome="error", detail=sanitize(f"{type(error).__name__}: {error}")))
        else:
            for name, operation in acceptance.cases():
                acceptance.reporter.case(name, operation)
    finally:
        try:
            acceptance.close()
        except Exception as error:
            acceptance.reporter.cases.append(CaseRecord(name="owned_cleanup", outcome="error", detail=sanitize(f"{type(error).__name__}: {error}")))
        acceptance.reporter.finish()
    return 1 if any(case.outcome != "passed" for case in acceptance.reporter.cases) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
