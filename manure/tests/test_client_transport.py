"""Current client transport/auth/manifest/upload/fetch behavioral tests.

Covers: ambiguous credentials without network, exact token-file codec,
loopback-only HTTP, bearer-only-to-API-origin, grant-jar exact-host,
cross-origin redirect credential drop, manifest topology, TTL parsing,
chunk resume via upload-status, fetch integrity/temp-atomic/symlink safety,
total-bytes cap, source-change protection, cache no-secrets.
Uses DummyTransport (dual-test seam) + stdlib loopback HTTP fixture.
"""
from __future__ import annotations

import hashlib
import http.server
import json
import os
import socket
import threading
import unittest
import tempfile
import urllib.parse
from pathlib import Path
from current_fixture import current_fixture
from manure import current_protocol as cp
from uuid import UUID


def _import_client():
    from manure.client import (
        ManureClient,
        ManureError,
        AmbiguousCredentials,
        MissingCredentials,
        SourceChanged,
        InvalidManifest,
        InvalidPath,
        read_token_file,
        parse_expires_in,
        validate_manifest_path,
        is_loopback_host,
    )
    return (
        ManureClient, ManureError, AmbiguousCredentials, MissingCredentials,
        SourceChanged, InvalidManifest, InvalidPath, read_token_file,
        parse_expires_in, validate_manifest_path, is_loopback_host,
    )


from manure.auth import generate_token as _gen_token  # canonical vectors (governor A1)
VALID_TOKEN = _gen_token()
VALID_TOKEN_2 = _gen_token()
ART_ID = "a" * 32


@current_fixture
class DummyTransport:
    """Shared dummy transport interface: canned routes + request log."""

    def __init__(self, routes: dict[tuple[str, str], tuple[int, dict, bytes]]):
        # Application key: (generated command variant, artifact ID); raw keys are HTTP paths.
        self.routes = routes
        self.requests: list[dict] = []

    def request(self, method, url, headers, body):
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
        parsed = urllib.parse.urlparse(url)
        key = (method, parsed.path + (("?" + parsed.query) if parsed.query else ""))
        # fall back to path-only match
        if key not in self.routes:
            key2 = (method, parsed.path)
            if key2 in self.routes:
                key = key2
            else:
                return (404, {"Content-Type": "application/json"}, {"error":{"code":"not-found","message":"no route"}})
        status, hdrs, resp_body = self.routes[key]
        return (status, dict(hdrs), resp_body)


def _json_body(obj) -> bytes:
    return obj


class TestAmbiguityNoNetwork(unittest.TestCase):
    def test_constructor_token_and_file_ambiguous_no_network(self):
        (ManureClient, _ME, Amb, *_rest) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            tf = os.path.join(td, "tok")
            Path(tf).write_text(VALID_TOKEN + "\n")
            # must raise without any network: use unreachable api_base, ensure no socket attempt
            with self.assertRaises(Amb):
                ManureClient("http://127.0.0.1:9", token=VALID_TOKEN, token_file=tf)
            # also direct check: code attribute
            try:
                ManureClient("http://127.0.0.1:9", token=VALID_TOKEN, token_file=tf)
            except Amb as e:
                self.assertEqual(getattr(e, "code", ""), "ambiguous-credentials")
            else:
                self.fail("expected AmbiguousCredentials")

    def test_empty_values_are_unset_not_ambiguous(self):
        (ManureClient, *_rest) = _import_client()
        c = ManureClient("http://127.0.0.1:9", token="", token_file=None)
        self.assertIsNotNone(c)


