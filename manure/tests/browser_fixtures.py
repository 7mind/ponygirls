"""Real target-executable/owned PostgreSQL/filesystem browser fixtures.

No Python server/storage imports. Startup fails without explicit disposable
provider/CREATEDB opt-in and launcher; browser prerequisites remain independently
reported by the existing driver resolver. All fixture seeding uses current API.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from uuid import UUID, uuid4
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
    # Resolve only the current Python client/codec, never a Python backend.
    sys.path.insert(0, REPO_MANURE_DIR)

from manure import current_protocol as cp
from target_server import TargetServer

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
        handlers: list = [urllib.request.ProxyHandler({}),
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

    def current(self, base, command, *, headers=None):
        request_id=uuid4()
        content=isinstance(command,cp.ContentCommand)
        envelope=(cp.ContentEnvelope if content else cp.ClientEnvelope)(request_id,cp.API_VERSION,command)
        headers=dict(headers or {})
        if content and not any(k.lower()=="origin" for k in headers):
            parsed=urllib.parse.urlsplit(base)
            headers["Origin"]=parsed.scheme+"://"+parsed.netloc
        response=self.request("POST",base+("/__manure/current" if content else "/api/current"),body=cp.dumps(envelope),
            content_type="application/json",headers=headers)
        parsed=cp.decode(cp.ServerEnvelope,cp.loads(response.body))
        if parsed.requestId not in (request_id,UUID(int=0)):
            raise AssertionError("current response correlation mismatch")
        result=parsed.result
        if isinstance(result,cp.Result_Error):
            code=re.sub(r"(?<!^)(?=[A-Z])","-",result.failure.code.value).lower()
            local={"error":{"code":code,"message":code}}
        elif isinstance(result,cp.Result_Identity):local=cp.local(result.principal)
        elif isinstance(result,cp.Result_Catalogue):local=cp.local(result.page)
        elif isinstance(result,cp.Result_ArtifactInfo):local=cp.local(result.artifact)
        elif isinstance(result,cp.Result_ArtifactManifest):local=cp.local(result.manifest)
        elif isinstance(result,cp.Result_UploadProgress):local=cp.local(result.status)
        elif isinstance(result,cp.Result_ArtifactPatched):
            local=cp.local(result.artifact)
            if result.externalPassword is not None:local["external_password"]=result.externalPassword
        elif isinstance(result,cp.Result_Ok):local={"ok":True}
        else:local=cp.local(result)
        response.current_result=result
        response.wire_body=response.body
        response.body=json.dumps(local).encode("utf-8")
        return response

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
# server fixture (actual replacement executable, owned PostgreSQL + FS root)
# --------------------------------------------------------------------------

@dataclass
class TestIdentity:
    user_id: str = "w-human"
    token_id: str = "t-browser"
    token: str = ""
    hash_file: str = ""


@dataclass
class ServerFixture:
    """Owned target process plus its public origins and test credentials."""

    tmp: tempfile.TemporaryDirectory = None  # type: ignore[assignment]
    server: object = None
    http: TestHttp = field(default_factory=TestHttp)
    identity: TestIdentity = field(default_factory=TestIdentity)
    api_origin: str = ""
    api_base: str = ""  # effective_api_origin
    suffix: str = ""
    dashboard_dir: str = DASHBOARD_DIR
    unlock_shell_dir: str | None = UNLOCK_DIR

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
      *.manure-files.localhost), or "path" (API 127.0.0.1, content /view/<id>). unlock_shell: "default" (repo unlock
      shell), None (built-in fallback -> unlock_shell_dir=null), or an
      explicit directory path.
    """
    if now_fn is not None:
        raise ValueError("target fixtures use real TTL waits, not a production clock hook")

    _install_test_dns()
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
    elif suffix_mode == "path":
        suffix = ""
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
    users = [{"id":identity.user_id,"type":"human","tokens":[
        {"id":identity.token_id,"hashFile":identity.hash_file}],"displayName":"browser test human"}]
    kwargs = dict(
        data_dir=data_dir,
        api_origin=api_origin,
        content_suffix=suffix,
        content_mode="path" if suffix_mode == "path" else "subdomain",
        loopback_dev=True,
        port=0,
        dashboard_dir=DASHBOARD_DIR,
        unlock_shell_dir=unlock_dir,
        users=users,
    )
    kwargs.update(config_overrides or {})
    try:
        server = TargetServer(kwargs,tmp.name)
    except BaseException:
        tmp.cleanup()
        raise
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
    entries = [cp.ManifestEntry_File(path,len(files[path]),hashlib.sha256(files[path]).hexdigest()) for path in sorted(files)]
    entries += [cp.ManifestEntry_Directory(path) for path in sorted(empty_dirs or [])]
    command = cp.Command_InitUpload(name,cp.ArtifactKind.File if kind=="file" else cp.ArtifactKind.Directory,
        cp.Visibility(visibility.capitalize()),expires_in_s,entries)
    res = http.current(fix.api_base,command,headers=auth)
    assert res.status == 200, f"current init failed: {res.status}"
    init = res.json();artifact_id=init["artifact_id"];chunk_bytes=init["chunk_bytes"]
    for path in sorted(files):
        blob=files[path]
        for offset in range(0,len(blob),chunk_bytes):
            chunk=blob[offset:offset+chunk_bytes]
            query=urllib.parse.urlencode({"path":path,"offset":offset})
            put=http.request("PUT",f"{fix.api_base}/api/current/artifacts/{artifact_id}/chunks?{query}",
                body=chunk,content_type="application/octet-stream",
                headers={**auth,"X-Chunk-Sha256":hashlib.sha256(chunk).hexdigest()})
            assert put.status == 200, f"current chunk failed: {put.status}"
            receipt=cp.decode(cp.ChunkReceipt,cp.loads(put.body))
            assert receipt.path==path and receipt.offset==offset and receipt.length==len(chunk)
    pub=http.current(fix.api_base,cp.Command_FinishUpload(artifact_id),headers=auth)
    assert pub.status == 200, f"current finish failed: {pub.status}"
    return init


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
        if (host == TLS_API_HOST or host.endswith("." + TLS_CONTENT_SUFFIX)
                or host == SIBLING_API_HOST or host.endswith("." + SIBLING_SUFFIX)
                or host.endswith("." + SEPARATE_SUFFIX)):
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
    if now_fn is not None:
        raise ValueError("target fixtures use real TTL waits, not a production clock hook")
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
    users = [{"id":identity.user_id,"type":"human","tokens":[
        {"id":identity.token_id,"hashFile":identity.hash_file}],"displayName":"tls smoke human"}]
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
    try:
        server = TargetServer(kwargs,tmp.name)
    except BaseException:
        tmp.cleanup()
        raise
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
    info = fix.http.current(fix.api_base,cp.Command_GetArtifact(artifact_id),
        headers={"Authorization":f"Bearer {fix.identity.token}"})
    return info.json()["content_url"]


