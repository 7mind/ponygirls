"""Production manure HTTP server (stdlib only, explicit deps, no globals).

Single-socket Host dispatch: one bounded-thread ``ThreadingHTTPServer``
serves the API/dashboard origin and every ``<artifact-id>.<suffix>``
content origin, routed by ``Host``. Entry points::

    from manure.server import create_server, ServerConfig
    with create_server(config) as server:
        server.api_url                 # e.g. http://127.0.0.1:PORT
        server.effective_api_origin    # configured api_origin, bound port
        server.content_url(artifact_id)

Test fixture (client/UI teams): ``port=0`` with
``api_origin="http://127.0.0.1:0"``, ``content_suffix="artifacts.localhost"``,
``loopback_dev=True``, ``dashboard_dir=None``, ``unlock_shell_dir=None``
(built-in unlock form). Content hosts are dialed as 127.0.0.1:port with an
explicit ``Host: <id>.artifacts.localhost:<port>`` header. Private,
tests-only clock injection: ``create_server(config, _now=callable)`` — the
clock NEVER comes from config/env (``ServerConfig`` keys are closed).

Logging is allowlisted: route label, request id, timing, status,
principal/token LABELS, artifact id, byte counts. Tokens, passwords,
grants, cookies, and bodies are never logged.
"""

from __future__ import annotations

import argparse
import http.server
import ipaddress
import itertools
import json
import mimetypes
import os
import socket
import sqlite3
import sys
import threading
import time
import urllib.parse
from typing import Any, Callable, Optional

from manure import auth as authmod
from manure import domain as D
from manure.__init__ import __version__ as _VERSION
from manure.auth import AuthError
from manure.domain import DomainError, ServerConfig
from manure.storage import ArtifactStore, StorageError, UNSET

__all__ = ["ServerConfig", "RunningServer", "create_server", "main"]
_SESSION_MAX_AGE = 15552000  # 180 days, sliding renewal


# ------------------------------------------------------------------ state

class _Throttle:
    """In-memory per-key sliding-window throttle with LRU cap."""

    def __init__(self, cap: int):
        self._cap = cap
        self._table: dict[str, list[float]] = {}
        self._order: list[str] = []
        self._lock = threading.Lock()

    def allow(self, key: str, limit_per_min: int, now: float) -> bool:
        with self._lock:
            bucket = self._table.get(key)
            if bucket is None:
                bucket = []
                self._table[key] = bucket
                self._order.append(key)
            else:
                try:
                    self._order.remove(key)
                except ValueError:
                    pass
                self._order.append(key)
            cutoff = now - 60.0
            while bucket and bucket[0] <= cutoff:
                bucket.pop(0)
            if len(bucket) >= limit_per_min:
                return False
            bucket.append(now)
            while len(self._order) > self._cap:
                oldest = self._order.pop(0)
                self._table.pop(oldest, None)
            return True


class _State:
    def __init__(self, config: ServerConfig, store: ArtifactStore,
                 token_map: dict[str, authmod.TokenIdentity],
                 dashboard_dir: Optional[str], unlock_shell_dir: Optional[str],
                 trusted: list[Any], sem: threading.Semaphore,
                 throttle: _Throttle, now: Callable[[], float],
                 rid: itertools.count):
        self.config = config
        self.store = store
        self.token_map = token_map
        self.dashboard_dir = dashboard_dir
        self.unlock_shell_dir = unlock_shell_dir
        self.trusted = trusted
        self.sem = sem
        self.throttle = throttle
        self.now = now
        self.rids = rid
        self.effective_origin = ""
        self.api_host = (urllib.parse.urlsplit(
            config.api_origin).hostname or "").lower()


# ------------------------------------------------------------------ helpers

def _resolve_shell(configured: Optional[str], name: str) -> Optional[str]:
    """Explicit dir -> package tree -> repo fallback -> None (null semantics)."""
    if configured is None:
        return None
    if configured != "package":
        if not os.path.isdir(configured):
            raise DomainError("bad-envelope",
                              "%s dir missing: %s" % (name, configured))
        return os.path.abspath(configured)
    here = os.path.dirname(os.path.abspath(__file__))
    for candidate in (os.path.join(here, "web", name),
                      os.path.join(os.path.dirname(here), "web", name)):
        if os.path.isdir(candidate):
            return candidate
    return None


def _credential_live(state: _State, user_id: str, token_id: str,
                     digest: str) -> bool:
    """R3: a grant binding is live iff its exact digest is still provisioned
    for the same user/token labels (removal/replacement kills grants)."""
    identity = state.token_map.get(digest)
    return identity is not None and identity.user_id == user_id \
        and identity.token_id == token_id


def _content_origin(state: _State, aid: str) -> str:
    scheme = urllib.parse.urlsplit(state.config.api_origin).scheme
    eff = urllib.parse.urlsplit(state.effective_origin)
    host = "%s.%s" % (aid, state.config.content_suffix)
    if eff.port:
        return "%s://%s:%d" % (scheme, host, eff.port)
    return "%s://%s" % (scheme, host)


def _compute_effective_origin(config: ServerConfig, bound_port: int) -> str:
    parts = urllib.parse.urlsplit(config.api_origin)
    host = parts.hostname or ""
    if config.port == 0:
        netloc = "%s:%d" % (host, bound_port)
        return urllib.parse.urlunsplit(
            (parts.scheme, netloc, parts.path, parts.query, parts.fragment))
    return config.api_origin


def _parse_authority(handler: http.server.BaseHTTPRequestHandler
                     ) -> tuple[str, Optional[int]]:
    """Strict Host parsing: singular header, no userinfo, numeric port."""
    getter = getattr(handler.headers, "get_all", None)
    values = getter("Host") if getter else [handler.headers.get("Host")]
    values = [v for v in (values or []) if v is not None]
    if len(values) != 1 or not values[0] or not values[0].strip():
        raise DomainError("bad-host", "singular Host required")
    authority = values[0].strip()
    if any(ch.isspace() for ch in authority) or "@" in authority:
        raise DomainError("bad-host", "malformed authority")
    port: Optional[int] = None
    if authority.startswith("["):
        end = authority.find("]")
        if end < 0:
            raise DomainError("bad-host", "malformed authority")
        host = authority[1:end]
        rest = authority[end + 1:]
        if rest:
            if not rest.startswith(":"):
                raise DomainError("bad-host", "malformed authority")
            port = _parse_port(rest[1:])
        if not host:
            raise DomainError("bad-host", "malformed authority")
        return host.lower(), port
    if authority.count(":") > 1:
        raise DomainError("bad-host", "malformed authority")
    if ":" in authority:
        host, _, port_text = authority.partition(":")
        port = _parse_port(port_text)
    else:
        host = authority
    if not host or host.startswith(".") or host.endswith(".") \
            or ".." in host:
        raise DomainError("bad-host", "malformed authority")
    return host.lower(), port


def _parse_port(text: str) -> int:
    if not text.isdigit():
        raise DomainError("bad-host", "bad port")
    port = int(text)
    if not 1 <= port <= 65535:
        raise DomainError("bad-host", "bad port")
    return port


def _check_production_port(state: _State, hostname: str,
                           port: Optional[int]) -> None:
    """Ports are ignored for loopback hosts/ephemeral binds only."""
    if D._is_loopback_host(hostname) or state.config.port == 0:
        return
    if port is None:
        return
    parts = urllib.parse.urlsplit(state.effective_origin)
    expected = parts.port or (443 if parts.scheme == "https" else 80)
    if port != expected:
        raise DomainError("bad-host", "unexpected port")


def _is_secure(state: _State, handler: http.server.BaseHTTPRequestHandler
               ) -> bool:
    if state.config.loopback_dev:
        return True
    try:
        peer = ipaddress.ip_address(handler.client_address[0])
    except ValueError:
        return False
    if not any(peer in net for net in state.trusted):
        return False
    getter = getattr(handler.headers, "get_all", None)
    if getter is not None:
        values = getter("X-Forwarded-Proto") or []
    else:
        values = [handler.headers.get("X-Forwarded-Proto")]
    return len(values) == 1 and values[0] == "https"


def _decode_content_path(raw_path: str) -> tuple[str, bool]:
    """Return (decoded_path, trailing_slash) per the frozen §7.3 rule."""
    path = raw_path.split("?", 1)[0]
    if path == "/":
        return "", False
    trailing = len(path) > 1 and path.endswith("/")
    segments = path.split("/")[1:]
    if trailing:
        segments = segments[:-1]
    decoded: list[str] = []
    for seg in segments:
        try:
            out = urllib.parse.unquote(seg, encoding="utf-8", errors="strict")
        except (UnicodeDecodeError, ValueError) as exc:
            raise DomainError("invalid-path", "bad percent-encoding") from exc
        if out == "" or out in (".", ".."):
            raise DomainError("invalid-path", "dot/empty segment")
        if "\x00" in out or "/" in out:
            raise DomainError("invalid-path", "bad segment")
        decoded.append(out)
    joined = "/".join(decoded)
    if joined:
        if "\\" in joined or len(joined) > 1024 or len(decoded) > 64:
            raise DomainError("invalid-path", "bad path")
    return joined, trailing


# ------------------------------------------------------------------ server

_O_NOFOLLOW = getattr(os, "O_NOFOLLOW", 0)

_OVERLOAD_BODY = b'{"error": {"code": "unavailable", "message": "busy"}}'
_OVERLOAD_RESPONSE = (
    b"HTTP/1.1 503 Service Unavailable\r\n"
    b"Content-Type: application/json\r\n"
    b"Origin-Agent-Cluster: ?1\r\n"
    b"Cross-Origin-Opener-Policy: same-origin\r\n"
    b"Cross-Origin-Resource-Policy: same-origin\r\n"
    b"X-Content-Type-Options: nosniff\r\n"
    b"Referrer-Policy: no-referrer\r\n"
    b"Cache-Control: no-store\r\n"
    b"Retry-After: 5\r\n"
    b"Connection: close\r\n"
    b"Content-Length: %d\r\n\r\n" % len(_OVERLOAD_BODY)
) + _OVERLOAD_BODY