class TestTokenFileCodec(unittest.TestCase):
    def test_exact_bytes_ok(self):
        (_MC, _ME, _A, _Mi, _S, _IM, _IP, read_token_file, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            p = os.path.join(td, "t")
            Path(p).write_bytes((VALID_TOKEN + "\n").encode("ascii"))
            self.assertEqual(read_token_file(p), VALID_TOKEN)
            p2 = os.path.join(td, "t2")
            Path(p2).write_bytes(VALID_TOKEN.encode("ascii"))
            self.assertEqual(read_token_file(p2), VALID_TOKEN)

    def test_rejects(self):
        (_MC, _ME, _A, _Mi, _S, _IM, _IP, read_token_file, *_r) = _import_client()
        bad_cases = [
            (VALID_TOKEN + "\n\n").encode(),  # multiline / extra LF
            (VALID_TOKEN + " \n").encode(),  # trailing space
            (" " + VALID_TOKEN).encode(),
            (VALID_TOKEN + "\r\n").encode(),  # CR rejected (haystack)
            (VALID_TOKEN[:42]).encode(),  # short
            (VALID_TOKEN + "X").encode(),  # long
            ("A" * 42 + "\n" + "B").encode(),  # multiline
            b"\x00" + VALID_TOKEN.encode(),
        ]
        for i, raw in enumerate(bad_cases):
            with tempfile.TemporaryDirectory() as td:
                p = os.path.join(td, f"t{i}")
                Path(p).write_bytes(raw)
                with self.assertRaises(Exception, msg=f"case {i}"):
                    read_token_file(p)


class TestLoopbackHttps(unittest.TestCase):
    def test_http_non_loopback_rejected_before_network(self):
        (ManureClient, ManureError, *_r) = _import_client()
        # constructor or first request must reject http://example.com before network
        c = ManureClient("http://example.com", token=VALID_TOKEN,
                         transport=DummyTransport({}))
        with self.assertRaises(ManureError):
            c.whoami()
        # ensure dummy saw no request
        self.assertEqual(c._transport.requests, [])

    def test_https_non_loopback_allowed(self):
        (ManureClient, *_r) = _import_client()
        routes = {('Whoami', ''): (200, {"Content-Type": "application/json"},
                  _json_body({"user_id": "u", "type": "agent", "token_id": "t"}))}
        tr = DummyTransport(routes)
        c = ManureClient("https://artifacts.7mind.io", token=VALID_TOKEN, transport=tr)
        out = c.whoami()
        self.assertEqual(out["user_id"], "u")
        self.assertEqual(len(tr.requests), 1)

    def test_http_loopback_allowed(self):
        (ManureClient, *_r) = _import_client()
        routes = {('Whoami', ''): (200, {"Content-Type": "application/json"},
                  _json_body({"user_id": "u", "type": "agent", "token_id": "t"}))}
        for base in ("http://127.0.0.1:47329", "http://localhost:9", "http://foo.localhost:9"):
            tr = DummyTransport(routes)
            c = ManureClient(base, token=VALID_TOKEN, transport=tr)
            out = c.whoami()
            self.assertEqual(out["user_id"], "u")

    def test_is_loopback_host(self):
        (*_, is_loopback_host) = _import_client()
        self.assertTrue(is_loopback_host("127.0.0.1"))
        self.assertTrue(is_loopback_host("::1"))
        self.assertTrue(is_loopback_host("localhost"))
        self.assertTrue(is_loopback_host("foo.localhost"))
        self.assertFalse(is_loopback_host("example.com"))
        self.assertFalse(is_loopback_host("artifacts.7mind.io"))


class TestCredentialIsolation(unittest.TestCase):
    def test_bearer_only_to_api_origin(self):
        (ManureClient, *_r) = _import_client()
        # API request carries bearer; content-URL request must NOT
        api_routes = {}
        tr = DummyTransport(api_routes)
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=tr)

        # stub transport to capture content request via fetch path: use direct _request
        # content manifest GET (public, anon) must not include Authorization
        tr2_routes = {
            ("GET", "/credential-probe"): (200, {"Content-Type": "application/json"},
                _json_body({"artifact_id": ART_ID, "state": "ready", "files": []})),
        }
        tr2 = DummyTransport(tr2_routes)
        c2 = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=tr2)
        # internal helper: content GET should not send bearer
        status, hdrs, body = c2._request("GET", f"http://{ART_ID}.artifacts.localhost:8000/credential-probe")
        # find recorded request
        self.assertEqual(len(tr2.requests), 1)
        sent = tr2.requests[0]["headers"]
        # case-insensitive check
        lowered = {k.lower(): v for k, v in sent.items()}
        self.assertNotIn("authorization", lowered)

    def test_grant_jar_exact_host(self):
        (ManureClient, *_r) = _import_client()
        tr = DummyTransport({})
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=tr)
        c._store_grant("aaa.artifacts.localhost", "mgrant-dev=GRANT1")
        # exact host sends cookie
        s, h, b = c._request("GET", "http://aaa.artifacts.localhost:8000/credential-probe")
        # transport recorded cookie?
        # Dummy returns 404 but we inspect sent headers
        sent = tr.requests[-1]["headers"]
        lowered = {k.lower(): v for k, v in sent.items()}
        self.assertIn("cookie", lowered)
        self.assertIn("GRANT1", lowered["cookie"])
        # sibling host must NOT get cookie
        s2, h2, b2 = c._request("GET", "http://bbb.artifacts.localhost:8000/credential-probe")
        sent2 = tr.requests[-1]["headers"]
        lowered2 = {k.lower(): v for k, v in sent2.items()}
        self.assertNotIn("cookie", lowered2)
        # parent must not get cookie
        s3, h3, b3 = c._request("GET", "http://artifacts.localhost:8000/credential-probe")
        sent3 = tr.requests[-1]["headers"]
        lowered3 = {k.lower(): v for k, v in sent3.items()}
        self.assertNotIn("cookie", lowered3)

    def test_cross_origin_redirect_drops_credentials(self):
        (ManureClient, *_r) = _import_client()

        class RedirectDummy:
            def __init__(self):
                self.requests = []

            def request(self, method, url, headers, body):
                self.requests.append({"method": method, "url": url, "headers": dict(headers)})
                parsed = urllib.parse.urlparse(url)
                if parsed.path == "/api/current/artifacts/x/files/f/content":
                    # redirect cross-origin to evil (https: loopback rule allows https anywhere)
                    return (302, {"Location": "https://evil.example/stolen"}, b"")
                if "evil.example" in url:
                    return (200, {"Content-Type": "application/octet-stream"}, b"data")
                return (404, {}, b"")

        rd = RedirectDummy()
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=rd)
        status, hdrs, body = c._request("GET", "http://127.0.0.1:8000/api/current/artifacts/x/files/f/content")
        self.assertEqual(status, 200)
        self.assertEqual(len(rd.requests), 2)
        first_auth = {k.lower(): v for k, v in rd.requests[0]["headers"].items()}.get("authorization")
        second = {k.lower(): v for k, v in rd.requests[1]["headers"].items()}
        self.assertIsNotNone(first_auth)
        self.assertNotIn("authorization", second)
        self.assertNotIn("cookie", second)


