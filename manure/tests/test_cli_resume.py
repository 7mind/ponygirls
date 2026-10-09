"""CLI behavioral tests: env precedence, cache/resume, JSON stability, TTL, access.

Covers F9 (ambiguous exit 2 no-network), F9c (resume/auto/--resume/--fresh,
source-changed, cache no-secrets, resumed-external null+note), required
--access, TTL syntax, token-file exact bytes via CLI, missing-credentials
before network, fetch password sources.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import unittest
import tempfile
import urllib.parse
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

from manure.auth import generate_token as _gen_token  # canonical vectors (governor A1)
VALID_TOKEN = _gen_token()
_VALID_PW = _gen_token()
ART_ID = "b" * 32


def _json(b):
    return json.dumps(b).encode()


class DummyTransport:
    def __init__(self, routes):
        self.routes = routes
        self.requests: list[dict] = []

    def request(self, method, url, headers, body):
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
        parsed = urllib.parse.urlparse(url)
        key = (method.upper(), parsed.path + (("?" + parsed.query) if parsed.query else ""))
        if key not in self.routes:
            alt = (method.upper(), parsed.path)
            if alt in self.routes:
                key = alt
            else:
                if method.upper() == "PUT" and parsed.path.endswith("/chunks"):
                    qs = urllib.parse.parse_qs(parsed.query)
                    off = int(qs.get("offset", ["0"])[0])
                    return (200, {"Content-Type": "application/json"},
                            _json({"path": qs.get("path", ["f"])[0], "offset": off,
                                   "length": len(body or b""), "received_bytes": off + len(body or b"")}))
                return (404, {"Content-Type": "application/json"},
                        _json({"error": {"code": "not-found", "message": "no route"}}))
        s, h, b = self.routes[key]
        return (s, dict(h), b)


def run_cli(argv, env, transport):
    """Run cli.main with patched env + injected dummy transport."""
    from manure import cli as cli_mod
    old_env = dict(os.environ)
    # clear manure env then set test env
    for k in list(os.environ):
        if k.startswith("MANURE_"):
            del os.environ[k]
    os.environ.update(env)
    # patch ManureClient to inject transport: wrap constructor
    from manure import client as client_mod
    OrigClient = client_mod.ManureClient

    def Patched(*a, **kw):
        kw.setdefault("transport", transport)
        return OrigClient(*a, **kw)

    out = io.StringIO()
    err = io.StringIO()
    try:
        with mock.patch.object(client_mod, "ManureClient", Patched):
            # cli imports ManureClient from manure.client at call time? ensure both patched
            with mock.patch("manure.client.ManureClient", Patched):
                with redirect_stdout(out), redirect_stderr(err):
                    code = cli_mod.main(argv)
    finally:
        os.environ.clear()
        os.environ.update(old_env)
    return code, out.getvalue(), err.getvalue()


class TestEnvPrecedence(unittest.TestCase):
    def test_ambiguous_token_exits_2_no_network(self):
        with tempfile.TemporaryDirectory() as td:
            tf = os.path.join(td, "tok")
            Path(tf).write_text(VALID_TOKEN + "\n")
            tr = DummyTransport({})
            code, out, err = run_cli(["whoami"], {
                "MANURE_URL": "http://127.0.0.1:8000",
                "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_TOKEN_FILE": tf,
            }, tr)
            self.assertEqual(code, 2)
            self.assertIn("ambiguous-credentials", err)
            self.assertEqual(tr.requests, [])

    def test_ambiguous_url_exits_2(self):
        with tempfile.TemporaryDirectory() as td:
            uf = os.path.join(td, "url")
            Path(uf).write_text("http://127.0.0.1:8000\n")
            tr = DummyTransport({})
            code, out, err = run_cli(["whoami"], {
                "MANURE_URL": "http://127.0.0.1:8000",
                "MANURE_URL_FILE": uf,
                "MANURE_TOKEN": VALID_TOKEN,
            }, tr)
            self.assertEqual(code, 2)
            self.assertEqual(tr.requests, [])

    def test_ambiguous_password_exits_2(self):
        with tempfile.TemporaryDirectory() as td:
            pf = os.path.join(td, "pw")
            Path(pf).write_text(_VALID_PW)
            tr = DummyTransport({})
            code, out, err = run_cli(["fetch", ART_ID, os.path.join(td, "out")], {
                "MANURE_URL": "http://127.0.0.1:8000",
                "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_EXTERNAL_PASSWORD": _VALID_PW,
                "MANURE_EXTERNAL_PASSWORD_FILE": pf,
            }, tr)
            self.assertEqual(code, 2)
            self.assertIn("ambiguous-credentials", err)
            self.assertEqual(tr.requests, [])

    def test_missing_credentials_before_network(self):
        tr = DummyTransport({})
        code, out, err = run_cli(["whoami"], {}, tr)
        self.assertEqual(code, 2)
        self.assertIn("missing-credentials", err.lower())
        self.assertEqual(tr.requests, [])

    def test_token_file_exact_bytes_via_cli(self):
        with tempfile.TemporaryDirectory() as td:
            bad = os.path.join(td, "badtok")
            Path(bad).write_bytes((VALID_TOKEN + " \n").encode())
            tr = DummyTransport({})
            code, out, err = run_cli(["whoami"], {
                "MANURE_URL": "http://127.0.0.1:8000",
                "MANURE_TOKEN_FILE": bad,
            }, tr)
            self.assertEqual(code, 2)
            self.assertEqual(tr.requests, [])

    def test_empty_env_treated_as_unset(self):
        tr = DummyTransport({})
        code, out, err = run_cli(["whoami"], {
            "MANURE_URL": "",
            "MANURE_TOKEN": "   \n",
        }, tr)
        self.assertEqual(code, 2)
        self.assertEqual(tr.requests, [])


class TestUploadCacheResume(unittest.TestCase):
    def _upload_routes(self, artifact_id, chunk_bytes, content_url, external_pw=None, fname="f.txt", size=11):
        routes: dict = {
            ("POST", "/api/v1/artifacts:init"): (200, {"Content-Type": "application/json"},
                _json({"artifact_id": artifact_id, "chunk_bytes": chunk_bytes, "content_url": content_url}
                      | ({"external_password": external_pw} if external_pw else {}))),
            ("GET", f"/api/v1/artifacts/{artifact_id}/upload-status"): (200, {"Content-Type": "application/json"},
                _json({"artifact_id": artifact_id, "state": "uploading", "chunk_bytes": chunk_bytes,
                       "files": [{"path": fname, "size": size, "received_bytes": 0, "received_ranges": []}]})),
            ("GET", f"/api/v1/artifacts/{artifact_id}"): (200, {"Content-Type": "application/json"},
                _json({"artifact_id": artifact_id, "name": "n", "kind": "file", "visibility": "external" if external_pw else "internal",
                       "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                       "expires_at": None, "total_bytes": size, "file_count": 1, "content_url": content_url})),
            ("POST", f"/api/v1/artifacts/{artifact_id}/publish"): (200, {"Content-Type": "application/json"},
                _json({"artifact_id": artifact_id, "state": "ready", "content_url": content_url})),
        }
        return routes

    def test_upload_requires_access(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_text("hello world")
            tr = DummyTransport({})
            code, out, err = run_cli(["upload", src], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 2)
            self.assertEqual(tr.requests, [])

    def test_upload_invalid_ttl_before_network(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_text("hello world")
            tr = DummyTransport({})
            code, out, err = run_cli(["upload", src, "--access", "internal", "--expires-in", "bogus"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 2)
            self.assertEqual(tr.requests, [])

    def test_upload_json_stable_and_cache_no_secrets(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            cache = os.path.join(td, "cache")
            routes = self._upload_routes(ART_ID, 262144, "http://127.0.0.1:8000/c/" + ART_ID)
            tr = DummyTransport(routes)
            code, out, err = run_cli(["upload", src, "--access", "internal", "--json"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": cache,
            }, tr)
            self.assertEqual(code, 0, msg=err)
            obj = json.loads(out)
            for k in ("artifact_id", "content_url", "access", "expires_at"):
                self.assertIn(k, obj)
            self.assertEqual(obj["artifact_id"], ART_ID)
            # B5: completed records are retired so stale successes never obstruct
            # auto-resume; assert no cache file retains secrets.
            cache_files = list(Path(cache).rglob("*.json"))
            for cf in cache_files:
                text = cf.read_text()
                self.assertNotIn(VALID_TOKEN, text)
                self.assertNotIn("external_password", text.lower())

    def test_external_generating_call_returns_password_once(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            pw = "E" * 43
            routes = self._upload_routes(ART_ID, 262144, "http://x/" + ART_ID, external_pw=pw)
            tr = DummyTransport(routes)
            code, out, err = run_cli(["upload", src, "--access", "external", "--json"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 0, msg=err)
            obj = json.loads(out)
            self.assertEqual(obj.get("external_password"), pw)

    def test_resumed_external_prints_null_note(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            from manure.client import build_manifest, _manifest_sha256
            kind, entries = build_manifest(src)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(json.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "external"}))
            # resume: init NOT called; status shows progress; publish ok; no password generated
            routes: dict = {
                ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                           "files": [{"path": "f.txt", "size": 11, "received_bytes": 0, "received_ranges": []}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "state": "uploading",
                           "files": [{"path": "f.txt", "kind": "file", "size": 11, "sha256": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "name": "n", "kind": "file", "visibility": "external",
                           "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                           "expires_at": None, "total_bytes": 11, "file_count": 1, "content_url": "http://x"})),
                ("POST", f"/api/v1/artifacts/{ART_ID}/publish"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"})),
            }
            tr = DummyTransport(routes)
            code, out, err = run_cli(["upload", src, "--access", "external", "--resume", ART_ID, "--json"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 0, msg=err)
            obj = json.loads(out)
            self.assertIsNone(obj.get("external_password"))
            self.assertIn("rotate-password", json.dumps(obj))

    def test_source_changed_exit_2(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"version-one!!")
            from manure.client import build_manifest, _manifest_sha256
            kind, entries = build_manifest(src)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(json.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "internal"}))
            # change source
            Path(src).write_bytes(b"version-two!!")
            tr = DummyTransport({})
            code, out, err = run_cli(["upload", src, "--access", "internal", "--resume", ART_ID, "--json"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 2)
            self.assertIn("source-changed", err)
            self.assertEqual(tr.requests, [])

    def test_auto_resume_single_match(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            from manure.client import build_manifest, _manifest_sha256
            kind, entries = build_manifest(src)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(json.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "internal"}))
            routes: dict = {
                ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                           "files": [{"path": "f.txt", "size": 11, "received_bytes": 0, "received_ranges": []}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "state": "uploading",
                           "files": [{"path": "f.txt", "kind": "file", "size": 11, "sha256": "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9"}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "name": "n", "kind": "file", "visibility": "internal",
                           "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                           "expires_at": None, "total_bytes": 11, "file_count": 1, "content_url": "http://x"})),
                ("POST", f"/api/v1/artifacts/{ART_ID}/publish"): (200, {"Content-Type": "application/json"},
                    _json({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"})),
            }
            tr = DummyTransport(routes)
            code, out, err = run_cli(["upload", src, "--access", "internal", "--json"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 0, msg=err)
            # auto-resume must NOT call init
            self.assertFalse(any(r["url"].endswith(":init") for r in tr.requests))

    def test_fresh_ignores_cache(self):
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            from manure.client import build_manifest, _manifest_sha256
            kind, entries = build_manifest(src)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(json.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "internal"}))
            NEW = "c" * 32
            routes = self._upload_routes(NEW, 262144, "http://x/" + NEW)
            tr = DummyTransport(routes)
            code, out, err = run_cli(["upload", src, "--access", "internal", "--fresh", "--json"], {
                "MANURE_URL": "http://127.0.0.1:8000", "MANURE_TOKEN": VALID_TOKEN,
                "MANURE_CACHE_DIR": os.path.join(td, "cache"),
            }, tr)
            self.assertEqual(code, 0, msg=err)
            obj = json.loads(out)
            self.assertEqual(obj["artifact_id"], NEW)


if __name__ == "__main__":
    unittest.main()