class _HTTPServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, addr: Any, handler: Any, state: _State):
        self._mstate = state
        self._active = 0
        self._active_lock = threading.Lock()
        self._active_changed = threading.Condition(self._active_lock)
        self._sockets: set[Any] = set()
        super().__init__(addr, handler)

    def handle_error(self, request: Any, client_address: Any) -> None:
        # R16: never the stdlib traceback logger (it prints raw exception
        # data); client resets are routine, everything else is a fixed
        # category label with the peer label only.
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return  # client went away; routine under load
        try:
            peer = client_address[0] if client_address else "?"
        except (IndexError, TypeError):
            peer = "?"
        sys.stderr.write("manure handler-fault %s peer=%s\n"
                         % (type(exc).__name__ if exc is not None
                            else "Unknown", peer))

    # R7: admission happens here, in the accepting thread, BEFORE a worker
    # thread exists — max_connections bounds workers 1:1, not just handlers.
    def process_request(self, request: Any, client_address: Any) -> None:
        state: _State = self._mstate
        if not state.sem.acquire(blocking=False):
            try:
                request.sendall(_OVERLOAD_RESPONSE)
            except OSError:
                pass
            try:
                self.shutdown_request(request)
            except OSError:
                pass
            try:
                self.close_request(request)
            except OSError:
                pass
            return
        with self._active_lock:
            self._active += 1
            self._active_changed.notify_all()
        super().process_request(request, client_address)

    def process_request_thread(self, request: Any,
                               client_address: Any) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            state: _State = self._mstate
            state.sem.release()
            with self._active_lock:
                self._active -= 1
                self._active_changed.notify_all()

    def get_request(self) -> Any:
        request, address = super().get_request()
        with self._active_lock:
            self._sockets.add(request)
        return request, address

    def close_request(self, request: Any) -> None:
        try:
            super().close_request(request)
        finally:
            with self._active_lock:
                self._sockets.discard(request)

    def active_count(self) -> int:
        with self._active_lock:
            return self._active

    def wait_idle(self, deadline_s: float) -> bool:
        end = time.monotonic() + deadline_s
        with self._active_lock:
            while self._active > 0:
                remaining = end - time.monotonic()
                if remaining <= 0:
                    return False
                self._active_changed.wait(timeout=min(0.05, remaining))
            return True

    def shutdown_lingering(self) -> None:
        with self._active_lock:
            sockets = list(self._sockets)
        for sock in sockets:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass


class _Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "manure/0.2.0"
    _rid = 0
    _start_t = 0.0
    _log_info: Any = None
    _renew_token: Any = None
    _force_cookie: Any = None

    # -- plumbing ------------------------------------------------------
    def setup(self) -> None:
        super().setup()
        try:
            self.request.settimeout(self.server._mstate.config
                                    .request_timeout_s)
        except OSError:
            pass

    def log_message(self, *args: Any) -> None:  # keep stdout pure; stderr ours
        pass

    def log_request(self, *args: Any) -> None:  # allowlisted logging in _send
        pass

    def send_error(self, code: int, message: Any = None,
                   explain: Any = None) -> None:
        # Sanitized parser errors: JSON envelope + security headers, never
        # the default HTML echo (which can reflect request bytes). Attempt
        # the Host/TLS gate first when headers were already parsed.
        try:
            if self.headers:  # type: ignore[truthy-bool]
                host, port = _parse_authority(self)
                state: _State = self.server._mstate
                api_host = state.api_host
                if host != api_host and not (
                        host.endswith("." + state.config.content_suffix)
                        and D.valid_artifact_id(
                            host[:-(len(state.config.content_suffix) + 1)])):
                    raise DomainError("bad-host", "unknown Host")
                _check_production_port(state, host, port)
                if not _is_secure(state, self):
                    raise DomainError("tls-required", "TLS required")
        except DomainError as exc:
            self._emit_gate_fault(exc.code, exc.message)
            return
        except Exception:
            pass
        mapping = {400: ("bad-envelope", 400), 414: ("bad-envelope", 414),
                   505: ("bad-envelope", 505), 501: ("not-found", 404),
                   404: ("not-found", 404), 405: ("not-found", 404)}
        fault, status = mapping.get(code, ("bad-envelope", code))
        self._emit_gate_fault(fault, "", status=status)

    def _emit_gate_fault(self, code: str, message: str,
                         status: Optional[int] = None) -> None:
        try:
            self.request_version = getattr(self, "request_version",
                                           "HTTP/1.1") or "HTTP/1.1"
            self.command = getattr(self, "command", "") or ""
            self.requestline = getattr(self, "requestline", "") or ""
            self.close_connection = True
            self._send_raw(status or D.ERROR_STATUS.get(code, 400),
                           D.error_envelope(code, message),
                           {"Origin-Agent-Cluster": "?1",
                            "Cross-Origin-Opener-Policy": "same-origin",
                            "Cross-Origin-Resource-Policy": "same-origin",
                            "X-Content-Type-Options": "nosniff",
                            "Referrer-Policy": "no-referrer",
                            "Cache-Control": "no-store"})
        except (OSError, ValueError, AttributeError):
            pass

    def handle_one_request(self) -> None:
        # R7: admission is enforced in _HTTPServer.process_request (before
        # worker creation); the handler only parses and dispatches.
        super().handle_one_request()

    # -- low-level send --------------------------------------------------
    def _send_raw(self, status: int, body: bytes,
                  headers: dict[str, str],
                  extra: Optional[dict[str, str]] = None) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        for key, value in headers.items():
            self.send_header(key, value)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _base_headers(self, content_side: bool) -> dict[str, str]:
        headers = {
            "Origin-Agent-Cluster": "?1",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Resource-Policy": "same-origin",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            # R14: every dynamic/control/error response is no-store on both
            # origins (unlock shells, manifests, errors included).
            "Cache-Control": "no-store",
        }
        if content_side:
            headers["Content-Security-Policy"] = (
                "frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        return headers

    def _send(self, status: int, body: bytes,
              ctype: str = "application/json",
              content_side: bool = False,
              headers: Optional[dict[str, str]] = None,
              cookie: Optional[str] = None,
              retry_after: Optional[str] = None) -> None:
        all_headers = self._base_headers(content_side)
        all_headers["Content-Type"] = ctype
        if headers:
            all_headers.update(headers)
        if cookie is not None:
            all_headers["Set-Cookie"] = cookie
        extra = {"Retry-After": retry_after} if retry_after else None
        self._send_raw(status, body, all_headers, extra)
        # allowlisted access log (no secrets: labels + counts only)
        info = getattr(self, "_log_info", None)
        if info is not None:
            route, principal, nbytes = info
            elapsed = (time.monotonic() - self._start_t) * 1000.0
            sys.stderr.write(
                "manure rid=%s %s %s -> %d user=%s bytes=%d %.1fms\n"
                % (self._rid, self.command, route, status, principal,
                   nbytes, elapsed))

    def _fail(self, code: str, message: str = "",
              status: Optional[int] = None,
              content_side: bool = False,
              retry_after: Optional[str] = None) -> None:
        self._send(status or D.ERROR_STATUS.get(code, 400),
                   D.error_envelope(code, message),
                   content_side=content_side, retry_after=retry_after)

    # -- cookies ---------------------------------------------------------
    def _session_cookie(self, token: str, clear: bool = False) -> str:
        state: _State = self.server._mstate
        name = D.session_cookie_name(state.config.loopback_dev)
        parts = ["%s=%s" % (name, "" if clear else token), "Path=/",
                 "HttpOnly", "SameSite=Strict"]
        if not state.config.loopback_dev:
            parts.append("Secure")
        parts.append("Max-Age=%d" % (0 if clear else _SESSION_MAX_AGE))
        return "; ".join(parts)

    def _grant_cookie(self, value: str, max_age: int,
                      clear: bool = False) -> str:
        state: _State = self.server._mstate
        name = D.grant_cookie_name(state.config.loopback_dev)
        parts = ["%s=%s" % (name, "" if clear else value), "Path=/",
                 "HttpOnly", "SameSite=Lax"]
        if not state.config.loopback_dev:
            parts.append("Secure")
        parts.append("Max-Age=%d" % (0 if clear else max(1, max_age)))
        return "; ".join(parts)

    # -- request helpers ---------------------------------------------------
    def _drain(self, length: int) -> bool:
        """Discard up to length request-body bytes; False unless drained."""
        remaining = min(length, 1 << 24)
        try:
            while remaining > 0:
                block = self.rfile.read(min(65536, remaining))
                if not block:
                    break
                remaining -= len(block)
        except (OSError, ValueError):
            return False
        if remaining == 0 and length <= 1 << 24:
            return True
        return False

    def _content_length(self) -> int:
        getter = getattr(self.headers, "get_all", None)
        values = getter("Content-Length") if getter else [
            self.headers.get("Content-Length")]
        values = [v for v in (values or []) if v is not None]
        if not values:
            return 0
        if len(values) != 1:
            raise DomainError("bad-envelope", "ambiguous framing")
        try:
            length = int(values[0])
        except ValueError as exc:
            raise DomainError("bad-envelope", "bad framing") from exc
        if length < 0:
            raise DomainError("bad-envelope", "bad framing")
        return length

    def _check_framing(self) -> None:
        if self.headers.get("Transfer-Encoding") is not None:
            raise DomainError("bad-envelope", "chunked framing unsupported")
        self._content_length()  # validates singularity/shape now

    def _settle_body(self) -> None:
        """Drain-or-close pending request bytes so they never parse as HTTP."""
        if getattr(self, "_body_consumed", False):
            return
        try:
            length = self._content_length()
        except DomainError:
            self.close_connection = True
            return
        if length <= 0:
            self._body_consumed = True
            return
        if length <= (1 << 20) and self._drain(length):
            self._body_consumed = True
        else:
            self.close_connection = True

    def _read_body(self, cap: int) -> Optional[bytes]:
        length = self._content_length()
        self._body_consumed = False
        if length > cap:  # drain first so the client sees the 413, not RST
            if self._drain(length):
                self._body_consumed = True
            else:
                self.close_connection = True
            return None
        if length == 0:
            self._body_consumed = True
            return b""
        try:
            data = self.rfile.read(length)
        except (OSError, ValueError) as exc:
            # R5: a timed-out/stalled body read must never substitute a
            # successful empty body; close and fail before any mutation.
            self.close_connection = True
            raise DomainError("bad-envelope", "incomplete body") from exc
        if len(data) != length:  # incomplete read: framing lies, no side fx
            self.close_connection = True
            raise DomainError("bad-envelope", "incomplete body")
        self._body_consumed = True
        return data

    def _json(self, cap: int) -> Any:
        raw = self._read_body(cap)
        if raw is None:
            raise DomainError("too-large", "body too large")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype not in ("application/json", ""):
            # login/dashboard tolerate missing ctype; strict JSON elsewhere
            pass
        try:
            return json.loads(raw.decode("utf-8")) if raw else {}
        except (UnicodeDecodeError, ValueError) as exc:
            raise DomainError("bad-envelope", "bad JSON body") from exc

    # -- dispatch ----------------------------------------------------------
    def _dispatch(self) -> None:
        state: _State = self.server._mstate
        self._start_t = time.monotonic()
        self._rid = next(state.rids)
        self._log_info = ("unknown", "-", 0)
        self._renew_token = None
        self._force_cookie = None
        self._body_consumed = False
        self._side: Optional[str] = None
        try:
            self._check_framing()
            host, port = _parse_authority(self)
        except DomainError as exc:
            self.close_connection = True
            self._fail(exc.code, exc.message)
            return
        if host == state.api_host:
            side: Optional[str] = "api"
            aid = ""
        elif (host.endswith("." + state.config.content_suffix)
                and D.valid_artifact_id(
                    host[:-(len(state.config.content_suffix) + 1)])):
            side = "content"
            aid = host[:-(len(state.config.content_suffix) + 1)]
        else:
            self._fail("bad-host", "unknown Host")
            return
        self._side = side
        try:
            _check_production_port(state, host, port)
        except DomainError as exc:
            self._fail(exc.code, exc.message)
            return
        if state.config.loopback_dev and state.config.api_origin.startswith(
                "http://") and not D._is_loopback_host(host):
            self._fail("tls-required", "loopback http only")
            return
        if not _is_secure(state, self):
            self._fail("tls-required", "TLS required at edge")
            return
        if self.command not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
            self._fail("not-found", "unknown route", status=404)
            return
        try:
            if side == "api":
                self._handle_api()
            else:
                self._handle_content(aid)
        except DomainError as exc:
            # R14: keep origin-side context through errors (content CSP).
            self._fail(exc.code, exc.message,
                       content_side=(side == "content"))
        except StorageError as exc:
            if exc.code in ("session-limit", "rate-limited", "unavailable"):
                self._fail(exc.code, exc.message, retry_after="5",
                           content_side=(side == "content"))
            else:
                self._fail(exc.code, exc.message,
                           content_side=(side == "content"))
        except (OSError, sqlite3.Error) as exc:
            sys.stderr.write("manure rid=%s storage-fault %s\n"
                             % (self._rid, type(exc).__name__))
            self._fail("unavailable", "storage unavailable",
                       retry_after="5", content_side=(side == "content"))
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # allowlisted category only, never details
            sys.stderr.write("manure rid=%s internal-fault %s\n"
                             % (self._rid, type(exc).__name__))
            self.close_connection = True
        finally:
            if not self.close_connection:
                self._settle_body()

    do_GET = _dispatch
    do_POST = _dispatch
    do_PUT = _dispatch
    do_PATCH = _dispatch
    do_DELETE = _dispatch
    do_HEAD = _dispatch
    do_OPTIONS = _dispatch
    do_TRACE = _dispatch
    do_CONNECT = _dispatch

    # -- auth --------------------------------------------------------------
    def _auth(self) -> tuple[Optional[authmod.TokenIdentity], str]:
        """Return (identity, kind). Raises DomainError on ambiguity."""
        state: _State = self.server._mstate
        authz = self.headers.get("Authorization")
        cookies = authmod.parse_cookies(self.headers.get("Cookie"))
        session_name = D.session_cookie_name(state.config.loopback_dev)
        bearer: Optional[str] = None
        if authz is not None:
            scheme, sep, value = authz.partition(" ")
            if not sep or scheme != "Bearer" or not value:
                raise DomainError("unauthorized", "bad authorization")
            # R17: preserve the wire value exactly; padded values fail
            # canonical validation below instead of authenticating.
            bearer = value
        cookie_token = cookies.get(session_name)
        if bearer is not None and cookie_token is not None:
            raise DomainError("ambiguous-credentials", "two credentials")
        raw = bearer if bearer is not None else cookie_token
        if raw is None:
            return None, ""
        # R17: non-canonical values never authenticate, even if a matching
        # digest was somehow provisioned. No whitespace normalization.
        if not authmod.is_canonical_token(raw):
            raise DomainError("unauthorized", "malformed credential")
        digest = authmod.sha256_hex(raw)
        identity = None
        for stored, ident in state.token_map.items():
            if authmod.verify_token(raw, stored):
                identity = ident
                break
        _ = digest
        if identity is None:
            raise DomainError("unauthorized", "unknown token")
        return identity, ("bearer" if bearer is not None else "cookie")

    def _need_auth(self) -> authmod.TokenIdentity:
        identity, _kind = self._auth()
        if identity is None:
            raise DomainError("unauthorized", "authentication required")
        return identity

    def _origin(self) -> Optional[str]:
        getter = getattr(self.headers, "get_all", None)
        values = getter("Origin") if getter else [self.headers.get("Origin")]
        values = [v for v in (values or []) if v is not None]
        if not values:
            return None
        if len(values) != 1:
            return ""  # duplicate Origin never matches; gates fail closed
        return values[0]

    def _check_origin_api_mutation(self, kind: str) -> None:
        """§4: cookie mutations need exact api_origin; bearer tolerates absent."""
        state: _State = self.server._mstate
        origin = self._origin()
        if kind == "cookie":
            if origin != state.effective_origin:
                raise DomainError("forbidden", "origin check failed")
        elif origin is not None and origin != state.effective_origin:
            raise DomainError("forbidden", "origin check failed")

    def _mutation_gate(self, identity: authmod.TokenIdentity,
                       kind: str) -> None:
        state: _State = self.server._mstate
        self._check_origin_api_mutation(kind)
        if not state.throttle.allow("mut:" + identity.user_id,
                                    state.config.rate_limit_per_min,
                                    state.now()):
            raise DomainError("rate-limited", "too many mutations")

    # -- API ---------------------------------------------------------------
    def _summary(self, item: dict[str, Any]) -> dict[str, Any]:
        state: _State = self.server._mstate
        return {
            "artifact_id": item["id"], "name": item["name"],
            "kind": item["kind"], "visibility": item["visibility"],
            "state": item["state"],
            "created_by_user": item["created_by_user"],
            "created_at": item["created_at"],
            "expires_at": item["expires_at"],
            "total_bytes": item["total_bytes"],
            "file_count": item["file_count"],
            "content_url": self._content_url(item["id"]),
        }

    def _content_url(self, aid: str) -> str:
        return _content_origin(self.server._mstate, aid)

    def _expired_fail(self, authed: bool, content_side: bool = False) -> None:
        # R15: 410 for authenticated API reads, 404 for anonymous/content.
        self._fail("expired", "artifact expired",
                   status=410 if authed else 404, content_side=content_side)

    def _handle_api(self) -> None:
        state: _State = self.server._mstate
        split = urllib.parse.urlsplit(self.path)
        path = split.path
        query = urllib.parse.parse_qs(split.query, keep_blank_values=True)
        method = self.command
        if path == "/api/v1/health" and method == "GET":
            self._log_info = ("health", "-", 0)
            self._send(200, json.dumps({"ok": True,
                                        "version": _VERSION}).encode())
            return
        if path == "/api/v1/login" and method == "POST":
            self._api_login()
            return
        identity, kind = self._auth()
        # bearer mismatch-Origin rejected on every non-login call (§4/§5.7)
        if identity is not None and kind == "bearer":
            origin = self._origin()
            if origin is not None and origin != state.effective_origin:
                self._log_info = ("auth", identity.user_id, 0)
                raise DomainError("forbidden", "origin check failed")
        principal = identity.user_id if identity else "-"
        renew = (kind == "cookie" and identity is not None)
        self._renew_token = (self._raw_session_token()
                             if renew else None)
        if path == "/api/v1/logout" and method == "POST":
            self._need_auth_logged(identity, "logout", principal)
            self._mutation_gate(identity, kind)  # type: ignore[arg-type]
            self._api_logout()
            return
        if path == "/api/v1/whoami" and method == "GET":
            ident = self._need_auth_logged(identity, "whoami", principal)
            self._send_json({"user_id": ident.user_id, "type": ident.user_type,
                             "token_id": ident.token_id})
            return
        if path == "/api/v1/artifacts" and method == "GET":
            ident = self._need_auth_logged(identity, "list", principal)
            self._api_list(query, ident)
            return
        if path == "/api/v1/artifacts:init" and method == "POST":
            ident = self._need_auth_logged(identity, "init", principal)
            self._mutation_gate(ident, kind)
            self._api_init(ident)
            return
        parts = path.split("/")
        # /api/v1/artifacts/<id>[/...]
        if len(parts) >= 5 and parts[1] == "api" and parts[2] == "v1" \
                and parts[3] == "artifacts" and D.valid_artifact_id(parts[4]):
            aid = parts[4]
            rest = parts[5:]
            if not rest and method == "GET":
                ident = self._need_auth_logged(identity, "info", principal)
                self._api_info(aid, ident, True)
                return
            if not rest and method == "PATCH":
                ident = self._need_auth_logged(identity, "patch", principal)
                self._mutation_gate(ident, kind)
                self._api_patch(aid, ident)
                return
            if not rest and method == "DELETE":
                ident = self._need_auth_logged(identity, "delete", principal)
                self._mutation_gate(ident, kind)
                self._api_delete(aid)
                return
            if rest == ["files"] and method == "GET":
                self._api_files(aid, identity, principal)
                return
            if rest == ["upload-status"] and method == "GET":
                ident = self._need_auth_logged(identity, "status", principal)
                self._api_status(aid, ident)
                return
            if rest == ["chunks"] and method == "PUT":
                ident = self._need_auth_logged(identity, "chunks", principal)
                self._mutation_gate(ident, kind)
                self._api_chunks(aid, ident, query)
                return
            if rest == ["publish"] and method == "POST":
                ident = self._need_auth_logged(identity, "publish", principal)
                self._mutation_gate(ident, kind)
                self._api_publish(aid, ident)
                return
            if rest == ["grants"] and method == "POST":
                ident = self._need_auth_logged(identity, "grants", principal)
                self._mutation_gate(ident, kind)
                self._api_grants(aid, ident, kind)
                return
            if len(rest) == 1 and rest[0] == "external-password:rotate" \
                    and method == "POST":
                ident = self._need_auth_logged(identity, "rotate", principal)
                self._mutation_gate(ident, kind)
                self._api_rotate(aid, ident)
                return
            if len(rest) >= 2 and rest[0] == "files" and rest[-1] == "content" \
                    and method == "GET":
                enc = "/".join(rest[1:-1])
                self._api_file_content(aid, enc, identity, principal)
                return
        if path == "/" and method == "GET":
            self._serve_dashboard(identity, principal)
            return
        if state.dashboard_dir is not None and method == "GET" \
                and not path.startswith("/api/"):
            self._serve_dashboard_asset(path, identity, principal)
            return
        self._log_info = ("not-found", principal, 0)
        self._fail("not-found", "unknown route", status=404)

    def _raw_session_token(self) -> Optional[str]:
        state: _State = self.server._mstate
        cookies = authmod.parse_cookies(self.headers.get("Cookie"))
        return cookies.get(D.session_cookie_name(state.config.loopback_dev))

    def _need_auth_logged(self, identity: Optional[authmod.TokenIdentity],
                          route: str, principal: str
                          ) -> authmod.TokenIdentity:
        if identity is None:
            self._log_info = (route, "-", 0)
            raise DomainError("unauthorized", "authentication required")
        self._log_info = (route, identity.user_id, 0)
        return identity

    def _send_json(self, obj: Any, status: int = 200,
                   content_side: bool = False,
                   headers: Optional[dict[str, str]] = None) -> None:
        cookie = self._force_cookie
        if cookie is None and self._renew_token:
            cookie = self._session_cookie(self._renew_token)
        body = json.dumps(obj).encode()
        route, principal, _n = self._log_info
        self._log_info = (route, principal, len(body))
        self._send(status, body, content_side=content_side, headers=headers,
                   cookie=cookie)

    # -- API endpoints -------------------------------------------------------
    def _api_login(self) -> None:
        state: _State = self.server._mstate
        if self._origin() != state.effective_origin:
            self._log_info = ("login", "-", 0)
            raise DomainError("forbidden", "login requires exact Origin")
        peer = self.client_address[0]
        if not state.throttle.allow("login:" + peer,
                                    state.config.login_rate_per_min_per_ip,
                                    state.now()):
            self._log_info = ("login", "-", 0)
            self._fail("rate-limited", "too many logins", retry_after="60")
            return
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        raw = self._read_body(state.config.max_request_body_bytes)
        if raw is None:
            raise DomainError("too-large", "body too large")
        token: Optional[str] = None
        form = False
        if ctype == "application/x-www-form-urlencoded":
            form = True
            parsed = urllib.parse.parse_qs(raw.decode("utf-8", "replace"))
            values = parsed.get("token", [])
            token = values[0] if values else None
        else:
            try:
                obj = json.loads(raw.decode("utf-8")) if raw else {}
            except (UnicodeDecodeError, ValueError) as exc:
                raise DomainError("bad-envelope", "bad login body") from exc
            if isinstance(obj, dict):
                token = obj.get("token")
        identity = None
        if isinstance(token, str) and authmod.is_canonical_token(token):
            for stored, ident in state.token_map.items():
                if authmod.verify_token(token, stored):
                    identity = ident
                    break
        if identity is None:
            self._log_info = ("login", "-", 0)
            raise DomainError("unauthorized", "bad token")
        self._log_info = ("login", identity.user_id, 0)
        cookie = self._session_cookie(token)  # type: ignore[arg-type]
        payload = {"user_id": identity.user_id, "type": identity.user_type,
                   "token_id": identity.token_id}
        if form:
            self._send(303, b"", headers={"Location": "/"}, cookie=cookie)
        else:
            self._force_cookie = cookie
            try:
                self._send_json(payload)
            finally:
                self._force_cookie = None

    def _require_body(self, cap: int) -> bytes:
        raw = self._read_body(cap)
        if raw is None:
            raise DomainError("too-large", "body too large")
        return raw

    def _api_logout(self) -> None:
        # R5: the body cap is enforced BEFORE any revocation side effect.
        self._require_body(
            self.server._mstate.config.max_request_body_bytes)
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        # R3: revoke this credential's server-side grants (token itself lives).
        identity, _kind = self._auth()
        if identity is not None:
            self.server._mstate.store.revoke_credential_grants(
                identity.user_id, identity.token_id)
        self._renew_token = None
        clear = self._session_cookie("", clear=True)
        if ctype == "application/x-www-form-urlencoded":
            self._send(303, b"", headers={"Location": "/"}, cookie=clear)
        else:
            self._send(200, json.dumps({"ok": True}).encode(), cookie=clear)

    def _api_list(self, query: dict[str, list[str]],
                  ident: authmod.TokenIdentity) -> None:
        state: _State = self.server._mstate
        try:
            limit = int((query.get("limit") or ["50"])[0])
        except ValueError as exc:
            raise DomainError("bad-envelope", "bad limit") from exc
        limit = max(1, min(limit, state.config.max_list_limit))
        cursor = (query.get("cursor") or [""])[0]
        include = (query.get("include_expired") or ["false"])[0].lower() \
            in ("1", "true", "yes")
        visibility = (query.get("visibility") or [None])[0]
        fstate = (query.get("state") or [None])[0]
        if visibility is not None and visibility not in (
                "internal", "external", "public"):
            raise DomainError("bad-envelope", "bad visibility filter")
        if fstate is not None and fstate not in (
                "uploading", "publishing", "ready"):
            raise DomainError("bad-envelope", "bad state filter")
        items, next_cursor = state.store.list_artifacts(
            limit, cursor, include, visibility, fstate)
        _ = ident
        self._send_json({"artifacts": [self._summary_with_state(i)
                                       for i in items],
                         "next_cursor": next_cursor})

    def _summary_with_state(self, item: dict[str, Any]) -> dict[str, Any]:
        return self._summary(item)

    _INIT_FIELDS = frozenset(("name", "kind", "visibility",
                              "expires_in_s", "files"))
    _PATCH_FIELDS = frozenset(("name", "visibility", "expires_in_s"))

    def _api_init(self, ident: authmod.TokenIdentity) -> None:
        state: _State = self.server._mstate
        obj = self._json(state.config.max_request_body_bytes)
        if not isinstance(obj, dict):
            raise DomainError("bad-envelope", "object body required")
        unknown = sorted(set(obj.keys()) - self._INIT_FIELDS)
        if unknown:
            raise DomainError("bad-envelope",
                              "unknown init fields: %s" % ",".join(unknown))
        try:
            out = state.store.init_artifact(
                ident.user_id, ident.token_id, obj.get("name"),
                obj.get("kind"), obj.get("visibility"), obj.get("files"),
                obj.get("expires_in_s"))
        except DomainError as exc:
            raise exc
        except StorageError as exc:
            raise exc
        resp: dict[str, Any] = {"artifact_id": out["id"],
                                "chunk_bytes": state.config.chunk_bytes,
                                "content_url": self._content_url(out["id"])}
        if "external_password" in out:
            resp["external_password"] = out["external_password"]
        route, principal, _n = self._log_info
        self._log_info = (route, principal, out["total_bytes"])
        self._send_json(resp)

    def _lookup(self, aid: str) -> dict[str, Any]:
        item = self.server._mstate.store.get_artifact(aid)
        if item is None:
            raise DomainError("not-found", "no such artifact")
        return item

    def _api_info(self, aid: str, ident: authmod.TokenIdentity,
                  authed: bool) -> None:
        _ = ident
        item = self._lookup(aid)
        if self.server._mstate.store.is_expired(
                item, self.server._mstate.now()):
            self._expired_fail(True)
            return
        self._send_json(self._summary(item))

    def _api_patch(self, aid: str, ident: authmod.TokenIdentity) -> None:
        state: _State = self.server._mstate
        obj = self._json(state.config.max_request_body_bytes)
        if not isinstance(obj, dict):
            raise DomainError("bad-envelope", "object body required")
        unknown = sorted(set(obj.keys()) - self._PATCH_FIELDS)
        if unknown:
            raise DomainError("bad-envelope",
                              "unknown patch fields: %s" % ",".join(unknown))
        kwargs: dict[str, Any] = {}
        if "name" in obj:
            kwargs["name"] = obj["name"]
        if "visibility" in obj:
            kwargs["visibility"] = obj["visibility"]
        kwargs["expires_in_s"] = obj.get("expires_in_s", UNSET)
        if kwargs["expires_in_s"] is UNSET:
            del kwargs["expires_in_s"]
        try:
            out = state.store.patch_artifact(ident.user_id, aid, **kwargs)
        except StorageError as exc:
            if exc.code == "not-found":
                raise DomainError("not-found", exc.message)
            raise
        resp = self._summary(out)
        if "external_password" in out:
            resp["external_password"] = out["external_password"]
        self._send_json(resp)

    def _api_delete(self, aid: str) -> None:
        # R5: the non-chunk body cap applies before the destructive effect.
        self._require_body(
            self.server._mstate.config.max_request_body_bytes)
        ok = self.server._mstate.store.delete_artifact(aid)
        if not ok:
            raise DomainError("not-found", "no such artifact")
        self._send_json({"ok": True})

    def _api_rotate(self, aid: str, ident: authmod.TokenIdentity) -> None:
        _ = ident
        self._require_body(
            self.server._mstate.config.max_request_body_bytes)
        try:
            password = self.server._mstate.store.rotate_password(aid)
        except StorageError as exc:
            if exc.code == "not-found":
                raise DomainError("not-found", exc.message)
            raise
        self._send_json({"external_password": password})

    def _api_files(self, aid: str, identity: Optional[authmod.TokenIdentity],
                   principal: str) -> None:
        state: _State = self.server._mstate
        item = self._lookup(aid)
        # R15: expiry status follows authentication, not visibility: 410 for
        # authenticated API reads, 404 for anonymous ones.
        if state.store.is_expired(item, state.now()):
            self._expired_fail(identity is not None)
            return
        if item["visibility"] != "public" and identity is None:
            self._log_info = ("files", "-", 0)
            raise DomainError("unauthorized", "authentication required")
        if identity is not None:
            self._log_info = ("files", identity.user_id, 0)
        _ = principal
        files = []
        for entry in item["manifest"]:
            if entry["kind"] == "dir":
                files.append({"path": entry["path"], "kind": "dir"})
            else:
                files.append({"path": entry["path"], "kind": "file",
                              "size": entry["size"],
                              "sha256": entry["sha256"]})
        self._send_json({"artifact_id": aid, "state": item["state"],
                         "files": files})

    def _api_status(self, aid: str, ident: authmod.TokenIdentity) -> None:
        _ = ident
        item = self._lookup(aid)
        if self.server._mstate.store.is_expired(
                item, self.server._mstate.now()):
            self._expired_fail(True)
            return
        try:
            status = self.server._mstate.store.upload_status(aid)
        except StorageError as exc:
            raise DomainError("not-found", exc.message)
        status["chunk_bytes"] = self.server._mstate.config.chunk_bytes
        self._send_json(status)

    def _api_chunks(self, aid: str, ident: authmod.TokenIdentity,
                    query: dict[str, list[str]]) -> None:
        state: _State = self.server._mstate
        paths = query.get("path")
        offsets = query.get("offset")
        if not paths or not offsets:
            raise DomainError("bad-envelope", "path+offset required")
        path = paths[0]
        try:
            offset = int(offsets[0])
        except ValueError as exc:
            raise DomainError("invalid-range", "bad offset") from exc
        sha = self.headers.get("X-Chunk-Sha256")
        if not sha:
            raise DomainError("bad-envelope", "X-Chunk-Sha256 required")
        if len(sha) != 64:
            raise DomainError("invalid-range", "bad chunk hash")
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "application/octet-stream":
            raise DomainError("bad-envelope", "chunk must be octet-stream")
        body = self._read_body(state.config.chunk_bytes)
        if body is None:
            raise DomainError("too-large", "chunk exceeds chunk_bytes")
        length = len(body)
        item = self._lookup(aid)
        if state.store.is_expired(item, state.now()):
            self._expired_fail(True)
            return
        try:
            ack = state.store.put_chunk(ident.user_id, aid, path, offset,
                                        body, sha)
        except StorageError as exc:
            if exc.code == "not-found":
                # unknown path -> 404; missing artifact handled by _lookup
                raise DomainError("not-found", exc.message)
            raise
        route, principal, _n = self._log_info
        self._log_info = (route, principal, len(body))
        self._send_json(ack)

    def _api_publish(self, aid: str, ident: authmod.TokenIdentity) -> None:
        state: _State = self.server._mstate
        self._require_body(state.config.max_request_body_bytes)
        item = self._lookup(aid)
        if state.store.is_expired(item, state.now()):
            self._expired_fail(True)
            return
        try:
            out = state.store.publish(ident.user_id, aid)
        except StorageError as exc:
            if exc.code == "not-found":
                raise DomainError("not-found", exc.message)
            raise
        self._send_json({"artifact_id": aid, "state": out["state"],
                         "content_url": self._content_url(aid)})

    def _api_grants(self, aid: str, ident: authmod.TokenIdentity,
                      kind: str) -> None:
        state: _State = self.server._mstate
        self._require_body(state.config.max_request_body_bytes)
        item = self._lookup(aid)
        if state.store.is_expired(item, state.now()):
            self._expired_fail(True)
            return
        if item["visibility"] != "internal" or item["state"] != "ready":
            raise DomainError("invalid-visibility",
                              "grants are for ready internal artifacts")
        digest = self._credential_digest(ident, kind)
        if not _credential_live(state, ident.user_id, ident.token_id, digest):
            raise DomainError("unauthorized", "credential revoked")
        grant = state.store.create_one_time_grant(
            aid, ident.user_id, ident.user_id, ident.token_id, digest)
        self._send_json({"grant": grant,
                         "expires_in_s": state.config.one_time_grant_ttl_s})

    # Payload file access. R13: rooted, component-wise lstat, leaf opened
    # O_NOFOLLOW; never realpath-then-open (no check/open gap), never
    # follow intra-tree symlinks. R6: ranges validated from fstat before
    # any byte is read; only the requested interval streams in bounded
    # buffers (no whole-file fh.read()).
    _STREAM_BLOCK = 65536
    _payload_open = staticmethod(os.open)

    def _resolve_payload_fd(self, item: dict[str, Any], rel: str) -> int:
        # R13: rooted descriptor-relative resolution from the validated
        # data_dir — every ancestor pinned via open fds, leaf opened
        # O_NOFOLLOW, so parent replacement between check and open cannot
        # redirect the read. data_dir/live/aid ancestors are validated too.
        # R9: the storage root identity is pinned (fail closed on replace).
        if not rel:
            raise DomainError("invalid-path", "empty file path")
        from manure.storage import _resolve_parent as _chain
        from manure.storage import StorageError as _StoreError
        store = self.server._mstate.store
        data_dir = store.data_dir
        expected = getattr(store, "_root_id", None)
        try:
            store._assert_root_identity()
        except _StoreError:
            raise DomainError("not-found", "no such file")
        segments = rel.split("/")
        try:
            with _chain(data_dir, ["live", item["id"]] + segments[:-1],
                        create=False, expected=expected) as (parent_fd, _fds):
                try:
                    fd = self._payload_open(
                        segments[-1], os.O_RDONLY | _O_NOFOLLOW,
                        dir_fd=parent_fd)
                except OSError:
                    raise DomainError("not-found", "no such file")
                try:
                    import stat as _stat
                    st = os.fstat(fd)
                except OSError:
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                    raise DomainError("not-found", "no such file")
                if not _stat.S_ISREG(st.st_mode):
                    try:
                        os.close(fd)
                    except OSError:
                        pass
                    raise DomainError("not-found", "no such file")
                return fd
        except _StoreError:
            # Missing and tampered topologies share one observable: the
            # bytes are not served (no topology oracle, no external read).
            raise DomainError("not-found", "no such file")

    @staticmethod
    def _content_disposition(filename: str) -> str:
        # R2: safe ASCII fallback + RFC 5987 encoded parameter; control
        # characters can never reach the header (also rejected at init).
        base = filename.rsplit("/", 1)[-1] or "file"
        fallback = "".join(ch if 0x20 <= ord(ch) < 0x7f
                             and ch not in ('"', "\\") else "_"
                             for ch in base) or "file"
        encoded = urllib.parse.quote(base, safe="")
        return ("attachment; filename=\"%s\"; filename*=UTF-8''%s"
                % (fallback, encoded))

    @staticmethod
    def _redirect_location(rel: str) -> str:
        # R2: percent-encode redirect targets; never interpolate decoded
        # strings (which may hold '?', '#', '%' or non-Latin-1) directly.
        return "/" + urllib.parse.quote(rel, safe="/") + "/"

    def _serve_fd_range(self, fd: int, size: int,
                        attachment_name: Optional[str],
                        inline_ctype: Optional[str],
                        content_side: bool) -> None:
        range_header = self.headers.get("Range")
        headers: dict[str, str] = {"Accept-Ranges": "bytes"}
        if attachment_name is not None:
            headers["Content-Disposition"] = self._content_disposition(
                attachment_name)
            ctype = "application/octet-stream"
        else:
            ctype = inline_ctype or "application/octet-stream"
        if not range_header:
            self._send_stream(200, ctype, size, fd, 0, size,
                              content_side=content_side, headers=headers)
            return
        parsed = self._parse_range(range_header, size)
        if parsed is None:
            os.close(fd)
            self._send(416, D.error_envelope("invalid-range", "bad range"),
                       content_side=content_side,
                       headers={**headers,
                                "Content-Range": "bytes */%d" % size})
            return
        start, end = parsed
        headers["Content-Range"] = "bytes %d-%d/%d" % (start, end - 1, size)
        self._send_stream(206, ctype, end - start, fd, start, end,
                          content_side=content_side, headers=headers)

    def _send_stream(self, status: int, ctype: str, length: int, fd: int,
                     start: int, end: int, content_side: bool,
                     headers: Optional[dict[str, str]] = None,
                     cookie: Optional[str] = None) -> None:
        all_headers = self._base_headers(content_side)
        all_headers["Content-Type"] = ctype
        if headers:
            all_headers.update(headers)
        if cookie is not None:
            all_headers["Set-Cookie"] = cookie
        try:
            self.send_response(status)
            self.send_header("Content-Length", str(length))
            for key, value in all_headers.items():
                self.send_header(key, value)
            self.end_headers()
            # R6: bounded streaming; the fd always closes.
            remaining = end - start
            offset = start
            while remaining > 0:
                block = os.pread(fd, min(self._STREAM_BLOCK, remaining),
                                 offset)
                if not block:
                    break
                self.wfile.write(block)
                offset += len(block)
                remaining -= len(block)
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
        route, principal, _n = self._log_info
        self._log_info = (route, principal, length)

    @staticmethod
    def _parse_range(header: str, size: int) -> Optional[tuple[int, int]]:
        if not header.startswith("bytes="):
            return None
        spec = header[len("bytes="):].strip()
        if "," in spec:
            return None
        if spec.startswith("-"):
            try:
                suffix = int(spec[1:])
            except ValueError:
                return None
            if suffix <= 0:
                return None
            start = max(0, size - suffix)
            return (start, size) if start < size else None
        first, sep, last = spec.partition("-")
        if not sep:
            return None
        try:
            start = int(first)
            end = int(last) + 1 if last else size
        except ValueError:
            return None
        if start >= size or end <= start:
            return None
        return start, min(end, size)

    def _api_file_content(self, aid: str, enc: str,
                          identity: Optional[authmod.TokenIdentity],
                          principal: str) -> None:
        state: _State = self.server._mstate
        try:
            decoded, trailing = _decode_content_path("/" + enc)
        except DomainError as exc:
            raise exc
        _ = trailing
        item = self._lookup(aid)
        # R15: expiry status follows authentication, not visibility.
        if state.store.is_expired(item, state.now()):
            self._expired_fail(identity is not None)
            return
        needs_auth = item["visibility"] != "public"
        if needs_auth and identity is None:
            self._log_info = ("content", "-", 0)
            raise DomainError("unauthorized", "authentication required")
        if identity is not None:
            self._log_info = ("content", identity.user_id, 0)
        _ = principal
        if item["state"] != "ready":
            raise DomainError("incomplete-upload", "not published")
        # R13: API downloads require the same manifest exact-match as the
        # content controls; unexpected live files are never served here.
        if not any(e["kind"] == "file" and e["path"] == decoded
                   for e in item["manifest"]):
            raise DomainError("not-found", "no such file")
        self._serve_live_file(item, decoded, attachment=True,
                              content_side=False)

    def _serve_live_file(self, item: dict[str, Any], rel: str,
                         attachment: bool, content_side: bool) -> None:
        fd = self._resolve_payload_fd(item, rel)
        try:
            size = os.fstat(fd).st_size
        except OSError:
            try:
                os.close(fd)
            except OSError:
                pass
            raise DomainError("unavailable", "unreadable file")
        if attachment:
            name = rel.rsplit("/", 1)[-1] or "file"
            self._serve_fd_range(fd, size, name, None,
                                 content_side=content_side)
        else:
            ctype, _enc = mimetypes.guess_type(rel)
            if rel.endswith((".html", ".htm")):
                ctype = "text/html; charset=utf-8"
            self._serve_fd_range(fd, size, None,
                                 ctype or "application/octet-stream",
                                 content_side=content_side)

    # -- dashboard -----------------------------------------------------------
    def _dashboard_csp(self) -> str:
        state: _State = self.server._mstate
        parts = urllib.parse.urlsplit(state.effective_origin)
        default_port = 443 if parts.scheme == "https" else 80
        host = "*.%s" % state.config.content_suffix
        # Contract clarification: the wildcard MUST include the effective
        # non-default content port, else local handoff forms are CSP-blocked.
        if parts.port and parts.port != default_port:
            host += ":%d" % parts.port
        return ("default-src 'self'; base-uri 'none'; frame-ancestors 'none'; "
                "form-action 'self' %s://%s; object-src 'none'"
                % (parts.scheme, host))

    def _serve_dashboard(self, identity: Optional[authmod.TokenIdentity],
                         principal: str) -> None:
        state: _State = self.server._mstate
        self._log_info = ("dashboard", principal, 0)
        _ = identity
        if state.dashboard_dir is None:
            self._fail("dashboard-disabled", "dashboard disabled")
            return
        index = os.path.join(state.dashboard_dir, "index.html")
        try:
            with open(index, "rb") as fh:
                data = fh.read()
        except OSError:
            self._fail("not-found", "no dashboard")
            return
        # Precision decision: dashboard HTML (navigational grant-handoff
        # form) uses origin-only policy so Chromium sends a real Origin;
        # API JSON and uploaded bytes stay no-referrer.
        self._send(200, data, ctype="text/html; charset=utf-8",
                   headers={"Content-Security-Policy": self._dashboard_csp(),
                            "Referrer-Policy": "strict-origin"})

    def _serve_dashboard_asset(self, path: str,
                               identity: Optional[authmod.TokenIdentity],
                               principal: str) -> None:
        state: _State = self.server._mstate
        assert state.dashboard_dir is not None
        self._log_info = ("dashboard-asset", principal, 0)
        _ = identity
        rel = path.lstrip("/")
        full = os.path.realpath(os.path.join(state.dashboard_dir, rel))
        base = os.path.realpath(state.dashboard_dir)
        if full != base and not full.startswith(base + os.sep):
            raise DomainError("invalid-path", "traversal")
        try:
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            raise DomainError("not-found", "no such asset")
        ctype, _enc = mimetypes.guess_type(full)
        self._send(200, data, ctype=ctype or "application/octet-stream",
                   headers={"Content-Security-Policy": self._dashboard_csp()})

    # -- content host ----------------------------------------------------------
    def _credential_digest(self, identity: authmod.TokenIdentity,
                           kind: str) -> str:
        """Digest of the presented credential (bearer header or session
        cookie); the identity itself was resolved from the live map."""
        raw: Optional[str] = None
        if kind == "bearer":
            authz = self.headers.get("Authorization") or ""
            _, _, raw = authz.partition(" ")
            # R17: exact wire value (no trim); empty stays None.
            raw = raw or None
        else:
            raw = self._raw_session_token()
        return authmod.sha256_hex(raw or "")

    def _content_auth_ok(self, item: dict[str, Any]) -> bool:
        state: _State = self.server._mstate
        if item["visibility"] == "public":
            return True
        cookies = authmod.parse_cookies(self.headers.get("Cookie"))
        value = cookies.get(D.grant_cookie_name(state.config.loopback_dev))
        if not value:
            return False
        record = state.store.lookup_content_grant(value, item["id"])
        if record is None:
            return False
        # R3: revalidate the persisted binding on every authorized read.
        if record.get("user_id"):
            return _credential_live(state, record.get("user_id") or "",
                                    record.get("token_id") or "",
                                    record.get("token_digest") or "")
        if record.get("pwd_hash"):
            return record["pwd_hash"] == item.get("ext_pwd_hash") \
                and item.get("ext_pwd_hash") is not None
        return False

    def _handle_content(self, aid: str) -> None:
        state: _State = self.server._mstate
        split = urllib.parse.urlsplit(self.path)
        raw_path = split.path or "/"
        method = self.command
        if raw_path == "/api" or raw_path.startswith("/api/"):
            self._log_info = ("content-api", "-", 0)
            self._fail("not-found", "no API on content hosts",
                       content_side=True)
            return
        if raw_path == "/__manure/grant" and method == "POST":
            self._content_grant(aid)
            return
        if raw_path == "/__manure/unlock" and method == "POST":
            self._content_unlock(aid)
            return
        if raw_path == "/__manure/logout" and method == "POST":
            self._content_logout(aid)
            return
        if raw_path == "/__manure/password" and method == "GET":
            self._content_password_page(aid)
            return
        if raw_path == "/__manure/manifest" and method == "GET":
            self._content_manifest(aid)
            return
        if raw_path.startswith("/__manure/files/") and raw_path.endswith(
                "/content") and method == "GET":
            enc = raw_path[len("/__manure/files/"):-len("/content")]
            self._content_file(aid, enc)
            return
        if raw_path.startswith("/__manure/"):
            self._log_info = ("content-ctl", "-", 0)
            self._fail("not-found", "unknown control", content_side=True)
            return
        if method != "GET":
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "unknown route", content_side=True)
            return
        try:
            decoded, trailing = _decode_content_path(raw_path)
        except DomainError as exc:
            self._log_info = ("content", "-", 0)
            raise exc
        if decoded and decoded.split("/")[0] in D.RESERVED_TOP_SEGMENTS:
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "reserved", content_side=True)
            return
        item = self.server._mstate.store.get_artifact(aid)
        if item is None:
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "no such artifact", content_side=True)
            return
        if state.store.is_expired(item, state.now()):
            self._log_info = ("content", "-", 0)
            self._expired_fail(False, content_side=True)
            return
        if item["state"] != "ready":
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "not ready", content_side=True)
            return
        if not self._content_auth_ok(item):
            self._content_denied(item, decoded)
            return
        self._log_info = ("content", "grant", 0)
        self._serve_content_path(item, decoded, trailing)

    def _serve_shell_asset(self, rel: str) -> bool:
        """Serve a trusted unlock-shell sibling asset while locked (F2).
        Manifest user files always win (checked by callers first via auth);
        unknown paths fall through to 404, never the password form."""
        state: _State = self.server._mstate
        base = state.unlock_shell_dir
        if base is None or not rel or rel.startswith("."):
            return False
        full = os.path.realpath(os.path.join(base, rel))
        if full != os.path.realpath(base) and \
                not full.startswith(os.path.realpath(base) + os.sep):
            return False
        try:
            if not os.path.isfile(full):
                return False
            with open(full, "rb") as fh:
                data = fh.read()
        except OSError:
            return False
        ctype, _enc = mimetypes.guess_type(full)
        self._log_info = ("shell-asset", "-", 0)
        self._send(200, data, ctype=ctype or "application/octet-stream",
                   content_side=True)
        return True

    def _content_denied(self, item: dict[str, Any], rel: str = "") -> None:
        if item["visibility"] == "external":
            if rel == "":
                # Entry point: password form (origin-only policy so the
                # navigational unlock POST carries a real Origin).
                self._log_info = ("password-form", "-", 0)
                self._send(200, self._unlock_form("").encode(),
                           ctype="text/html; charset=utf-8",
                           content_side=True,
                           headers={"Referrer-Policy": "strict-origin"})
                return
            # F2: locked sibling shell assets serve trusted bytes;
            # anything else is 404 JSON, never form HTML.
            if self._serve_shell_asset(rel):
                return
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "no such file", content_side=True)
        else:
            self._log_info = ("content", "-", 0)
            self._fail("grant-required", "grant cookie required",
                       content_side=True)

    def _manifest_entries(self, item: dict[str, Any]) -> list[dict[str, Any]]:
        return item["manifest"]

    def _serve_content_path(self, item: dict[str, Any], rel: str,
                            trailing: bool) -> None:
        manifest = self._manifest_entries(item)
        if item["kind"] == "file":
            single = manifest[0]["path"] if manifest else ""
            if rel in ("", single):
                self._serve_live_file(item, single, attachment=False,
                                      content_side=True)
                return
            raise DomainError("not-found", "no such file")
        # dir artifact
        for entry in manifest:
            if entry["kind"] == "file" and entry["path"] == rel and rel:
                if trailing:
                    raise DomainError("not-found", "not a file")
                self._serve_live_file(item, rel, attachment=False,
                                      content_side=True)
                return
        is_dir = any(e["path"] == rel and e["kind"] == "dir" for e in manifest) \
            or any(e["path"].startswith(rel + "/") for e in manifest) \
            if rel else True
        if rel and is_dir and not trailing:
            self._send(303, b"", ctype="text/plain", content_side=True,
                       headers={"Location": self._redirect_location(rel)})
            return
        base = rel + "/" if rel else ""
        for candidate in (base + "index.html", base + "index.htm"):
            if any(e["kind"] == "file" and e["path"] == candidate
                   for e in manifest):
                self._serve_live_file(item, candidate, attachment=False,
                                      content_side=True)
                return
        raise DomainError("not-found", "no index")

    def _own_origin(self, aid: str) -> str:
        return _content_origin(self.server._mstate, aid)

    def _read_form(self) -> tuple[str, dict[str, str], bytes]:
        state: _State = self.server._mstate
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        raw = self._read_body(state.config.max_request_body_bytes)
        if raw is None:
            raise DomainError("too-large", "body too large")
        if ctype == "application/json":
            try:
                obj = json.loads(raw.decode("utf-8")) if raw else {}
            except (UnicodeDecodeError, ValueError) as exc:
                raise DomainError("bad-envelope", "bad JSON") from exc
            if not isinstance(obj, dict):
                raise DomainError("bad-envelope", "object required")
            return "json", {k: v for k, v in obj.items()
                            if isinstance(v, str)}, raw
        if ctype == "application/x-www-form-urlencoded":
            parsed = urllib.parse.parse_qs(raw.decode("utf-8", "replace"))
            return "form", {k: v[0] for k, v in parsed.items() if v}, raw
        raise DomainError("bad-envelope", "unsupported content type")

    def _content_grant(self, aid: str) -> None:
        state: _State = self.server._mstate
        self._log_info = ("grant-redeem", "-", 0)
        item = state.store.get_artifact(aid)
        if item is None:
            self._fail("not-found", "no such artifact", content_side=True)
            return
        if state.store.is_expired(item, state.now()):
            self._expired_fail(False, content_side=True)
            return
        if self._origin() != state.effective_origin:
            raise DomainError("forbidden", "origin check failed")
        try:
            kind, fields, _raw = self._read_form()
        except DomainError as exc:
            if exc.code == "bad-envelope":
                self._send(415, D.error_envelope("bad-envelope",
                                                 "json or urlencoded only"),
                           content_side=True)
                return
            raise
        grant = fields.get("grant")
        if not grant:
            self._fail("grant-invalid", "missing grant", status=403,
                       content_side=True)
            return
        try:
            value, expiry = state.store.redeem_handoff(
                aid, grant,
                lambda u, t, d: _credential_live(state, u, t, d))
        except KeyError as exc:
            code = str(exc.args[0]) if exc.args else "grant-invalid"
            if code not in ("grant-invalid", "grant-expired"):
                code = "grant-invalid"
            self._fail(code, code, status=403, content_side=True)
            return
        except StorageError as exc:
            if exc.code == "expired":
                self._expired_fail(False, content_side=True)
            else:
                self._fail(exc.code, exc.message, content_side=True)
            return
        cookie = self._grant_cookie(value, int(expiry - state.now()))
        if kind == "form":
            self._send(303, b"", ctype="text/plain", content_side=True,
                       headers={"Location": "/"}, cookie=cookie)
        else:
            self._send(200, json.dumps({"ok": True}).encode(),
                       content_side=True, cookie=cookie)

    def _content_unlock(self, aid: str) -> None:
        state: _State = self.server._mstate
        self._log_info = ("unlock", "-", 0)
        item = state.store.get_artifact(aid)
        if item is None or item["visibility"] != "external" \
                or item["state"] != "ready":
            self._fail("not-found", "no password entry", content_side=True)
            return
        if state.store.is_expired(item, state.now()):
            self._expired_fail(False, content_side=True)
            return
        if self._origin() != self._own_origin(aid):
            raise DomainError("forbidden", "origin check failed")
        try:
            kind, fields, _raw = self._read_form()
        except DomainError as exc:
            if exc.code == "bad-envelope":
                self._send(415, D.error_envelope("bad-envelope",
                                                 "json or urlencoded only"),
                           content_side=True)
                return
            raise
        password = fields.get("password", "")
        peer = self.client_address[0]
        if not state.throttle.allow("unlock:%s:%s" % (aid, peer),
                                    state.config.unlock_rate_per_min,
                                    state.now()):
            if kind == "form":
                self._send(429, self._unlock_form(
                    "too many attempts, retry later").encode(),
                    ctype="text/html; charset=utf-8", content_side=True,
                    headers={"Referrer-Policy": "strict-origin"},
                    retry_after="60")
            else:
                self._fail("rate-limited", "too many attempts",
                           content_side=True, retry_after="60")
            return
        issued = state.store.unlock_with_password(aid, password)
        if issued is None:
            if kind == "form":
                self._send(401, self._unlock_form(
                    "wrong password").encode(),
                    ctype="text/html; charset=utf-8", content_side=True,
                    headers={"Referrer-Policy": "strict-origin"})
            else:
                self._fail("password-invalid", "wrong password",
                           content_side=True)
            return
        value, expiry = issued
        cookie = self._grant_cookie(value, int(expiry - state.now()))
        if kind == "form":
            self._send(303, b"", ctype="text/plain", content_side=True,
                       headers={"Location": "/"}, cookie=cookie)
        else:
            self._send(200, json.dumps({"ok": True}).encode(),
                       content_side=True, cookie=cookie)

    def _content_logout(self, aid: str) -> None:
        self._log_info = ("content-logout", "-", 0)
        if self._origin() != self._own_origin(aid):
            raise DomainError("forbidden", "origin check failed")
        try:
            kind, _fields, _raw = self._read_form()
        except DomainError as exc:
            if exc.code == "bad-envelope":
                self._send(415, D.error_envelope("bad-envelope",
                                                 "json or urlencoded only"),
                           content_side=True)
                return
            raise
        # R3: revoke the presented grant server-side; replay stays dead.
        state: _State = self.server._mstate
        cookies = authmod.parse_cookies(self.headers.get("Cookie"))
        presented = cookies.get(D.grant_cookie_name(state.config.loopback_dev))
        if presented:
            state.store.delete_content_grant(presented)
        clear = self._grant_cookie("", 0, clear=True)
        if kind == "form":
            self._send(303, b"", ctype="text/plain", content_side=True,
                       headers={"Location": "/"}, cookie=clear)
        else:
            self._send(200, json.dumps({"ok": True}).encode(),
                       content_side=True, cookie=clear)

    def _content_manifest(self, aid: str) -> None:
        state: _State = self.server._mstate
        item = state.store.get_artifact(aid)
        if item is None:
            self._log_info = ("content-manifest", "-", 0)
            self._fail("not-found", "no such artifact", content_side=True)
            return
        if state.store.is_expired(item, state.now()):
            self._log_info = ("content-manifest", "-", 0)
            self._expired_fail(False, content_side=True)
            return
        if not self._content_auth_ok(item):
            self._log_info = ("content-manifest", "-", 0)
            self._fail("grant-required", "grant cookie required",
                       content_side=True)
            return
        self._log_info = ("content-manifest", "grant", 0)
        files = []
        for entry in item["manifest"]:
            if entry["kind"] == "dir":
                files.append({"path": entry["path"], "kind": "dir"})
            else:
                files.append({"path": entry["path"], "kind": "file",
                              "size": entry["size"],
                              "sha256": entry["sha256"]})
        self._send(200, json.dumps({"artifact_id": aid, "state": item["state"],
                                    "files": files}).encode(),
                   content_side=True)

    def _content_file(self, aid: str, enc: str) -> None:
        state: _State = self.server._mstate
        try:
            decoded, trailing = _decode_content_path("/" + enc)
        except DomainError as exc:
            self._log_info = ("content", "-", 0)
            raise exc
        _ = trailing
        if decoded and decoded.split("/")[0] in D.RESERVED_TOP_SEGMENTS:
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "reserved", content_side=True)
            return
        item = state.store.get_artifact(aid)
        if item is None:
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "no such artifact", content_side=True)
            return
        if state.store.is_expired(item, state.now()):
            self._log_info = ("content", "-", 0)
            self._expired_fail(False, content_side=True)
            return
        if item["state"] != "ready":
            self._log_info = ("content", "-", 0)
            self._fail("not-found", "not ready", content_side=True)
            return
        if not self._content_auth_ok(item):
            self._log_info = ("content", "-", 0)
            self._fail("grant-required", "grant cookie required",
                       content_side=True)
            return
        if not any(e["kind"] == "file" and e["path"] == decoded
                   for e in item["manifest"]):
            self._log_info = ("content", "grant", 0)
            raise DomainError("not-found", "no such file")
        self._log_info = ("content", "grant", 0)
        self._serve_live_file(item, decoded, attachment=False,
                              content_side=True)

    def _unlock_form(self, error: str) -> str:
        state: _State = self.server._mstate
        if state.unlock_shell_dir is not None:
            for name in ("index.html", "unlock.html"):
                try:
                    with open(os.path.join(state.unlock_shell_dir, name),
                              "rb") as fh:
                        return fh.read().decode("utf-8", "replace")
                except OSError:
                    continue
        err = "<p>%s</p>" % error if error else ""
        return ("<!doctype html><html><body><h1>password required</h1>%s"
                '<form method="post" action="/__manure/unlock">'
                '<input type="password" name="password" autocomplete="off">'
                '<button type="submit">unlock</button></form></body></html>'
                % err)

    def _content_password_page(self, aid: str) -> None:
        state: _State = self.server._mstate
        item = state.store.get_artifact(aid)
        if item is None or item["visibility"] != "external" \
                or item["state"] != "ready":
            self._log_info = ("password-page", "-", 0)
            self._fail("not-found", "no password entry", content_side=True)
            return
        if state.store.is_expired(item, state.now()):
            self._log_info = ("password-page", "-", 0)
            self._expired_fail(False, content_side=True)
            return
        self._log_info = ("password-page", "-", 0)
        self._send(200, self._unlock_form("").encode(),
                   ctype="text/html; charset=utf-8", content_side=True,
                   headers={"Referrer-Policy": "strict-origin"})