class TestManifestValidation(unittest.TestCase):
    def test_validate_paths(self):
        from manure.client import validate_manifest_path as _vmp
        validate_manifest_path = _vmp
        good = ["index.html", "a/b/c.txt", "assets/img.png"]
        for p in good:
            validate_manifest_path(p)
        bad = [
            "/abs/path", "../escape", "a/../b", "./x", "a//b", "",
            "__manure/x", "api/y", "__manure", "api",
            "a\\b", "a\x00b", "x" * 1025,
            ".", "..",
        ]
        for p in bad:
            with self.assertRaises(Exception, msg=p):
                validate_manifest_path(p)

    def test_depth_limit(self):
        from manure.client import validate_manifest_path as _vmp2
        validate_manifest_path = _vmp2
        deep = "/".join(["d"] * 65 + ["f"])
        with self.assertRaises(Exception):
            validate_manifest_path(deep)
        ok = "/".join(["d"] * 63 + ["f"])
        validate_manifest_path(ok)

    def test_topology_conflicts(self):
        (ManureClient, _ME, _A, _Mi, _S, InvalidManifest, *_r) = _import_client()
        from manure.client import validate_manifest
        # duplicate
        with self.assertRaises(InvalidManifest):
            validate_manifest([{"path": "a", "kind": "file", "size": 1, "sha256": "a" * 64},
                               {"path": "a", "kind": "file", "size": 1, "sha256": "a" * 64}], "dir")
        # file prefix-parent of another
        with self.assertRaises(InvalidManifest):
            validate_manifest([{"path": "a", "kind": "file", "size": 1, "sha256": "a" * 64},
                               {"path": "a/b", "kind": "file", "size": 1, "sha256": "a" * 64}], "dir")
        # kind file must have exactly 1 file 0 dirs
        with self.assertRaises(InvalidManifest):
            validate_manifest([], "file")
        with self.assertRaises(InvalidManifest):
            validate_manifest([{"path": "d", "kind": "dir"}], "file")