def wait_for_expiry(fix, artifact_id, *, timeout_s=75):
    """Real authorization-immediate TTL check; no backend clock override."""
    deadline=time.monotonic()+timeout_s
    while time.monotonic()<deadline:
        result=fix.http.current(fix.api_base,cp.Command_GetArtifact(artifact_id),
            headers={"Authorization":f"Bearer {fix.identity.token}"})
        if result.status==410:return
        if result.status!=200:raise AssertionError(f"unexpected expiry probe status: {result.status}")
        time.sleep(0.2)
    raise AssertionError("real TTL did not expire before fixture deadline")


def init_command(body):
    """Typed fixture builder, never an obsolete HTTP decoder."""
    return cp.Command_InitUpload(body["name"],cp.ArtifactKind.File if body["kind"]=="file" else cp.ArtifactKind.Directory,
        cp.Visibility(body["visibility"].capitalize()),body.get("expires_in_s"),[
        cp.ManifestEntry_File(e["path"],e["size"],e["sha256"]) if e["kind"]=="file" else cp.ManifestEntry_Directory(e["path"])
        for e in body["files"]])


def patch_command(artifact_id,body):
    expiry=(cp.ExpiryChange_Keep() if "expires_in_s" not in body else
        cp.ExpiryChange_Clear() if body["expires_in_s"] is None else cp.ExpiryChange_Set(body["expires_in_s"]))
    return cp.Command_PatchArtifact(artifact_id,cp.ArtifactPatch(body.get("name"),
        cp.Visibility(body["visibility"].capitalize()) if "visibility" in body else None,expiry))