# ------------------------------------------------------------------ running

class RunningServer:
    """Live server handle: URLs, graceful shutdown, context-manager support."""

    def __init__(self, http: _HTTPServer, thread: threading.Thread,
                 stop: threading.Event, sweeper: threading.Thread,
                 store: ArtifactStore, state: _State,
                 effective_origin: str):
        self._http = http
        self._thread = thread
        self._stop = stop
        self._sweeper = sweeper
        self._store = store
        self._state = state
        self._effective_origin = effective_origin
        self._closed = False
        self._lock = threading.Lock()

    @property
    def bound_port(self) -> int:
        return self._http.server_address[1]

    @property
    def api_url(self) -> str:
        host = self._state.config.listen_address
        return "http://%s:%d" % (host, self.bound_port)

    @property
    def effective_api_origin(self) -> str:
        return self._effective_origin

    def content_url(self, artifact_id: str) -> str:
        return _content_origin(self._state, artifact_id)

    def sweep_for_test(self) -> int:
        """Run the expiry/orphan sweeper synchronously (tests only)."""
        return self._store.sweep()

    def active_count_for_test(self) -> int:
        """Current worker/connection count (tests only)."""
        return self._http.active_count()

    def close(self, grace_s: Optional[float] = None) -> None:
        # Governor R7 invariant: bounded graceful shutdown that FAILS CLOSED.
        # Admission stops, in-flight workers drain, lingering connections are
        # forced only after the grace deadline — but storage is closed and
        # ownership released ONLY with zero workers/sweeper remaining. If
        # draining cannot complete, raise clearly and RETAIN everything (the
        # caller retries later; main/systemd may terminate the process, at
        # which point the OS releases the socket claim). Never release
        # exclusive ownership while application work can still run.
        with self._lock:
            if self._closed:
                return
        if grace_s is None:
            grace_s = float(self._state.config.request_timeout_s) + 15.0
        self._stop.set()
        try:
            self._http.shutdown()
        except OSError:
            pass
        self._thread.join(timeout=grace_s + 5.0)
        if not self._http.wait_idle(grace_s):
            self._http.shutdown_lingering()
            self._http.wait_idle(5.0)
        sweep_deadline = time.monotonic() + 15.0
        while self._sweeper.is_alive() and time.monotonic() < sweep_deadline:
            self._sweeper.join(timeout=0.5)
        if self._sweeper.is_alive():
            raise StorageError("unavailable",
                               "shutdown incomplete: sweeper remains")
        if self._http.active_count() > 0:
            raise StorageError("unavailable",
                               "shutdown incomplete: workers remain")
        try:
            self._http.server_close()
        except OSError:
            pass
        # May raise StorageError(busy) itself — ownership retained then too.
        self._store.close()
        with self._lock:
            self._closed = True

    def __enter__(self) -> "RunningServer":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def _build_token_map(users: Any) -> dict[str, authmod.TokenIdentity]:
    token_map: dict[str, authmod.TokenIdentity] = {}
    for user in users:
        for token in user.tokens:
            digest = authmod.load_hash_file(token.hash_file)
            if digest in token_map:
                raise DomainError("bad-envelope", "duplicate token digest")
            token_map[digest] = authmod.TokenIdentity(
                user_id=user.id, user_type=user.type, token_id=token.id)
    return token_map