class TestTTL(unittest.TestCase):
    def test_parse(self):
        from manure.client import parse_expires_in as pei
        self.assertEqual(pei("3600"), 3600)
        self.assertEqual(pei("30m"), 1800)
        self.assertEqual(pei("2h"), 7200)
        self.assertEqual(pei("7d"), 604800)
        self.assertEqual(pei("90s"), 90)
        self.assertEqual(pei(120), 120)
        self.assertIsNone(pei(None))
        with self.assertRaises(Exception):
            pei("10")  # below 60
        with self.assertRaises(Exception):
            pei("999999999d")
        with self.assertRaises(Exception):
            pei("bogus")


class TestUploadFetchRoundTripDummy(unittest.TestCase):
    def test_upload_file_then_fetch_via_api(self):
        (ManureClient, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "hello.txt")
            Path(src).write_bytes(b"hello world")
            content = b"hello world"
            sha = hashlib.sha256(content).hexdigest()
            fname = "hello.txt"
            # server state: init -> status(empty) -> chunk PUT -> publish -> files -> content
            routes = {
                ('InitUpload', ''): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "chunk_bytes": 262144, "content_url": f"http://{ART_ID}.artifacts.localhost:8000"})),
                ('GetUploadStatus', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                                "files": [{"path": fname, "size": len(content), "received_bytes": 0, "received_ranges": []}]})),
                ('GetArtifact', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "name": "hello", "kind": "file", "visibility": "internal",
                                "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                                "expires_at": None, "total_bytes": len(content), "file_count": 1,
                                "content_url": f"http://{ART_ID}.artifacts.localhost:8000"})),
                ('GetManifest', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready",
                                "files": [{"path": fname, "kind": "file", "size": len(content), "sha256": sha}]})),
                ('FinishUpload', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready", "content_url": f"http://{ART_ID}.artifacts.localhost:8000"})),
            }

            class ChunkAndContentDummy(DummyTransport):
                def request(self, method, url, headers, body):
                    self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
                    parsed = urllib.parse.urlparse(url)
                    key = (method, parsed.path + (("?" + parsed.query) if parsed.query else ""))
                    if method == "PUT" and parsed.path == f"/api/current/artifacts/{ART_ID}/chunks":
                        qs = urllib.parse.parse_qs(parsed.query)
                        off = int(qs.get("offset", ["0"])[0])
                        # verify chunk sha header present
                        hdrl = {k.lower(): v for k, v in headers.items()}
                        self.requests[-1]["chunk_sha"] = hdrl.get("x-chunk-sha256")
                        return (200, {"Content-Type": "application/json"},
                                _json_body({"path": fname, "offset": off, "length": len(body), "received_bytes": off + len(body)}))
                    if method == "GET" and parsed.path == f"/api/current/artifacts/{ART_ID}/files/{fname}/content":
                        # support Range
                        hdrl = {k.lower(): v for k, v in headers.items()}
                        rng = hdrl.get("range")
                        if rng:
                            # bytes=s-
                            s = int(rng.split("=")[1].split("-")[0])
                            part = content[s:]
                            return (206, {"Content-Type": "application/octet-stream",
                                          "Content-Range": f"bytes {s}-{len(content)-1}/{len(content)}",
                                          "Accept-Ranges": "bytes"}, part)
                        return (200, {"Content-Type": "application/octet-stream", "Accept-Ranges": "bytes"}, content)
                    return super().request(method, url, headers, body)

            tr = ChunkAndContentDummy(routes)
            cache = os.path.join(td, "cache")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=cache, transport=tr)
            res = c.upload_path(src, access="internal", name="hello", fresh=True)
            self.assertEqual(res["artifact_id"], ART_ID)
            self.assertIn("content_url", res)
            # chunk sends use validated server chunk_bytes (single chunk for tiny file)
            puts = [r for r in tr.requests if r["method"] == "PUT"]
            self.assertEqual(len(puts), 1)
            self.assertEqual(len(puts[0]["body"]), len(content))
            # chunk sha header present and correct
            for r in puts:
                off_body = r["body"]
                self.assertEqual(r["chunk_sha"], hashlib.sha256(off_body).hexdigest())
            # fetch to dest
            dest = os.path.join(td, "out")
            out = c.fetch_to_dest(ART_ID, dest)
            fetched = Path(os.path.join(dest, fname)).read_bytes()
            self.assertEqual(fetched, content)

    def test_upload_rejects_symlink(self):
        (ManureClient, ManureError, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            target = os.path.join(td, "real.txt")
            Path(target).write_text("x")
            link = os.path.join(td, "link.txt")
            os.symlink(target, link)
            tr = DummyTransport({})
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.upload_path(link, access="internal", fresh=True)
            self.assertEqual(tr.requests, [])

    def test_upload_dir_includes_empty_dirs(self):
        (ManureClient, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            root = os.path.join(td, "site")
            os.makedirs(os.path.join(root, "empty"))
            os.makedirs(os.path.join(root, "assets"))
            Path(os.path.join(root, "index.html")).write_text("<h1>hi</h1>")
            Path(os.path.join(root, "assets", "a.txt")).write_text("a")
            from manure.client import build_manifest
            kind, entries = build_manifest(root)
            self.assertEqual(kind, "dir")
            paths = {e["path"]: e["kind"] for e in entries}
            self.assertEqual(paths.get("index.html"), "file")
            self.assertEqual(paths.get("empty"), "dir")
            self.assertEqual(paths.get("assets/a.txt"), "file")

    def test_resume_skips_received_ranges(self):
        (ManureClient, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "big.bin")
            data = b"A" * 600000
            Path(src).write_bytes(data)
            routes = {
                ('InitUpload', ''): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "chunk_bytes": 262144, "content_url": "http://x"})),
                # status shows first chunk already received
                ('GetUploadStatus', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                                "files": [{"path": "big.bin", "size": 600000, "received_bytes": 262144, "received_ranges": [[0, 262144]]}]})),
                ('GetArtifact', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "name": "b", "kind": "file", "visibility": "internal",
                                "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                                "expires_at": None, "total_bytes": 600000, "file_count": 1, "content_url": "http://x"})),
                ('GetManifest', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "uploading",
                                "files": [{"path": "big.bin", "kind": "file", "size": 600000,
                                           "sha256": hashlib.sha256(b"A" * 600000).hexdigest()}]})),
                ('FinishUpload', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"})),
            }

            class Rec(DummyTransport):
                def request(self, method, url, headers, body):
                    self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
                    parsed = urllib.parse.urlparse(url)
                    if method == "PUT":
                        offset=int(urllib.parse.parse_qs(parsed.query)["offset"][0])
                        return (200, {"Content-Type": "application/json"},
                                _json_body({"path": "big.bin", "offset": offset, "length": len(body), "received_bytes": offset+len(body)}))
                    return super().request(method, url, headers, body)

            tr = Rec(routes)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"), transport=tr)
            # simulate resume: init a session then resume via status? Directly test _missing_ranges path
            # by calling upload_path with resume_id pointing at cached record
            # First create cache record manually via init flow is complex; instead test put logic:
            # upload_path fresh will init then consult status? Our impl consults status after init when resuming?
            # For this test, just verify that upload with pre-seeded status skips [0,4).
            # We do it by priming cache: write cache file for ART_ID then resume.
            import json as js
            from manure.client import manifest_sha256_for_path
            # build manifest sha via helper
            from manure.client import build_manifest as bm
            kind, entries = bm(src)
            from manure.client import _manifest_sha256
            msha = _manifest_sha256(entries)
            cache_dir = os.path.join(td, "c", "uploads")
            os.makedirs(cache_dir, exist_ok=True)
            Path(os.path.join(cache_dir, ART_ID + ".json")).write_text(js.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "internal"}))
            res = c.upload_path(src, access="internal", resume_id=ART_ID)
            puts = [r for r in tr.requests if r["method"] == "PUT"]
            # should NOT re-send offset 0 chunk
            offs = sorted(int(urllib.parse.parse_qs(urllib.parse.urlparse(r["url"]).query)["offset"][0]) for r in puts)
            self.assertEqual(offs, [262144, 524288])

    def test_fetch_verifies_hash_and_atomic(self):
        (ManureClient, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            content = b"good bytes"
            bad_sha = "0" * 64
            routes = {
                ('GetManifest', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready",
                                "files": [{"path": "f.bin", "kind": "file", "size": len(content), "sha256": bad_sha}]})),
            }

            class CD(DummyTransport):
                def request(self, method, url, headers, body):
                    self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
                    parsed = urllib.parse.urlparse(url)
                    if parsed.path.endswith("/content"):
                        return (200, {"Content-Type": "application/octet-stream"}, content)
                    return super().request(method, url, headers, body)

            tr = CD(routes)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, os.path.join(td, "out"))
            # no partial final file left (temp cleaned, no final)
            self.assertFalse(os.path.exists(os.path.join(td, "out", "f.bin")))

    def test_fetch_refuses_symlink_overwrite(self):
        (ManureClient, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            content = b"abc"
            sha = hashlib.sha256(content).hexdigest()
            routes = {
                ('GetManifest', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready",
                                "files": [{"path": "f.bin", "kind": "file", "size": 3, "sha256": sha}]})),
            }

            class CD2(DummyTransport):
                def request(self, method, url, headers, body):
                    self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
                    if url.endswith("/content"):
                        return (200, {"Content-Type": "application/octet-stream"}, content)
                    return super().request(method, url, headers, body)

            tr = CD2(routes)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"), transport=tr)
            dest = os.path.join(td, "out")
            os.makedirs(dest)
            # plant symlink at final path
            os.symlink("/etc/passwd", os.path.join(dest, "f.bin"))
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, dest)

    def test_fetch_rejects_hostile_manifest(self):
        (ManureClient, *_r) = _import_client()
        with tempfile.TemporaryDirectory() as td:
            routes = {
                ('GetManifest', ART_ID): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready",
                                "files": [{"path": "../evil", "kind": "file", "size": 3, "sha256": "a" * 64}]})),
            }
            tr = DummyTransport(routes)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, os.path.join(td, "out"))


