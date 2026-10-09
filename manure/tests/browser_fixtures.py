"""Shared fixtures for manure real-browser tests (UI/security agent owned).

Stdlib only. Drives the REAL manure server (``manure.server``,
server-agent owned) with a real SQLite/FS ``data_dir`` and the REAL
Chromium via the installed ``playwright-core`` JS driver executed as a
Node subprocess running ``manure/tests/browser/steps.mjs``.

No fake servers, no header-only substitutes: every test here talks to
the server fixture over HTTP and to pages rendered in Chromium.
When the server implementation (or the Node/Chromium toolchain) is not
available the tests ``SkipTest`` with an explicit reason instead of
passing vacuously.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import unittest
import urllib.parse
import urllib.request
import urllib.error
from dataclasses import dataclass, field

REPO_MANURE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_MANURE_DIR not in sys.path:
    # Test-only bootstrap so `import manure.server` resolves against the
    # worktree checkout (project dir holding the `manure/` package)
    # without installing the package.
    sys.path.insert(0, REPO_MANURE_DIR)

BROWSER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "browser")
STEPS_MJS = os.path.join(BROWSER_DIR, "steps.mjs")

DASHBOARD_DIR = os.path.join(REPO_MANURE_DIR, "web", "dashboard")
UNLOCK_DIR = os.path.join(REPO_MANURE_DIR, "web", "unlock")

SIBLING_SUFFIX = "artifacts.localhost"
SIBLING_API_HOST = "dashboard.artifacts.localhost"
SEPARATE_SUFFIX = "manure-files.localhost"
SEPARATE_API_HOST = "127.0.0.1"

HOST_RESOLVER_RULES = (
    "MAP dashboard.artifacts.localhost 127.0.0.1, "
    "MAP *.artifacts.localhost 127.0.0.1, "
    "MAP *.manure-files.localhost 127.0.0.1"
)


# --------------------------------------------------------------------------
# toolchain resolution
# --------------------------------------------------------------------------

def playwright_core_path() -> str:
    """Absolute dir holding playwright-core's package.json (dev-only driver)."""
    path = os.environ.get("MANURE_PLAYWRIGHT_CORE_PATH", "")
    if not path or not os.path.isabs(path):
        raise unittest.SkipTest(
            "MANURE_PLAYWRIGHT_CORE_PATH is not an absolute directory path")
    pkg = os.path.join(path, "package.json")
    if not os.path.isfile(pkg):
        raise unittest.SkipTest(
            f"playwright-core not found at MANURE_PLAYWRIGHT_CORE_PATH={path}")
    try:
        with open(pkg, "r", encoding="utf-8") as fh:
            name = json.load(fh).get("name", "")
    except (OSError, ValueError) as exc:
        raise unittest.SkipTest(f"cannot read playwright-core package.json: {exc}")
    if name != "playwright-core":
        raise unittest.SkipTest(
            f"package at MANURE_PLAYWRIGHT_CORE_PATH is {name!r}, not playwright-core")
    return path


def chromium_bin() -> str:
    override = os.environ.get("MANURE_CHROMIUM_BIN", "")
    if override:
        if os.path.isfile(override) and os.access(override, os.X_OK):
            return override
        raise unittest.SkipTest(
            f"MANURE_CHROMIUM_BIN={override} is not executable")
    found = shutil.which("chromium") or shutil.which("chromium-browser") \
        or shutil.which("google-chrome")
    if found:
        return found
    raise unittest.SkipTest("no Chromium binary (MANURE_CHROMIUM_BIN unset, none on PATH)")


def node_bin() -> str:
    found = shutil.which("node")
    if found:
        return found
    raise unittest.SkipTest("node not found on PATH (need Node >= 24)")


# --------------------------------------------------------------------------
# Node steps.mjs runner (payload via stdin, never argv: secrets stay out
# of process listings)
# --------------------------------------------------------------------------

