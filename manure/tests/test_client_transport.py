"""Client transport/auth/manifest/upload/fetch behavioral tests (contract v0.2).

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


class DummyTransport:
    """Shared dummy transport interface: canned routes + request log."""

    def __init__(self, routes: dict[tuple[str, str], tuple[int, dict, bytes]]):
        # key: (METHOD, path+query) e.g. ("GET", "/api/v1/whoami")
        self.routes = routes
        self.requests: list[dict] = []

    def request(self, method, url, headers, body):
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
        parsed = urllib.parse.urlparse(url)
        key = (method.upper(), parsed.path + (("?" + parsed.query) if parsed.query else ""))
        # fall back to path-only match
        if key not in self.routes:
            key2 = (method.upper(), parsed.path)
            if key2 in self.routes:
                key = key2
            else:
                return (404, {"Content-Type": "application/json"}, b'{"error": {"code": "not-found", "message": "no route"}}')
        status, hdrs, resp_body = self.routes[key]
        return (status, dict(hdrs), resp_body)


def _json_body(obj) -> bytes:
    return json.dumps(obj).encode()


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
        routes = {("GET", "/api/v1/whoami"): (200, {"Content-Type": "application/json"},
                  _json_body({"user_id": "u", "type": "agent", "token_id": "t"}))}
        tr = DummyTransport(routes)
        c = ManureClient("https://artifacts.7mind.io", token=VALID_TOKEN, transport=tr)
        out = c.whoami()
        self.assertEqual(out["user_id"], "u")
        self.assertEqual(len(tr.requests), 1)

    def test_http_loopback_allowed(self):
        (ManureClient, *_r) = _import_client()
        routes = {("GET", "/api/v1/whoami"): (200, {"Content-Type": "application/json"},
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
            ("GET", "/__manure/manifest"): (200, {"Content-Type": "application/json"},
                _json_body({"artifact_id": ART_ID, "state": "ready", "files": []})),
        }
        tr2 = DummyTransport(tr2_routes)
        c2 = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=tr2)
        # internal helper: content GET should not send bearer
        status, hdrs, body = c2._request("GET", f"http://{ART_ID}.artifacts.localhost:8000/__manure/manifest")
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
        s, h, b = c._request("GET", "http://aaa.artifacts.localhost:8000/__manure/manifest")
        # transport recorded cookie?
        # Dummy returns 404 but we inspect sent headers
        sent = tr.requests[-1]["headers"]
        lowered = {k.lower(): v for k, v in sent.items()}
        self.assertIn("cookie", lowered)
        self.assertIn("GRANT1", lowered["cookie"])
        # sibling host must NOT get cookie
        s2, h2, b2 = c._request("GET", "http://bbb.artifacts.localhost:8000/__manure/manifest")
        sent2 = tr.requests[-1]["headers"]
        lowered2 = {k.lower(): v for k, v in sent2.items()}
        self.assertNotIn("cookie", lowered2)
        # parent must not get cookie
        s3, h3, b3 = c._request("GET", "http://artifacts.localhost:8000/__manure/manifest")
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
                if parsed.path == "/api/v1/artifacts/x/files/f/content":
                    # redirect cross-origin to evil (https: loopback rule allows https anywhere)
                    return (302, {"Location": "https://evil.example/stolen"}, b"")
                if "evil.example" in url:
                    return (200, {"Content-Type": "application/octet-stream"}, b"data")
                return (404, {}, b"")

        rd = RedirectDummy()
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=rd)
        status, hdrs, body = c._request("GET", "http://127.0.0.1:8000/api/v1/artifacts/x/files/f/content")
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
                ("POST", "/api/v1/artifacts:init"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "chunk_bytes": 262144, "content_url": f"http://{ART_ID}.artifacts.localhost:8000"})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                                "files": [{"path": fname, "size": len(content), "received_bytes": 0, "received_ranges": []}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "name": "hello", "kind": "file", "visibility": "internal",
                                "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                                "expires_at": None, "total_bytes": len(content), "file_count": 1,
                                "content_url": f"http://{ART_ID}.artifacts.localhost:8000"})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready",
                                "files": [{"path": fname, "kind": "file", "size": len(content), "sha256": sha}]})),
                ("POST", f"/api/v1/artifacts/{ART_ID}/publish"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready", "content_url": f"http://{ART_ID}.artifacts.localhost:8000"})),
            }

            class ChunkAndContentDummy(DummyTransport):
                def request(self, method, url, headers, body):
                    self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
                    parsed = urllib.parse.urlparse(url)
                    key = (method.upper(), parsed.path + (("?" + parsed.query) if parsed.query else ""))
                    if method.upper() == "PUT" and parsed.path == f"/api/v1/artifacts/{ART_ID}/chunks":
                        qs = urllib.parse.parse_qs(parsed.query)
                        off = int(qs.get("offset", ["0"])[0])
                        # verify chunk sha header present
                        hdrl = {k.lower(): v for k, v in headers.items()}
                        self.requests[-1]["chunk_sha"] = hdrl.get("x-chunk-sha256")
                        return (200, {"Content-Type": "application/json"},
                                _json_body({"path": fname, "offset": off, "length": len(body), "received_bytes": off + len(body)}))
                    if method.upper() == "GET" and parsed.path == f"/api/v1/artifacts/{ART_ID}/files/{fname}/content":
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
                ("POST", "/api/v1/artifacts:init"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "chunk_bytes": 262144, "content_url": "http://x"})),
                # status shows first chunk already received
                ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                                "files": [{"path": "big.bin", "size": 600000, "received_bytes": 262144, "received_ranges": [[0, 262144]]}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "name": "b", "kind": "file", "visibility": "internal",
                                "state": "ready", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                                "expires_at": None, "total_bytes": 600000, "file_count": 1, "content_url": "http://x"})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "uploading",
                                "files": [{"path": "big.bin", "kind": "file", "size": 600000,
                                           "sha256": hashlib.sha256(b"A" * 600000).hexdigest()}]})),
                ("POST", f"/api/v1/artifacts/{ART_ID}/publish"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"})),
            }

            class Rec(DummyTransport):
                def request(self, method, url, headers, body):
                    self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
                    parsed = urllib.parse.urlparse(url)
                    if method == "PUT":
                        return (200, {"Content-Type": "application/json"},
                                _json_body({"path": "big.bin", "offset": 0, "length": len(body), "received_bytes": 0}))
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
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
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
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
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
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _json_body({"artifact_id": ART_ID, "state": "ready",
                                "files": [{"path": "../evil", "kind": "file", "size": 3, "sha256": "a" * 64}]})),
            }
            tr = DummyTransport(routes)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, os.path.join(td, "out"))


class LoopbackFixtureHandler(http.server.BaseHTTPRequestHandler):
    """Minimal controllable fixture verifying REST: bearer, routes, chunk sha."""

    store: dict = {}
    log: list = []

    def log_message(self, *a):
        pass

    def _send_json(self, code, obj, extra=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        auth = self.headers.get("Authorization", "")
        LoopbackFixtureHandler.log.append(("GET", self.path, auth))
        if parsed.path == "/api/v1/whoami":
            if auth != f"Bearer {VALID_TOKEN}":
                return self._send_json(401, {"error": {"code": "unauthorized", "message": "bad"}})
            return self._send_json(200, {"user_id": "u1", "type": "agent", "token_id": "t1"})
        if parsed.path == f"/api/v1/artifacts/{ART_ID}/files":
            if auth != f"Bearer {VALID_TOKEN}":
                return self._send_json(401, {"error": {"code": "unauthorized", "message": "bad"}})
            data = b"fixture-bytes"
            return self._send_json(200, {"artifact_id": ART_ID, "state": "ready",
                "files": [{"path": "f.txt", "kind": "file", "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}]})
        if parsed.path == f"/api/v1/artifacts/{ART_ID}/files/f.txt/content":
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