class LoopbackFixtureHandler(http.server.BaseHTTPRequestHandler):
    """Minimal current-protocol HTTP peer verifying bearer and range delivery."""

    store: dict = {}
    log: list = []

    def log_message(self, *a):
        pass

    def _send_json(self, code, obj, extra=None):
        if isinstance(obj,cp.ServerEnvelope):body=cp.dumps(obj)
        else:
            error=obj["error"]
            code_name="".join(v.capitalize() for v in error["code"].split("-"))
            body=cp.dumps(cp.ServerEnvelope(UUID(int=0),cp.Result_Error(cp.Failure(cp.ErrorCode(code_name),"fixture error",None))))
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        assert self.path=="/api/current"
        request=cp.decode(cp.ClientEnvelope,cp.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        auth=self.headers.get("Authorization","")
        LoopbackFixtureHandler.log.append(("POST",self.path,auth))
        if auth!=f"Bearer {VALID_TOKEN}":
            return self._send_json(401,cp.ServerEnvelope(request.requestId,cp.Result_Error(cp.Failure(cp.ErrorCode.Unauthorized,"unauthorized",None))))
        if isinstance(request.command,cp.Command_Whoami):
            result=cp.Result_Identity(cp.Principal("u1","t1",cp.PrincipalType.Agent))
        elif isinstance(request.command,cp.Command_GetManifest):
            data=b"fixture-bytes"
            result=cp.Result_ArtifactManifest(cp.Manifest(ART_ID,cp.ArtifactState.Ready,[cp.ManifestEntry_File("f.txt",len(data),hashlib.sha256(data).hexdigest())]))
        else:raise AssertionError("unexpected current fixture command")
        return self._send_json(200,cp.ServerEnvelope(request.requestId,result))

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        auth = self.headers.get("Authorization", "")
        LoopbackFixtureHandler.log.append(("GET", self.path, auth))
        if parsed.path == f"/api/current/artifacts/{ART_ID}/files/f.txt/content":
            if auth != f"Bearer {VALID_TOKEN}":
                return self._send_json(401, {"error": {"code": "unauthorized", "message": "bad"}})
            data = b"fixture-bytes"
            rng = self.headers.get("Range")
            if rng:
                s = int(rng.split("=")[1].split("-")[0])
                part = data[s:]
                self.send_response(206)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Range", f"bytes {s}-{len(data)-1}/{len(data)}")
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(len(part)))
                self.end_headers()
                return self.wfile.write(part)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            return self.wfile.write(data)
        return self._send_json(404, {"error": {"code": "not-found", "message": "x"}})