def run_steps(steps, *, timeout_s: int = 180, headed: bool = False,
              ignore_https_errors: bool = False,
              host_resolver_rules: str | None = None):
    """Run one browser scenario; returns the decoded result list.

    ``steps`` is a JSON-able list of step objects understood by
    ``browser/steps.mjs``. Raises SkipTest when the toolchain is absent;
    raises AssertionError with the helper's stderr when Node fails.
    """
    playwright_core_path()  # validates presence, SkipTest when absent
    chrome = chromium_bin()
    node = node_bin()
    if not os.path.isfile(STEPS_MJS):
        raise unittest.SkipTest(f"browser helper missing: {STEPS_MJS}")
    payload = json.dumps({
        "chromiumBin": chrome,
        "hostResolverRules": host_resolver_rules or HOST_RESOLVER_RULES,
        "headed": headed,
        "ignoreHTTPSErrors": ignore_https_errors,
        "steps": steps,
    })
    # steps.mjs resolves playwright-core from MANURE_PLAYWRIGHT_CORE_PATH
    # itself; the payload carries no secrets beyond this process pipe.
    try:
        proc = subprocess.run(
            [node, STEPS_MJS],
            input=payload.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_s,
            cwd=BROWSER_DIR,
        )
    except subprocess.TimeoutExpired as exc:
        raise AssertionError(f"steps.mjs timed out after {timeout_s}s") from exc
    if proc.returncode != 0:
        raise AssertionError(
            f"steps.mjs exited {proc.returncode}: {proc.stderr.decode('utf-8', 'replace')[-4000:]}")
    try:
        return json.loads(proc.stdout.decode("utf-8"))
    except ValueError as exc:
        raise AssertionError(
            f"steps.mjs produced non-JSON stdout: {proc.stdout.decode('utf-8', 'replace')[-2000:]}"
        ) from exc


# --------------------------------------------------------------------------
# minimal HTTP client (stdlib urllib; manual per-host cookie jar so tests
# can assert exact credential-routing behavior)
# --------------------------------------------------------------------------

class HttpResult:
    def __init__(self, status, headers, body):
        self.status = status
        self.headers = headers  # email.message.Message
        self.body = body  # bytes

    def json(self):
        return json.loads(self.body.decode("utf-8"))

    def header(self, name, default=None):
        return self.headers.get(name, default)


class TestHttp:
    """Exact-host cookie jar: cookies are stored per (host) and only sent
    back to that exact host, mirroring the normative client behavior."""

    def __init__(self, ssl_context=None):
        self.jar: dict[str, dict[str, str]] = {}
        # Test-only TLS bypass for the sandbox-local self-signed edge.
        self._ssl_context = ssl_context

    @staticmethod
    def _host(url: str) -> str:
        return urllib.parse.urlsplit(url).hostname or ""

    def cookies_for(self, url: str) -> dict[str, str]:
        return dict(self.jar.get(self._host(url).lower(), {}))

    def set_cookie(self, url: str, name: str, value: str) -> None:
        """Plant one cookie for an exact host (harness privilege: lets a
        test replay a browser-observed cookie over HTTP)."""
        self.jar.setdefault(self._host(url).lower(), {})[name] = value

    def clear_host(self, url: str) -> None:
        self.jar.pop(self._host(url).lower(), None)

    def request(self, method, url, *, body=None, content_type=None,
                headers=None, follow_redirects=False):
        data = None
        req_headers = dict(headers or {})
        if isinstance(body, dict):
            data = json.dumps(body).encode("utf-8")
            req_headers.setdefault("Content-Type", "application/json")
        elif isinstance(body, str):
            data = body.encode("utf-8")
        elif body is not None:
            data = body
            if content_type:
                req_headers.setdefault("Content-Type", content_type)
        elif content_type:
            req_headers["Content-Type"] = content_type
        jar = self.cookies_for(url)
        if jar:
            req_headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in sorted(jar.items()))
        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        handlers: list = [
            _NoRedirectHandler() if not follow_redirects
            else urllib.request.HTTPRedirectHandler()]
        if url.lower().startswith("https:") and self._ssl_context is not None:
            handlers.append(urllib.request.HTTPSHandler(context=self._ssl_context))
        opener = urllib.request.build_opener(*handlers)
        try:
            with opener.open(req, timeout=30) as resp:
                raw = resp.read()
                result = HttpResult(resp.status, resp.headers, raw)
        except urllib.error.HTTPError as exc:
            raw = exc.read() if hasattr(exc, "read") else b""
            result = HttpResult(exc.code, exc.headers, raw)
        self._store_cookies(url, result.headers)
        return result

    def _store_cookies(self, url: str, headers) -> None:
        host = self._host(url).lower()
        # get_all_matching_headers is on http.client.HTTPMessage
        get_all = getattr(headers, "get_all", None)
        raw = headers.get_all("Set-Cookie", []) if callable(get_all) else []
        if not raw:
            single = headers.get("Set-Cookie")
            raw = [single] if single else []
        for line in raw:
            pair = line.split(";", 1)[0]
            if "=" not in pair:
                continue
            name, _, value = pair.partition("=")
            self.jar.setdefault(host, {})[name.strip()] = value.strip()


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# --------------------------------------------------------------------------
# server fixture (real manure.server, real SQLite/FS data_dir)
# --------------------------------------------------------------------------