def create_server(config: ServerConfig,
                  _now: Optional[Callable[[], float]] = None) -> RunningServer:
    """Start the manure server; caller owns the handle (close it)."""
    if not isinstance(config, ServerConfig):
        raise DomainError("bad-envelope", "config must be ServerConfig")
    now = _now or time.time
    trusted: list[Any] = []
    for cidr in config.trusted_proxies:
        try:
            trusted.append(ipaddress.ip_network(cidr, strict=False))
        except ValueError as exc:
            raise DomainError("bad-envelope",
                              "bad trusted_proxies entry") from exc
    token_map = _build_token_map(config.users)
    dashboard_dir = _resolve_shell(config.dashboard_dir, "dashboard")
    unlock_shell_dir = _resolve_shell(config.unlock_shell_dir, "unlock")
    store = ArtifactStore(
        config.data_dir, now=now,
        storage_quota_bytes=config.storage_quota_bytes,
        chunk_bytes=config.chunk_bytes,
        max_file_bytes=config.max_file_bytes,
        max_artifact_bytes=config.max_artifact_bytes,
        max_files_per_artifact=config.max_files_per_artifact,
        max_sessions_per_user=config.max_sessions_per_user,
        max_sessions_global=config.max_sessions_global,
        max_grants_per_artifact=config.max_grants_per_artifact,
        incomplete_session_ttl_s=config.incomplete_session_ttl_s,
        grant_ttl_s=config.grant_ttl_s,
        one_time_grant_ttl_s=config.one_time_grant_ttl_s)
    try:
        store.reconcile()  # crash windows mapped before serving
        store.sweep()
    except Exception:
        store.close()
        raise
    sem = threading.Semaphore(config.max_connections)
    throttle = _Throttle(config.rate_map_max_entries)
    state = _State(config, store, token_map, dashboard_dir, unlock_shell_dir,
                   trusted, sem, throttle, now, itertools.count(1))
    try:
        http = _HTTPServer((config.listen_address, config.port), _Handler,
                           state)
    except Exception:
        store.close()
        raise
    effective = _compute_effective_origin(config, http.server_address[1])
    state.effective_origin = effective  # type: ignore[attr-defined]
    stop = threading.Event()

    def sweep_loop() -> None:
        while not stop.wait(config.sweep_interval_s):
            _run_sweep_once(store, stop)

    thread = threading.Thread(target=http.serve_forever,
                              kwargs={"poll_interval": 0.05},
                              name="manure-serve", daemon=True)
    sweeper = threading.Thread(target=sweep_loop, name="manure-sweep",
                               daemon=True)
    thread.start()
    sweeper.start()
    return RunningServer(http, thread, stop, sweeper, store, state, effective)