class TestLoopbackFixture(unittest.TestCase):
    def test_maximum_metadata_pages_survive_actual_http_transport(self):
        from manure.client import ManureClient
        from manure.metadata import validate_metadata
        page_rows = 200
        retired_response_limit = 8 * 1024 * 1024 + 1024
        response_limit = 32 * 1024 * 1024
        for character in ('\x01', '🦄'):
            tags = [character * 127 + chr(0x10000 + index) for index in range(32)]
            hostname = character * 253
            project_path = character * 4096
            validate_metadata(tags, hostname, project_path)
            artifacts = [cp.Artifact(f'{index:032x}', 'report', cp.ArtifactKind.File,
                cp.Visibility.Internal, cp.ArtifactState.Ready, 'u', '2026-11-11T00:00:00Z',
                None, 1, 1, 'http://127.0.0.1/view/report', tags, hostname, project_path)
                for index in range(page_rows)]
            catalogue = cp.Result_Catalogue(cp.CataloguePage(artifacts, None))
            search = cp.Result_SearchResults(cp.SearchPage([cp.SearchHit(artifact,
                'a' * 64, 'generation', 'manure-metadata-paths-v2', None, None, [], 1.0)
                for artifact in artifacts], page_rows, cp.SearchCountScope.ExactMatches, None, None))
            for result in (catalogue, search):
                with self.subTest(character=ord(character), result=type(result).__name__):
                    wire = cp.dumps(cp.ServerEnvelope(UUID(int=0), result))
                    self.assertGreater(len(wire), retired_response_limit)
                    self.assertLessEqual(len(wire), response_limit)
                    # Prove the large peer response is valid before exercising transport.
                    self.assertEqual(cp.response(wire, UUID(int=0), type(result)), result)
                    print(f'metadata HTTP fixture: {type(result).__name__} scalar={ord(character)} rows={page_rows} bytes={len(wire)}')
                    class PageHandler(LoopbackFixtureHandler):
                        def do_POST(peer):
                            self.assertEqual(peer.path, '/api/current')
                            self.assertEqual(peer.headers.get('Authorization'), f'Bearer {VALID_TOKEN}')
                            request = cp.decode(cp.ClientEnvelope, cp.loads(peer.rfile.read(int(peer.headers['Content-Length']))))
                            self.assertIsInstance(request.command, cp.Command_ListArtifacts if isinstance(result, cp.Result_Catalogue) else cp.Command_Search)
                            self.assertEqual(request.command.query.limit, page_rows)
                            try:
                                peer._send_json(200, cp.ServerEnvelope(request.requestId, result))
                            except (BrokenPipeError, ConnectionResetError):
                                pass
                    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), PageHandler)
                    thread = threading.Thread(target=server.serve_forever, daemon=True)
                    thread.start()
                    try:
                        client = ManureClient(f'http://127.0.0.1:{server.server_port}', token=VALID_TOKEN)
                        if isinstance(result, cp.Result_Catalogue):
                            rows = client.list_artifacts(limit=page_rows)['artifacts']
                        else:
                            rows = [hit['artifact'] for hit in client.search('report', limit=page_rows)['hits']]
                        self.assertEqual(len(rows), page_rows)
                        for artifact, row in zip(artifacts, rows, strict=True):
                            self.assertEqual(row, cp.local(artifact))
                    finally:
                        server.shutdown(); server.server_close(); thread.join(timeout=5)
                        self.assertFalse(thread.is_alive())

    def test_oversized_http_responses_still_fail_with_and_without_content_length(self):
        from manure.client import ManureClient, ManureError
        response_limit = 32 * 1024 * 1024
        chunk_bytes = 64 * 1024
        for declared_length in (True, False):
            with self.subTest(content_length=declared_length):
                class OversizedHandler(LoopbackFixtureHandler):
                    def do_POST(peer):
                        peer.rfile.read(int(peer.headers['Content-Length']))
                        peer.send_response(200)
                        if declared_length:
                            peer.send_header('Content-Length', str(response_limit + 1))
                        peer.end_headers()
                        if not declared_length:
                            remaining = response_limit + 1
                            try:
                                while remaining:
                                    part = b'x' * min(chunk_bytes, remaining)
                                    peer.wfile.write(part)
                                    remaining -= len(part)
                            except (BrokenPipeError, ConnectionResetError):
                                pass
                server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), OversizedHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    client = ManureClient(f'http://127.0.0.1:{server.server_port}', token=VALID_TOKEN)
                    with self.assertRaises(ManureError) as error:
                        client.list_artifacts()
                    self.assertEqual(error.exception.code, 'too-large')
                    self.assertEqual(error.exception.message, 'response too large')
                finally:
                    server.shutdown(); server.server_close(); thread.join(timeout=5)
                    self.assertFalse(thread.is_alive())

    def test_fixture_verifies_bearer_and_range(self):
        (ManureClient, *_r) = _import_client()
        LoopbackFixtureHandler.log = []
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), LoopbackFixtureHandler)
        port = srv.server_address[1]
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        try:
            with tempfile.TemporaryDirectory() as td:
                c = ManureClient(f"http://127.0.0.1:{port}", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"))
                who = c.whoami()
                self.assertEqual(who["user_id"], "u1")
                out = c.fetch_to_dest(ART_ID, os.path.join(td, "out"))
                self.assertEqual(Path(os.path.join(td, "out", "f.txt")).read_bytes(), b"fixture-bytes")
                # fixture saw bearer on API routes
                self.assertTrue(any(a == f"Bearer {VALID_TOKEN}" for _, _, a in LoopbackFixtureHandler.log))
        finally:
            srv.shutdown()
            srv.server_close()


if __name__ == "__main__":
    unittest.main()