@dataclass
class TestIdentity:
    user_id: str = "w-human"
    token_id: str = "t-browser"
    token: str = ""
    hash_file: str = ""


@dataclass
class ServerFixture:
    """Values below the ASSUMED_* marks mirror CONTRACT.md text but the
    exact ServerConfig kwarg spellings are unconfirmed until the server
    implementation lands (governor sync pending)."""

    tmp: tempfile.TemporaryDirectory = None  # type: ignore[assignment]
    server: object = None
    http: TestHttp = field(default_factory=TestHttp)
    identity: TestIdentity = field(default_factory=TestIdentity)
    api_origin: str = ""
    api_base: str = ""  # effective_api_origin
    suffix: str = ""
    dashboard_dir: str = DASHBOARD_DIR
    unlock_shell_dir: str | None = UNLOCK_DIR

    # ASSUMED_SERVER_FIELDS: ServerConfig kwarg names below follow the
    # contract sections 3.1/11 field names; confirm against the landed
    # server module during governor sync.
    config_overrides: dict = field(default_factory=dict)
    def close(self):
        try:
            closer = getattr(self.server, "close", None)
            if closer is not None:
                closer()
        finally:
            if self.tmp is not None:
                self.tmp.cleanup()


def canonical_secret() -> str:
    """A fresh canonical 43-char secret (32 random bytes, base64url
    unpadded): valid shape, unknown value. Round-2 servers strictly
    validate canonical form, so wrong-secret probes MUST use this, never
    hand-typed repeats like '1'*43 (non-canonical low bits)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")


def _make_identity(tmpdir: str) -> TestIdentity:
    token = canonical_secret()
    assert len(token) == 43, len(token)
    digest = hashlib.sha256(token.encode("ascii")).hexdigest()
    hash_file = os.path.join(tmpdir, "token.hash")
    with open(hash_file, "w", encoding="utf-8") as fh:
        fh.write(digest + "\n")
    os.chmod(hash_file, 0o600)
    return TestIdentity(token=token, hash_file=hash_file)


def start_server(*, suffix_mode: str = "sibling", unlock_shell: str | None = "default",
                 config_overrides: dict | None = None,
                 now_fn=None) -> ServerFixture:
    """Start the real server on an ephemeral port.

    suffix_mode: "sibling" (api dashboard.artifacts.localhost, content
      *.artifacts.localhost) or "separate" (api 127.0.0.1, content
      *.manure-files.localhost). unlock_shell: "default" (repo unlock
      shell), None (built-in fallback -> unlock_shell_dir=null), or an
      explicit directory path.
    """
    try:
        from manure.domain import TokenRef, UserConfig
        from manure.server import ServerConfig, create_server
    except ImportError as exc:
        raise unittest.SkipTest(
            f"manure.server not importable (server implementation not synced): {exc}")

    tmp = tempfile.TemporaryDirectory(prefix="manure-browser-")
    identity = _make_identity(tmp.name)
    data_dir = os.path.join(tmp.name, "data")
    os.mkdir(data_dir)

    if suffix_mode == "sibling":
        suffix = SIBLING_SUFFIX
        api_host = SIBLING_API_HOST
    elif suffix_mode == "separate":
        suffix = SEPARATE_SUFFIX
        api_host = SEPARATE_API_HOST
    else:
        raise ValueError(f"unknown suffix_mode: {suffix_mode}")

    if unlock_shell == "default":
        unlock_dir = UNLOCK_DIR
    elif unlock_shell is None:
        unlock_dir = None
    else:
        unlock_dir = unlock_shell

    # Port 0 requests an ephemeral port; effective_api_origin reports the
    # bound one (contract section 11, confirmed by the landed server).
    api_origin = f"http://{api_host}:0"
    users = (UserConfig(
        id=identity.user_id,
        type="human",
        tokens=(TokenRef(id=identity.token_id,
                         hash_file=identity.hash_file),),
        display_name="browser test human",
    ),)
    kwargs = dict(
        data_dir=data_dir,
        api_origin=api_origin,
        content_suffix=suffix,
        loopback_dev=True,
        port=0,
        dashboard_dir=DASHBOARD_DIR,
        unlock_shell_dir=unlock_dir,
        users=users,
    )
    kwargs.update(config_overrides or {})
    try:
        config = ServerConfig(**kwargs)
    except TypeError as exc:
        tmp.cleanup()
        raise unittest.SkipTest(
            f"ServerConfig signature differs from contract assumption: {exc}")
    # Private test clock (server-owned create_server(config, _now=fn)).
    server = create_server(config, _now=now_fn) if now_fn is not None \
        else create_server(config)
    fix = ServerFixture(
        tmp=tmp, server=server, identity=identity,
        api_origin=api_origin, suffix=suffix,
        dashboard_dir=DASHBOARD_DIR, unlock_shell_dir=unlock_dir,
        config_overrides=dict(config_overrides or {}),
    )
    api_base = getattr(server, "effective_api_origin", None) or getattr(server, "api_url", None)
    if not api_base:
        fix.close()
        raise unittest.SkipTest("server exposes neither effective_api_origin nor api_url")
    fix.api_base = api_base.rstrip("/")
    return fix


# --------------------------------------------------------------------------
# upload helper (ASSUMED_INIT_ENVELOPE: exact init/chunk/publish shapes
# follow contract sections 6-8; recheck field names at governor sync)
# --------------------------------------------------------------------------

def upload_fixture(fix: ServerFixture, *, name: str, kind: str, visibility: str,
                   files: dict[str, bytes], empty_dirs: list[str] | None = None,
                   bearer: bool = True, expires_in_s: int | None = None) -> dict:
    """Upload one artifact end-to-end over the real API; returns the init
    response dict merged with artifact_id/content_url/password."""
    http = fix.http
    auth = {"Authorization": f"Bearer {fix.identity.token}"} if bearer else {}
    manifest = []
    for path in sorted(files):
        digest = hashlib.sha256(files[path]).hexdigest()
        manifest.append({"path": path, "kind": "file",
                         "size": len(files[path]), "sha256": digest})
    for d in sorted(empty_dirs or []):
        manifest.append({"path": d, "kind": "dir"})
    # ASSUMED_INIT_ENVELOPE: contract names the response fields but the
    # request field spellings (name/kind/visibility/files) are assumed.
    init_body = {"name": name, "kind": kind, "visibility": visibility,
                 "files": manifest}
    if expires_in_s is not None:
        init_body["expires_in_s"] = expires_in_s
    res = http.request("POST", fix.api_base + "/api/v1/artifacts:init",
                       body=init_body, headers=auth)
    assert res.status == 200, f"init failed: {res.status} {res.body[:500]!r}"
    init = res.json()
    artifact_id = init["artifact_id"]
    chunk_bytes = init.get("chunk_bytes") or 1048576
    for path in sorted(files):
        blob = files[path]
        digest = hashlib.sha256(blob).hexdigest()
        offset = 0
        step = int(chunk_bytes)
        while offset < len(blob):
            chunk = blob[offset:offset + step]
            q = urllib.parse.urlencode(
                {"path": path, "offset": offset})
            put = http.request(
                "PUT",
                f"{fix.api_base}/api/v1/artifacts/{artifact_id}/chunks?{q}",
                body=chunk, content_type="application/octet-stream",
                headers={**auth,
                         "X-Chunk-Sha256": hashlib.sha256(chunk).hexdigest()})
            assert put.status == 200, \
                f"chunk PUT failed: {put.status} {put.body[:500]!r}"
            offset += len(chunk)
        assert digest == hashlib.sha256(blob).hexdigest()
    pub = http.request("POST",
                       f"{fix.api_base}/api/v1/artifacts/{artifact_id}/publish",
                       body={}, headers=auth)
    assert pub.status == 200, f"publish failed: {pub.status} {pub.body[:500]!r}"
    out = dict(init)
    out["artifact_id"] = artifact_id
    if "content_url" not in out and hasattr(fix.server, "content_url"):
        out["content_url"] = fix.server.content_url(artifact_id)
    return out


def requests_log(out) -> list:
    for entry in out:
        if entry.get("op") == "requests":
            return entry.get("requests", [])
    return []


def responses_log(out) -> list:
    for entry in out:
        if entry.get("op") == "responses":
            return entry.get("responses", [])
    return []


def assert_no_secrets_in_request_urls(testcase: unittest.TestCase, out,
                                      secrets: list[str]) -> None:
    """Every navigated/fetched URL must carry no credential material."""
    for req in requests_log(out):
        for secret in secrets:
            if secret:
                testcase.assertNotIn(secret, req["url"],
                                     f"secret in {req['method']} {req['url']}")


# --------------------------------------------------------------------------
# TLS edge smoke (production cookie/boundary check, sandbox-local only)
#
# A minimal stdlib TLS-terminating forwarder stands in for the Nix edge:
# it terminates TLS, preserves Host intact, strips spoofable forwarding
# headers, and asserts X-Forwarded-Proto: https toward the backend over
# 127.0.0.2 (a different loopback IP sharing the test port, so the
# server-derived content URLs stay valid through the proxy).

TLS_API_HOST = "manure-api.test"
TLS_CONTENT_SUFFIX = "manure-content.test"
TLS_RESOLVER_RULES = (
    "MAP manure-api.test 127.0.0.1, "
    "MAP *.manure-content.test 127.0.0.1"
)

_DNS_INSTALLED = False


def _install_test_dns() -> None:
    """Map the fictional .test names to loopback inside THIS process
    (Chromium uses --host-resolver-rules; Python has no such knob)."""
    global _DNS_INSTALLED
    if _DNS_INSTALLED:
        return
    import socket as _socket
    real_getaddrinfo = _socket.getaddrinfo

    def _fake(host, port, *args, **kwargs):
        if host == TLS_API_HOST or host.endswith("." + TLS_CONTENT_SUFFIX):
            host = "127.0.0.1"
        return real_getaddrinfo(host, port, *args, **kwargs)

    _socket.getaddrinfo = _fake
    _DNS_INSTALLED = True


def find_openssl() -> str:
    override = os.environ.get("MANURE_OPENSSL_BIN", "")
    if override:
        if os.path.isfile(override) and os.access(override, os.X_OK):
            return override
        raise unittest.SkipTest(f"MANURE_OPENSSL_BIN={override} not executable")
    found = shutil.which("openssl")
    if found:
        return found
    import glob as _glob
    for path in sorted(_glob.glob("/nix/store/*-openssl-*-bin/bin/openssl")):
        if os.access(path, os.X_OK):
            return path
    raise unittest.SkipTest("no openssl (MANURE_OPENSSL_BIN unset, none on PATH/store)")


def make_test_cert(tmpdir: str, openssl: str, sans: list) -> tuple:
    key = os.path.join(tmpdir, "tls-smoke.key")
    cert = os.path.join(tmpdir, "tls-smoke.crt")
    san = ",".join(f"DNS:{name}" for name in sans)
    proc = subprocess.run(
        [openssl, "req", "-x509", "-newkey", "rsa:2048",
         "-keyout", key, "-out", cert, "-days", "2", "-nodes",
         "-subj", "/CN=manure-tls-smoke", "-addext", f"subjectAltName={san}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if proc.returncode != 0:
        raise unittest.SkipTest(
            f"openssl cert generation failed: {proc.stderr.decode()[-500:]}")
    os.chmod(key, 0o600)
    return cert, key


def _read_http_message(sock):
    """Read one head + Content-Length body; None on clean EOF."""
    import socket as _socket
    head = b""
    try:
        while b"\r\n\r\n" not in head:
            chunk = sock.recv(65536)
            if not chunk:
                return None
            head += chunk
            if len(head) > 131072:
                return None
    except (OSError, _socket.timeout):
        return None
    raw_head, _, rest = head.partition(b"\r\n\r\n")
    length = 0
    for line in raw_head.decode("latin-1").split("\r\n")[1:]:
        name, _, value = line.partition(":")
        if name.strip().lower() == "content-length":
            try:
                length = max(0, int(value.strip()))
            except ValueError:
                length = 0
    body = rest[:length]
    while len(body) < length:
        try:
            chunk = sock.recv(min(65536, length - len(body)))
        except (OSError, _socket.timeout):
            break
        if not chunk:
            break
        body += chunk
    return raw_head, body[:length]


class TlsEdgeProxy:
    """TLS terminator on 127.0.0.1:port forwarding plain HTTP to the
    backend on 127.0.0.2:port with Host preserved and a single exact
    X-Forwarded-Proto: https (incoming forwarding headers stripped)."""

    def __init__(self, port: int, backend_ip: str, cert: str, key: str):
        import socket as _socket
        import ssl as _ssl
        import threading as _threading
        context = _ssl.SSLContext(_ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        raw = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        raw.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
        raw.bind(("127.0.0.1", port))
        raw.listen(128)
        raw.settimeout(1.0)
        self._raw = raw
        self._context = context
        self._backend = (backend_ip, port)
        self._stop = _threading.Event()
        self._thread = _threading.Thread(target=self._serve, daemon=True,
                                         name="manure-tls-edge")
        self._thread.start()

    def close(self):
        self._stop.set()
        try:
            self._raw.close()
        except OSError:
            pass
        self._thread.join(timeout=10)

    def _serve(self):
        import socket as _socket
        while not self._stop.is_set():
            try:
                conn, _ = self._raw.accept()
            except (OSError, _socket.timeout):
                continue
            except Exception:
                continue
            try:
                tls = self._context.wrap_socket(conn, server_side=True)
                tls.settimeout(30)
            except Exception:
                try:
                    conn.close()
                except OSError:
                    pass
                continue
            import threading as _threading
            worker = _threading.Thread(target=self._handle, args=(tls,),
                                       daemon=True)
            worker.start()

    def _handle(self, browser):
        import socket as _socket
        try:
            while not self._stop.is_set():
                parsed = _read_http_message(browser)
                if parsed is None:
                    break
                raw_head, body = parsed
                lines = raw_head.decode("latin-1").split("\r\n")
                out = [lines[0]]
                close_after = False
                for line in lines[1:]:
                    name, _, value = line.partition(":")
                    lname = name.strip().lower()
                    if lname in ("x-forwarded-proto", "x-forwarded-host",
                                 "x-forwarded-for", "forwarded"):
                        continue
                    if lname == "connection":
                        if "close" in value.lower():
                            close_after = True
                        continue
                    if lname == "keep-alive":
                        continue
                    out.append(line)
                out.append("X-Forwarded-Proto: https")
                out.append("Connection: close")
                upstream = _socket.create_connection(self._backend, timeout=30)
                try:
                    upstream.sendall(("\r\n".join(out) + "\r\n\r\n").encode("latin-1") + body)
                    chunks = []
                    while True:
                        try:
                            data = upstream.recv(65536)
                        except _socket.timeout:
                            break
                        if not data:
                            break
                        chunks.append(data)
                    browser.sendall(b"".join(chunks))
                finally:
                    try:
                        upstream.close()
                    except OSError:
                        pass
                if close_after:
                    break
        except Exception:
            pass
        finally:
            try:
                browser.close()
            except OSError:
                pass


@dataclass
class HttpsFixture:
    tmp: tempfile.TemporaryDirectory
    server: object
    proxy: TlsEdgeProxy
    http: TestHttp = None  # type: ignore[assignment]
    identity: TestIdentity = None  # type: ignore[assignment]
    api_base: str = ""
    suffix: str = TLS_CONTENT_SUFFIX

    def close(self):
        try:
            closer = getattr(self.server, "close", None)
            if closer is not None:
                closer()
        finally:
            try:
                self.proxy.close()
            finally:
                self.tmp.cleanup()


def start_https_server(*, config_overrides=None, now_fn=None) -> HttpsFixture:
    """Backend on 127.0.0.2:<ephemeral> behind a TLS edge on
    127.0.0.1:<same port>; api https://manure-api.test:<port> with a
    separate-domain content suffix. loopback_dev=False throughout."""
    try:
        from manure.domain import TokenRef, UserConfig
        from manure.server import ServerConfig, create_server
    except ImportError as exc:
        raise unittest.SkipTest(f"manure.server not importable: {exc}")
    openssl = find_openssl()
    _install_test_dns()
    tmp = tempfile.TemporaryDirectory(prefix="manure-tls-")
    import ssl as _ssl
    insecure = _ssl.create_default_context()
    insecure.check_hostname = False
    insecure.verify_mode = _ssl.CERT_NONE
    identity = _make_identity(tmp.name)
    data_dir = os.path.join(tmp.name, "data")
    os.mkdir(data_dir)
    cert, key = make_test_cert(
        tmp.name, openssl,
        [TLS_API_HOST, f"*.{TLS_CONTENT_SUFFIX}"])
    users = (UserConfig(
        id=identity.user_id, type="human",
        tokens=(TokenRef(id=identity.token_id, hash_file=identity.hash_file),),
        display_name="tls smoke human",
    ),)
    kwargs = dict(
        data_dir=data_dir,
        api_origin=f"https://{TLS_API_HOST}:0",
        content_suffix=TLS_CONTENT_SUFFIX,
        loopback_dev=False,
        port=0,
        listen_address="127.0.0.2",
        dashboard_dir=DASHBOARD_DIR,
        unlock_shell_dir=UNLOCK_DIR,
        users=users,
    )
    kwargs.update(config_overrides or {})
    config = ServerConfig(**kwargs)
    server = create_server(config, _now=now_fn) if now_fn is not None \
        else create_server(config)
    try:
        proxy = TlsEdgeProxy(server.bound_port, "127.0.0.2", cert, key)
    except Exception:
        server.close()
        tmp.cleanup()
        raise
    return HttpsFixture(tmp=tmp, server=server, proxy=proxy,
                        http=TestHttp(ssl_context=insecure), identity=identity,
                        api_base=server.effective_api_origin.rstrip("/"))


def content_url_for(fix: ServerFixture, artifact_id: str) -> str:
    if hasattr(fix.server, "content_url"):
        return fix.server.content_url(artifact_id)
    info = fix.http.request(
        "GET", f"{fix.api_base}/api/v1/artifacts/{artifact_id}",
        headers={"Authorization": f"Bearer {fix.identity.token}"})
    return info.json()["content_url"]