def _run_sweep_once(store: ArtifactStore,
                    stop: Optional[threading.Event] = None) -> None:
    """One sweeper iteration with allowlisted fault logging (R16: fixed
    category only, never raw exception data or tracebacks)."""
    try:
        store.sweep(stop)
    except Exception as exc:  # never kill the sweeper thread
        sys.stderr.write("manure sweeper-fault %s\n" % type(exc).__name__)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="manure-server")
    parser.add_argument("--config", default=None)
    args = parser.parse_args(argv)
    path = args.config or os.environ.get("MANURE_CONFIG")
    if not path:
        sys.stderr.write("manure-server: --config PATH or MANURE_CONFIG\n")
        return 2
    try:
        config = ServerConfig.from_json_file(path)
        server = create_server(config)
    except (DomainError, AuthError, OSError, ValueError) as exc:
        sys.stderr.write("manure-server: startup failed: %s\n" % (exc,))
        return 1
    sys.stderr.write("manure: serving %s (data %s)\n"
                     % (server.effective_api_origin, config.data_dir))
    import signal
    stop = threading.Event()

    def _halt(signum: int, frame: Any) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, _halt)
    signal.signal(signal.SIGINT, _halt)
    try:
        while not stop.wait(3600):
            pass
    finally:
        server.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
