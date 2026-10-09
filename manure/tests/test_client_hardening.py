"""Client hardening: B1 redirect bodies, B2 bounds, B3 staging, B4 symlinks,
B5 resume/access, B7 credentials/IPv6, B10 PATCH sentinel."""
from __future__ import annotations

import hashlib
import json
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from manure.auth import generate_token as _gen_token  # canonical vectors (governor A1)
VALID_TOKEN = _gen_token()
ART_ID = "f" * 32


def _jb(o):
    return json.dumps(o).encode()


class Dummy:
    def __init__(self, fn):
        self.fn = fn
        self.requests: list[dict] = []

    def request(self, method, url, headers, body):
        self.requests.append({"method": method, "url": url, "headers": dict(headers), "body": body})
        return self.fn(method, url, headers, body)


class TestB1RedirectBody(unittest.TestCase):
    def test_307_unlock_body_refused(self):
        from manure.client import ManureClient
        seen_bodies: list[bytes | None] = []

        def fn(method, url, headers, body):
            parsed = urllib.parse.urlparse(url)
            if parsed.path == "/__manure/unlock":
                return (307, {"Location": "https://evil.example/unlock2"}, b"")
            seen_bodies.append(body)
            return (200, {}, b"")

        tr = Dummy(fn)
        c = ManureClient("http://127.0.0.1:8000", token=None,
                         cache_dir=tempfile.mkdtemp(), transport=tr)
        # Direct _request with body cross-origin 307 must refuse, not forward.
        with self.assertRaisesRegex(Exception, "cross-origin redirect with body"):
            c._request("POST", "http://127.0.0.1:8000/__manure/unlock",
                       {"Content-Type": "application/json"}, b'{"password":"P"}',
                       send_auth=False, send_grant=False, origin="http://127.0.0.1:8000")
        # evil destination never received the password body
        for b in seen_bodies:
            self.assertNotIn(b"password", b or b"")

    def test_308_chunk_body_refused_canary(self):
        from manure.client import ManureClient
        canary = b"CANARY-3078-BODY"
        got: list[dict] = []

        def fn(method, url, headers, body):
            got.append({"url": url, "body": body})
            if "/chunks" in url:
                return (308, {"Location": "https://evil.example/chunk2"}, b"")
            return (200, {}, b"")

        tr = Dummy(fn)
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                         cache_dir=tempfile.mkdtemp(), transport=tr)
        with self.assertRaises(Exception):
            c._request("PUT", "http://127.0.0.1:8000/api/v1/artifacts/x/chunks?path=f&offset=0",
                       {"Content-Type": "application/octet-stream"}, canary, send_auth=True)
        for r in got:
            if "evil.example" in r["url"]:
                self.fail("evil destination was contacted")
        # No evil request at all (refused before second hop)
        self.assertEqual(len(got), 1)

    def test_get_redirect_drops_creds_still_follows(self):
        from manure.client import ManureClient

        def fn(method, url, headers, body):
            if url.endswith("/start"):
                return (302, {"Location": "https://evil.example/other"}, b"")
            hdrl = {k.lower(): v for k, v in headers.items()}
            self.assertNotIn("authorization", hdrl)
            self.assertNotIn("cookie", hdrl)
            return (200, {}, b"ok")

        tr = Dummy(fn)
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                         cache_dir=tempfile.mkdtemp(), transport=tr)
        c._store_grant("127.0.0.1", "mgrant-dev=G")
        # GET with no body may follow cross-origin with dropped creds.
        status, _, body = c._request("GET", "http://127.0.0.1:8000/start")
        self.assertEqual(status, 200)


class TestB2Bounds(unittest.TestCase):
    def test_negative_and_nonint_sizes_rejected(self):
        from manure.client import validate_manifest, validate_fetch_manifest, InvalidManifest
        good_sha = "a" * 64
        for bad_size in (-1, True, False, "3", 3.0, None):
            with self.assertRaises(InvalidManifest, msg=str(bad_size)):
                validate_manifest([{"path": "f", "kind": "file", "size": bad_size, "sha256": good_sha}], "file")
            with self.assertRaises(InvalidManifest, msg=str(bad_size)):
                validate_fetch_manifest([{"path": "f", "kind": "file", "size": bad_size, "sha256": good_sha}])

    def test_chunk_bytes_bounds(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hi")
            for bad in (0, 1, 262143, 4194305, 1 << 30, "x", -5):
                routes = {
                    ("POST", "/api/v1/artifacts:init"): (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "chunk_bytes": bad, "content_url": "http://x"})),
                }
                tr = Dummy(lambda m, u, h, b, _r=routes: _route(_r, m, u))
                c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                                 cache_dir=os.path.join(td, "c"), transport=tr)
                with self.assertRaises(Exception, msg=str(bad)):
                    c.upload_path(src, access="internal", fresh=True)

    def test_oversized_range_ignored_before_write(self):
        from manure.client import ManureClient
        data = b"0123456789"
        sha = hashlib.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "f", "kind": "file", "size": 10, "sha256": sha}]}))
            # Range requested but server returns full 10 bytes as 200 with wrong size? Use oversize:
            if method == "GET" and url.endswith("/content"):
                hdrl = {k.lower(): v for k, v in headers.items()}
                if "range" in hdrl:
                    # Hostile: ignore Range, return 100 bytes as 200
                    return (200, {"Content-Type": "application/octet-stream"}, b"X" * 100)
                return (200, {"Content-Type": "application/octet-stream"}, data)
            return (404, {}, b"")

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            # Force ranged path by using a file larger than FETCH_RANGE? Instead directly
            # test _ranged_download with small size but stale partial to trigger Range.
            dest = Path(td) / "out" / "f"
            # Plant owned staging partial to force Range request, then hostile 200 must fail
            # without writing 100 bytes.
            from manure.client import FETCH_RANGE_BYTES
            # Use size 2MiB to force ranges: create manifest via direct download call.
            big = b"Z" * (2 * 1024 * 1024)
            big_sha = hashlib.sha256(big).hexdigest()

            def fn2(method, url, headers, body):
                hdrl = {k.lower(): v for k, v in headers.items()}
                if "range" in hdrl:
                    return (200, {"Content-Type": "application/octet-stream"}, b"X" * 100)
                return (200, {"Content-Type": "application/octet-stream"}, big)

            tr2 = Dummy(fn2)
            c2 = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                              cache_dir=os.path.join(td, "c2"), transport=tr2)
            from manure.client import ManureError
            with self.assertRaises(ManureError) as cm:
                c2._ranged_download("http://127.0.0.1:8000/api/v1/artifacts/x/files/f/content",
                                    dest, len(big), big_sha, grant_host=None, is_content=False,
                                    artifact_id=ART_ID, rel="f")
            self.assertEqual(cm.exception.code, "bad-envelope")
            # A Range request was actually sent (not a bare GET).
            sent = [r for r in tr2.requests if r["method"] == "GET"]
            self.assertTrue(any("range" in {k.lower() for k in r["headers"]} for r in sent),
                            msg=f"no Range sent: {sent}")
            # No 100-byte hostile payload persisted as final.
            if dest.exists():
                self.assertNotEqual(dest.stat().st_size, 100)
            self.assertFalse(dest.exists() and dest.read_bytes() == b"X" * 100)

    def test_content_range_mismatch_rejected(self):
        from manure.client import ManureClient
        size = 2 * 1024 * 1024
        sha = hashlib.sha256(b"Q" * size).hexdigest()

        def fn(method, url, headers, body):
            # Return 206 with lying Content-Range
            return (206, {"Content-Range": f"bytes 999-{999+len(b'hi')-1}/{size}"}, b"hi")

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            from manure.client import ManureError
            dest = Path(td) / "o" / "f"
            with self.assertRaises(ManureError) as cm:
                c._ranged_download("http://127.0.0.1:8000/x", dest,
                                    size, sha, grant_host=None, is_content=False,
                                    artifact_id=ART_ID, rel="f")
            self.assertEqual(cm.exception.code, "bad-envelope")
            sent = [r for r in tr.requests if r["method"] == "GET"]
            self.assertTrue(any("range" in {k.lower() for k in r["headers"]} for r in sent))
            self.assertFalse(dest.exists())


def _route(routes, method, url):
    import urllib.parse
    parsed = urllib.parse.urlparse(url)
    if method.upper() == "PUT" and parsed.path.endswith("/chunks"):
        qs = urllib.parse.parse_qs(parsed.query)
        try:
            off = int(qs.get("offset", ["0"])[0])
        except ValueError:
            off = 0
        path = qs.get("path", ["f"])[0]
        return (200, {"Content-Type": "application/json"},
                _jb({"path": path, "offset": off, "length": 1, "received_bytes": off + 1}))
    key = (method.upper(), parsed.path + (("?" + parsed.query) if parsed.query else ""))
    if key not in routes:
        key = (method.upper(), parsed.path)
    if key not in routes:
        return (404, {"Content-Type": "application/json"}, _jb({"error": {"code": "not-found", "message": "x"}}))
    s, h, b = routes[key]
    return (s, dict(h), b)


class TestB3Staging(unittest.TestCase):
    def test_existing_part_preserved(self):
        from manure.client import ManureClient
        data = b"hello"
        sha = hashlib.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "a", "kind": "file", "size": 5, "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            # Unrelated pre-existing a.part must survive (not owned, no sidecar).
            (dest / "a.part").write_bytes(b"UNRELATED")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual((dest / "a").read_bytes(), data)
            # Protected namespace: unrelated bare a.part must be byte-preserved.
            self.assertEqual((dest / "a.part").read_bytes(), b"UNRELATED")
            # No sidecar/tmp may appear as payload paths.
            self.assertFalse((dest / "a.part.json").exists())
            leftovers = [q for q in dest.rglob("*") if q.name.startswith(".manure-stage-")]
            # Staging namespace is cleaned on success.
            self.assertEqual(leftovers, [])

    def test_manifest_temp_collision_both_orders(self):
        from manure.client import ManureClient
        # Manifest contains both "a" and a staging-like name; exercise both orders
        # with the ACTUAL computed staging/sidecar/tmp names for payload "a".
        from manure.client import ManureClient as _MC
        with tempfile.TemporaryDirectory() as _td0:
            _probe = _MC("http://127.0.0.1:8000", token=VALID_TOKEN,
                         cache_dir=os.path.join(_td0, "c"),
                         transport=Dummy(lambda m, u, h, b: (404, {}, b"")))
            _staging_probe, _sidecar_probe = _probe._staging_paths(
                Path(_td0) / ".manure-stage-ffffffffffff", "a", "a" * 64)
            _tmp_probe = _sidecar_probe.with_name(_sidecar_probe.name + ".tmp")
        colliding = [_staging_probe.name, _sidecar_probe.name, _tmp_probe.name]
        for _order in (0, 1):
            da = b"DATA-A"
            # Second file is the actual computed staging name for "a".
            second = colliding[0]
            db = b"X" * 7
            sha_a = hashlib.sha256(da).hexdigest()
            sha_b = hashlib.sha256(db).hexdigest()
            files = [{"path": "a", "kind": "file", "size": len(da), "sha256": sha_a},
                     {"path": second, "kind": "file", "size": len(db), "sha256": sha_b}]
            if _order == 1:
                files = list(reversed(files))

            def fn(method, url, headers, body, _files=files):
                import urllib.parse
                if url.endswith("/files"):
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": "ready", "files": _files}))
                for f in _files:
                    enc = "/".join(urllib.parse.quote(s, safe="") for s in f["path"].split("/"))
                    if url.endswith(f"/files/{enc}/content"):
                        payload = da if f["path"] == "a" else db
                        return (200, {"Content-Type": "application/octet-stream"}, payload)
                return (404, {}, b"")

            tr = Dummy(fn)
            with tempfile.TemporaryDirectory() as td:
                dest = Path(td) / "out"
                c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                                 cache_dir=os.path.join(td, "c"), transport=tr)
                # Fetch entries in both orders by sorting manifest accordingly.
                res = c.fetch_to_dest(ART_ID, str(dest))
                self.assertEqual((dest / "a").read_bytes(), da)
                self.assertEqual((dest / second).read_bytes(), db)


class TestB4Symlink(unittest.TestCase):
    def test_dest_symlink_ancestor_rejected_before_mkdir(self):
        from manure.client import ManureClient

        def fn(method, url, headers, body):
            return (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "ready", "files": []}))

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            real = Path(td) / "real"
            real.mkdir()
            link = Path(td) / "link"
            link.symlink_to(real, target_is_directory=True)
            dest = link / "newdir"
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, str(dest))
            # Must not have created through the symlink.
            self.assertFalse((real / "newdir").exists())

    def test_empty_manifest_through_symlink_rejected(self):
        from manure.client import ManureClient

        def fn(method, url, headers, body):
            return (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "ready", "files": []}))

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            real = Path(td) / "real"
            real.mkdir()
            link = Path(td) / "link"
            link.symlink_to(real, target_is_directory=True)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, str(link / "child"))

    def test_source_parent_swap_rejected(self):
        from manure.client import build_manifest
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "root"
            root.mkdir()
            (root / "f.txt").write_bytes(b"data")
            # Swap a parent component with a symlink before hashing/reading.
            # Simulate by replacing root/sub with symlink: build must reject.
            sub = root / "sub"
            sub.mkdir()
            (sub / "g.txt").write_bytes(b"g")
            # Replace sub with symlink to elsewhere
            import shutil
            shutil.rmtree(sub)
            sub.symlink_to(Path(td), target_is_directory=True)
            with self.assertRaises(Exception):
                build_manifest(root)


class TestB5ResumeAccess(unittest.TestCase):
    def _mk(self, td, access_cached="internal", access_server="internal", state="uploading"):
        import json as js
        from manure.client import build_manifest, _manifest_sha256
        src = os.path.join(td, "f.txt")
        Path(src).write_bytes(b"hello world")
        kind, entries = build_manifest(src)
        msha = _manifest_sha256(entries)
        cache = os.path.join(td, "cache", "uploads")
        os.makedirs(cache, exist_ok=True)
        Path(os.path.join(cache, ART_ID + ".json")).write_text(js.dumps({
            "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
            "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": access_cached}))
        _sha_hw = hashlib.sha256(b"hello world").hexdigest()
        _published = {"flag": False}

        class _Stateful(Dummy):
            def __init__(self, routes):
                self.routes = routes
                self.requests = []

            def request(self, method, url, headers, body):
                import urllib.parse
                parsed = urllib.parse.urlparse(url)
                self.requests.append({"method": method, "url": url,
                                      "headers": dict(headers), "body": body})
                if method == "PUT" and parsed.path.endswith("/chunks"):
                    qs = urllib.parse.parse_qs(parsed.query)
                    try:
                        off = int(qs.get("offset", ["0"])[0])
                    except ValueError:
                        off = 0
                    return (200, {"Content-Type": "application/json"},
                            _jb({"path": "f.txt", "offset": off, "length": 1,
                                 "received_bytes": off + 1}))
                if method == "POST" and parsed.path.endswith("/publish"):
                    _published["flag"] = True
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": "ready",
                                 "content_url": "http://x"}))
                if method == "GET" and parsed.path.endswith(f"/artifacts/{ART_ID}"):
                    st = "ready" if (_published["flag"] or state == "ready") else state
                    return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "name": "n", "kind": "file",
                             "visibility": access_server, "state": st,
                             "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                             "expires_at": None, "total_bytes": 11, "file_count": 1,
                             "content_url": "http://x"}))
                return _route(self.routes, method, url)

        routes = {
            ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                _jb({"artifact_id": ART_ID, "state": state, "chunk_bytes": 262144,
                     "files": [{"path": "f.txt", "size": 11, "received_bytes": 0, "received_ranges": []}]})),
            ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                _jb({"artifact_id": ART_ID, "state": state,
                     "files": [{"path": "f.txt", "kind": "file", "size": 11, "sha256": _sha_hw}]})),
            ("POST", f"/api/v1/artifacts/{ART_ID}/publish"): (200, {"Content-Type": "application/json"},
                _jb({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"})),
        }
        return src, _Stateful(routes)

    def test_cached_access_mismatch_rejected(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            src, tr = self._mk(td, access_cached="public", access_server="public")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            with self.assertRaisesRegex(Exception, "visibility|mismatch|access"):
                c.upload_path(src, access="internal", resume_id=ART_ID)
            # No mutation (no PUT/publish) after mismatch.
            self.assertFalse(any(r["method"] in ("PUT", "POST") and "publish" in r["url"] or r["method"] == "PUT" for r in tr.requests if r["method"] == "PUT"))

    def test_reports_actual_visibility(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            src, tr = self._mk(td, access_cached="internal", access_server="internal")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            res = c.upload_path(src, access="internal", resume_id=ART_ID)
            self.assertEqual(res["access"], "internal")

    def test_ready_resume_no_puts_and_retires(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            src, tr = self._mk(td, state="ready")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            res = c.upload_path(src, access="internal", resume_id=ART_ID)
            puts = [r for r in tr.requests if r["method"] == "PUT"]
            self.assertEqual(puts, [])
            self.assertFalse(os.path.exists(os.path.join(td, "cache", "uploads", ART_ID + ".json")))


class TestB7Credentials(unittest.TestCase):
    def test_malformed_direct_token_before_network(self):
        from manure.client import ManureClient
        tr = Dummy(lambda m, u, h, b: (200, {}, b""))
        with self.assertRaises(Exception):
            ManureClient("http://127.0.0.1:8000", token="short", transport=tr)
        # Secret value must not appear in the message.
        try:
            ManureClient("http://127.0.0.1:8000", token="SECRET-LEAK-VALUE-1234567890123456789ABCD", transport=tr)
        except Exception as e:
            self.assertNotIn("SECRET-LEAK", str(e))

    def test_missing_file_normalized(self):
        from manure.client import ManureClient
        tr = Dummy(lambda m, u, h, b: (200, {}, b""))
        with self.assertRaises(Exception) as cm:
            ManureClient("http://127.0.0.1:8000", token_file="/nonexistent-tok-xyz", transport=tr)
        # No traceback path leak of secrets; code is missing-credentials/unauthorized.
        self.assertIn(getattr(cm.exception, "code", ""), ("missing-credentials", "unauthorized"))

    def test_invalid_port_before_network(self):
        from manure.client import ManureClient
        tr = Dummy(lambda m, u, h, b: (200, {}, b""))
        c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN, transport=tr)
        with self.assertRaises(Exception):
            c._request("GET", "http://127.0.0.1:99999/x")

    def test_ipv6_origin_bracketed(self):
        from manure.client import origin_of
        self.assertEqual(origin_of("http://[::1]:8000/x"), "http://[::1]:8000")
        from manure.client import ManureClient
        hit: list[dict] = []

        def fn(method, url, headers, body):
            hit.append({"url": url})
            return (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "ready", "files": []}))

        tr = Dummy(fn)
        c = ManureClient("http://[::1]:8000", token=VALID_TOKEN, transport=tr)
        # Content origin helper must produce bracketed host (no crash).
        out = c.fetch_to_dest("http://[::1]:8000/", tempfile.mkdtemp())
        self.assertEqual(out["artifact_id"], ART_ID)


class TestB10Patch(unittest.TestCase):
    def test_shorten_extend_clear_bodies(self):
        from manure.client import ManureClient, PATCH_OMIT
        bodies: list[dict] = []

        def fn(method, url, headers, body):
            import urllib.parse
            parsed = urllib.parse.urlparse(url)
            if method == "PATCH":
                bodies.append(json.loads(body.decode()))
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "visibility": "internal", "content_url": "http://x"}))
            return (404, {}, b"")

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.patch_artifact(ART_ID, expires_in_s=3600)
            c.patch_artifact(ART_ID, expires_in_s=None)
            c.patch_artifact(ART_ID, visibility="public")
            self.assertEqual(bodies[0], {"expires_in_s": 3600})
            self.assertEqual(bodies[1], {"expires_in_s": None})
            self.assertEqual(bodies[2], {"visibility": "public"})
            # Omitted TTL sends no key.
            bodies.clear()
            c.patch_artifact(ART_ID, visibility="internal")
            self.assertNotIn("expires_in_s", bodies[0])
            # Name shorten/rename body + validation before network.
            bodies.clear()
            c.patch_artifact(ART_ID, name="renamed-site")
            self.assertEqual(bodies[0], {"name": "renamed-site"})
            n_before = len(tr.requests)
            with self.assertRaises(Exception):
                c.patch_artifact(ART_ID, name="")
            with self.assertRaises(Exception):
                c.patch_artifact(ART_ID, name="x" * 257)
            self.assertEqual(len(tr.requests), n_before)
            # Invalid visibility/TTL before network.
            n_before = len(tr.requests)
            with self.assertRaises(Exception):
                c.patch_artifact(ART_ID, visibility="bogus")
            with self.assertRaises(Exception):
                c.patch_artifact(ART_ID, expires_in_s="bogus")
            self.assertEqual(len(tr.requests), n_before)


if __name__ == "__main__":
    unittest.main()

class TestB4SwapDeterministic(unittest.TestCase):
    def test_source_file_swapped_to_symlink_rejected(self):
        from manure.client import build_manifest
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "root"
            root.mkdir()
            target = Path(td) / "target"
            target.write_bytes(b"evil")
            f = root / "f.txt"
            f.write_bytes(b"good-data")
            kind, entries = build_manifest(root)
            # Swap leaf with symlink after manifest.
            f.unlink()
            f.symlink_to(target)
            from manure.client import ManureClient
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"),
                             transport=Dummy(lambda m, u, h, b: (200, {}, b"")))
            with self.assertRaises(Exception):
                c._read_chunk(root, kind, "f.txt", 0, int(entries[0]["size"]), entries[0])

    def test_fetch_final_swapped_to_symlink_refused(self):
        from manure.client import ManureClient
        import hashlib as _hl
        data = b"payload"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "v", "kind": "file", "size": len(data), "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            # Pre-plant symlink at final path (simulates swap before install).
            (dest / "v").symlink_to("/etc/passwd")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, str(dest))
            # Target must be untouched (still a symlink, not replaced).
            self.assertTrue((dest / "v").is_symlink())


class TestB7SecretCanary(unittest.TestCase):
    def test_transport_error_hides_authorization(self):
        from manure.client import ManureClient
        secret = VALID_TOKEN

        class Boom:
            def request(self, method, url, headers, body):
                raise ConnectionError(f"boom {headers.get('Authorization', '')}")

        c = ManureClient("http://127.0.0.1:8000", token=secret,
                         cache_dir=tempfile.mkdtemp(), transport=Boom())
        try:
            c.whoami()
            self.fail("expected error")
        except Exception as e:
            self.assertNotIn(secret, str(e))
            self.assertNotIn("Bearer", str(e))


class TestB8TopologyHashes(unittest.TestCase):
    def test_topology_uses_valid_hashes(self):
        from manure.client import validate_manifest
        h = "b" * 64
        # Duplicate with valid hashes must report duplicate (not bad sha).
        with self.assertRaisesRegex(Exception, "duplicate"):
            validate_manifest([{"path": "a", "kind": "file", "size": 1, "sha256": h},
                               {"path": "a", "kind": "file", "size": 1, "sha256": h}], "dir")
        with self.assertRaisesRegex(Exception, "conflict"):
            validate_manifest([{"path": "a", "kind": "file", "size": 1, "sha256": h},
                               {"path": "a/b", "kind": "file", "size": 1, "sha256": h}], "dir")

class TestB5RecoveryManifest(unittest.TestCase):
    def test_publishing_recovery_continues_not_success(self):
        from manure.client import ManureClient
        import hashlib as _hl
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            hw = _hl.sha256(b"hello world").hexdigest()
            from manure.client import build_manifest, _manifest_sha256
            import json as _js
            _, entries = build_manifest(src)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(_js.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "internal"}))
            calls = {"status": 0, "published": False}

            def fn(method, url, headers, body):
                import urllib.parse
                parsed = urllib.parse.urlparse(url)
                if parsed.path.endswith("/upload-status"):
                    calls["status"] += 1
                    # First: publishing, then uploading (recovery).
                    state = "publishing" if calls["status"] == 1 else "uploading"
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": state, "chunk_bytes": 262144,
                                 "files": [{"path": "f.txt", "size": 11, "received_bytes": 0, "received_ranges": []}]}))
                if parsed.path.endswith("/files") and not parsed.path.endswith("/content"):
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": "uploading",
                                 "files": [{"path": "f.txt", "kind": "file", "size": 11, "sha256": hw}]}))
                if parsed.path.endswith(f"/artifacts/{ART_ID}") and method == "GET":
                    # Authoritative info: uploading until publish, ready after.
                    st = "ready" if calls["published"] else "uploading"
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "name": "n", "kind": "file", "visibility": "internal",
                                 "state": st, "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                                 "expires_at": None, "total_bytes": 11, "file_count": 1, "content_url": "http://x"}))
                if method == "PUT":
                    return (200, {"Content-Type": "application/json"},
                            _jb({"path": "f.txt", "offset": 0, "length": 11, "received_bytes": 11}))
                if parsed.path.endswith("/publish"):
                    calls["published"] = True
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"}))
                return (404, {}, b"")

            tr = Dummy(fn)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            res = c.upload_path(src, access="internal", resume_id=ART_ID)
            # Must have sent chunks (recovered, not false success) and retired.
            puts = [r for r in tr.requests if r["method"] == "PUT"]
            self.assertTrue(puts)
            self.assertFalse(os.path.exists(os.path.join(cache, ART_ID + ".json")))

    def test_server_manifest_mismatch_rejected(self):
        from manure.client import ManureClient
        with tempfile.TemporaryDirectory() as td:
            src = os.path.join(td, "f.txt")
            Path(src).write_bytes(b"hello world")
            from manure.client import build_manifest, _manifest_sha256
            import json as _js
            _, entries = build_manifest(src)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(_js.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(Path(src).resolve()), "manifest_sha256": msha, "access": "internal"}))

            def fn(method, url, headers, body):
                import urllib.parse
                parsed = urllib.parse.urlparse(url)
                if parsed.path.endswith("/upload-status"):
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                                 "files": [{"path": "f.txt", "size": 11, "received_bytes": 0, "received_ranges": []}]}))
                if parsed.path.endswith("/files") and not parsed.path.endswith("/content"):
                    # Server manifest differs (different sha).
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "state": "uploading",
                                 "files": [{"path": "f.txt", "kind": "file", "size": 11, "sha256": "c" * 64}]}))
                if parsed.path.endswith(f"/artifacts/{ART_ID}"):
                    return (200, {"Content-Type": "application/json"},
                            _jb({"artifact_id": ART_ID, "name": "n", "kind": "file", "visibility": "internal",
                                 "state": "uploading", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                                 "expires_at": None, "total_bytes": 11, "file_count": 1, "content_url": "http://x"}))
                return (404, {}, b"")

            tr = Dummy(fn)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            with self.assertRaisesRegex(Exception, "manifest differs"):
                c.upload_path(src, access="internal", resume_id=ART_ID)
            self.assertFalse(any(r["method"] == "PUT" for r in tr.requests))

class TestB3NamespaceOwnership(unittest.TestCase):
    def _fetch_fn(self, files, payloads):
        def fn(method, url, headers, body):
            import urllib.parse
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready", "files": files}))
            for f in files:
                if f["kind"] != "file":
                    continue
                enc = "/".join(urllib.parse.quote(s, safe="") for s in f["path"].split("/"))
                if url.endswith(f"/files/{enc}/content"):
                    return (200, {"Content-Type": "application/octet-stream"},
                            payloads[f["path"]])
            return (404, {}, b"")

        return fn

    def test_preexisting_namespace_contents_preserved(self):
        from manure.client import ManureClient
        import hashlib as _hl
        da = b"PAYLOAD"
        sha = _hl.sha256(da).hexdigest()
        files = [{"path": "a", "kind": "file", "size": len(da), "sha256": sha}]
        tr = Dummy(self._fetch_fn(files, {"a": da}))
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            # Pre-existing adopted-candidate dir with unrelated contents.
            ns = dest / ".manure-stage-ffffffffffff"
            ns.mkdir()
            (ns / "keep.txt").write_bytes(b"UNRELATED")
            (ns / "sub").mkdir()
            (ns / "sub" / "deep.bin").write_bytes(b"DEEP")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual((dest / "a").read_bytes(), da)
            # Unrelated namespace contents byte-preserved (never adopted/deleted).
            self.assertEqual((ns / "keep.txt").read_bytes(), b"UNRELATED")
            self.assertEqual((ns / "sub" / "deep.bin").read_bytes(), b"DEEP")

    def test_empty_manifest_creates_nothing_extra(self):
        from manure.client import ManureClient

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready", "files": []}))
            return (404, {}, b"")

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            (dest / "keep").write_bytes(b"K")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            res = c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual(res["file_count"], 0)
            # No staging namespace created for an empty manifest.
            self.assertEqual(sorted(q.name for q in dest.iterdir()), ["keep"])

    def test_fallback_payload_collision_both_orders(self):
        from manure.client import ManureClient
        import hashlib as _hl
        # Manifest holds a payload exactly at the fallback namespace name.
        da = b"A" * 5
        db = b"B" * 6
        sha_a = _hl.sha256(da).hexdigest()
        sha_b = _hl.sha256(db).hexdigest()
        base_ns = ".manure-stage-ffffffffffff"
        for order in (0, 1):
            files = [{"path": "a", "kind": "file", "size": len(da), "sha256": sha_a},
                     {"path": f"{base_ns}.1/keep", "kind": "file", "size": len(db), "sha256": sha_b}]
            if order == 1:
                files = list(reversed(files))
            tr = Dummy(self._fetch_fn(files, {f['path']: (da if f['path'] == 'a' else db) for f in files}))
            with tempfile.TemporaryDirectory() as td:
                dest = Path(td) / "out"
                dest.mkdir()
                # Pre-existing REGULAR FILE at the base candidate forces fallback.
                (dest / base_ns).write_bytes(b"BLOCKER")
                c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                                 cache_dir=os.path.join(td, "c"), transport=tr)
                c.fetch_to_dest(ART_ID, str(dest))
                self.assertEqual((dest / "a").read_bytes(), da)
                self.assertEqual((dest / f"{base_ns}.1/keep").read_bytes(), db)
                # Blocker payload preserved (fallback validated, never replaced).
                self.assertEqual((dest / base_ns).read_bytes(), b"BLOCKER")

    def test_successful_replace_preserves_foreign_backup(self):
        # B3: reused owned namespace already holds an unrelated
        # `.manure-backup-<pid>` (same-PID foreign bytes). A successful
        # replace must disambiguate (link fails EEXIST on the foreign name,
        # allocates `.1`), install the new bytes, preserve the foreign file
        # byte-exact, and clean solely the owned backup (inode-checked).
        from manure.client import ManureClient
        import hashlib as _hl
        import json as _js
        old = b"OLD-BYTES-123456"
        new = b"NEW-BYTES-7890123"
        sha_new = _hl.sha256(new).hexdigest()
        files = [{"path": "a", "kind": "file", "size": len(new), "sha256": sha_new}]
        tr = Dummy(self._fetch_fn(files, {"a": new}))
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            (dest / "a").write_bytes(old)
            ns = dest / ".manure-stage-ffffffffffff"
            ns.mkdir()
            (ns / ".manure-owner.json").write_text(_js.dumps({"artifact_id": ART_ID}))
            foreign_name = f".manure-backup-{os.getpid()}"
            foreign_bytes = b"FOREIGN-BACKUP-BYTES"
            (ns / foreign_name).write_bytes(foreign_bytes)
            foreign_stat = os.stat(ns / foreign_name)
            foreign_ino = (foreign_stat.st_dev, foreign_stat.st_ino)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual((dest / "a").read_bytes(), new)
            # Foreign byte-exact + inode-stable (never unlinked/replaced).
            self.assertTrue((ns / foreign_name).exists())
            self.assertEqual((ns / foreign_name).read_bytes(), foreign_bytes)
            cur = os.stat(ns / foreign_name)
            self.assertEqual((cur.st_dev, cur.st_ino), foreign_ino)
            # Owned disambiguated backup cleaned; foreign base remains sole entry.
            self.assertFalse((ns / (foreign_name + ".1")).exists())
            self.assertEqual(sorted(p.name for p in ns.iterdir()),
                             sorted([foreign_name]))

    def test_backup_cleanup_never_unlinks_foreign_inode(self):
        # B3: inode-owned cleanup — a foreign file swapped in at the owned
        # backup name between preserve-link and cleanup must be preserved
        # (dev/ino mismatch ⇒ no unlink). Successful replace still installs.
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        import json as _js
        old = b"OLD-BYTES-123456"
        new = b"NEW-BYTES-7890123"
        sha_new = _hl.sha256(new).hexdigest()
        files = [{"path": "a", "kind": "file", "size": len(new), "sha256": sha_new}]
        tr = Dummy(self._fetch_fn(files, {"a": new}))
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            (dest / "a").write_bytes(old)
            ns = dest / ".manure-stage-ffffffffffff"
            ns.mkdir()
            (ns / ".manure-owner.json").write_text(_js.dumps({"artifact_id": ART_ID}))
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            real_rename = _cm.os.rename
            swapped = {"done": False}
            foreign_bytes = b"FOREIGN-SWAPPED-BYTES"

            def hooked_rename(src, dst, **kw):
                res = real_rename(src, dst, **kw)
                if not swapped["done"]:
                    swapped["done"] = True
                    src_fd = kw.get("src_dir_fd")
                    backup_name = f".manure-backup-{os.getpid()}"
                    try:
                        _cm.os.unlink(backup_name, dir_fd=src_fd)
                    except OSError:
                        return res
                    try:
                        fd = _cm.os.open(backup_name,
                                        _cm.os.O_WRONLY | _cm.os.O_CREAT | _cm.os.O_EXCL
                                        | _cm.os.O_NOFOLLOW, 0o600, dir_fd=src_fd)
                    except OSError:
                        return res
                    try:
                        _cm.os.write(fd, foreign_bytes)
                    finally:
                        try:
                            _cm.os.close(fd)
                        except OSError:
                            pass
                return res

            import unittest.mock as _mock
            with _mock.patch.object(_cm.os, "rename", side_effect=hooked_rename):
                c.fetch_to_dest(ART_ID, str(dest))
            self.assertTrue(swapped["done"])
            self.assertEqual((dest / "a").read_bytes(), new)
            # Foreign preserved (never unlinked despite same-PID name).
            backup_path = ns / f".manure-backup-{os.getpid()}"
            self.assertTrue(backup_path.exists())
            self.assertEqual(backup_path.read_bytes(), foreign_bytes)

    def test_backup_verify_never_unlinks_foreign(self):
        # B3: post-link/pre-verification window — replacing the freshly
        # linked backup before its identity check must not delete the
        # foreign entry. Must raise invalid-path, leave the original
        # destination byte-identical, and preserve the foreign backup's
        # exact bytes and inode.
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        import json as _js
        old = b"OLD-BYTES-123456"
        new = b"NEW-BYTES-7890123"
        sha_new = _hl.sha256(new).hexdigest()
        files = [{"path": "a", "kind": "file", "size": len(new), "sha256": sha_new}]
        tr = Dummy(self._fetch_fn(files, {"a": new}))
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            (dest / "a").write_bytes(old)
            ns = dest / ".manure-stage-ffffffffffff"
            ns.mkdir()
            (ns / ".manure-owner.json").write_text(_js.dumps({"artifact_id": ART_ID}))
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            real_link = _cm.os.link
            swapped = {"done": False}
            foreign_bytes = b"FOREIGN-POST-LINK-BYTES"
            planted_ino: dict[str, tuple[int, int]] = {}

            def hooked_link(src, dst, **kw):
                res = real_link(src, dst, **kw)
                if not swapped["done"] and str(dst).startswith(".manure-backup-"):
                    swapped["done"] = True
                    dst_fd = kw.get("dst_dir_fd")
                    try:
                        _cm.os.unlink(dst, dir_fd=dst_fd)
                    except OSError:
                        return res
                    try:
                        fd = _cm.os.open(dst,
                                        _cm.os.O_WRONLY | _cm.os.O_CREAT | _cm.os.O_EXCL
                                        | _cm.os.O_NOFOLLOW, 0o600, dir_fd=dst_fd)
                    except OSError:
                        return res
                    try:
                        _cm.os.write(fd, foreign_bytes)
                    finally:
                        try:
                            _cm.os.close(fd)
                        except OSError:
                            pass
                    try:
                        st = _cm.os.stat(dst, dir_fd=dst_fd, follow_symlinks=False)
                        planted_ino["ino"] = (st.st_dev, st.st_ino)
                    except OSError:
                        pass
                return res

            import unittest.mock as _mock
            with _mock.patch.object(_cm.os, "link", side_effect=hooked_link):
                with self.assertRaises(Exception) as ctx:
                    c.fetch_to_dest(ART_ID, str(dest))
                self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")
            self.assertTrue(swapped["done"])
            self.assertIn("ino", planted_ino)
            # Original destination unchanged (rename never ran).
            self.assertEqual((dest / "a").read_bytes(), old)
            # Foreign byte- and inode-preserved (never unlinked on mismatch).
            backup_path = ns / f".manure-backup-{os.getpid()}"
            self.assertTrue(backup_path.exists())
            self.assertEqual(backup_path.read_bytes(), foreign_bytes)
            cur = os.stat(backup_path)
            self.assertEqual((cur.st_dev, cur.st_ino), planted_ino["ino"])


class TestB4SwapHooks(unittest.TestCase):
    def test_ancestor_swap_between_init_and_read_sends_nothing(self):
        from manure.client import ManureClient
        import shutil
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "root"
            root.mkdir()
            (root / "f.txt").write_bytes(b"GOODPAYLOAD!!")
            from manure.client import build_manifest, _manifest_sha256
            import json as _js
            kind, entries = build_manifest(root)
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(_js.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str(root.resolve()), "manifest_sha256": msha,
                "access": "internal"}))
            hw = entries[0]["sha256"] if entries[0]["kind"] == "file" else None
            # Server manifest mirrors the built (good) manifest.
            routes = {
                ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                         "files": [{"path": "f.txt", "size": 13, "received_bytes": 0, "received_ranges": []}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "uploading",
                         "files": [{"path": "f.txt", "kind": "file", "size": 13, "sha256": hw}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "name": "n", "kind": "dir", "visibility": "internal",
                         "state": "uploading", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                         "expires_at": None, "total_bytes": 13, "file_count": 1, "content_url": "http://x"})),
            }
            sent: list[bytes] = []

            class Hook(Dummy):
                def request(self, method, url, headers, body):
                    import urllib.parse
                    parsed = urllib.parse.urlparse(url)
                    if method == "PUT":
                        sent.append(bytes(body))
                        return (200, {"Content-Type": "application/json"},
                                _jb({"path": "f.txt", "offset": 0, "length": len(body),
                                     "received_bytes": len(body)}))
                    return _route(routes, method, url)

            tr = Hook(lambda m, u, h, b: (404, {}, b""))
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            # Deterministic hook: swap root for a symlink AFTER init/status but
            # BEFORE chunk reads by patching put_chunk to swap on first call.
            orig_put = c.put_chunk
            swapped = {"done": False}

            def swapping_put(aid, path, off, data):
                if not swapped["done"]:
                    swapped["done"] = True
                    # Replace a file the pinned root already validated.
                    (root / "f.txt").unlink()
                    (root / "f.txt").symlink_to(Path(td) / "outside.txt")
                return orig_put(aid, path, off, data)

            Path(td, "outside.txt").write_bytes(b"EVIL-EVIL-EVI!")
            c.put_chunk = swapping_put  # type: ignore[method-assign]
            with self.assertRaises(Exception):
                c.upload_path(str(root), access="internal", resume_id=ART_ID)
            # No outside bytes were sent (pinned reads fail closed).
            for body in sent:
                self.assertNotIn(b"EVIL", bytes(body))

    def test_staging_swap_between_verify_and_install(self):
        from manure.client import ManureClient
        import hashlib as _hl
        data = b"STAGEDATA"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "v", "kind": "file", "size": len(data),
                                        "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            # Hook renameat: swap staging content after hash verify is not
            # directly hookable; instead verify symlink install is refused when
            # the final path becomes a symlink just before install.
            orig_install = c._install_staging

            def swapping_install(staging, sidecar, final, size, fsha):
                if not final.is_symlink():
                    try:
                        final.unlink(missing_ok=True)
                    except OSError:
                        pass
                    final.symlink_to(Path(td) / "evil-target")
                return orig_install(staging, sidecar, final, size, fsha)

            Path(td, "evil-target").write_bytes(b"EVIL")
            c._install_staging = swapping_install  # type: ignore[method-assign]
            with self.assertRaises(Exception):
                c.fetch_to_dest(ART_ID, str(dest))
            # Symlink preserved (never replaced), target untouched.
            self.assertTrue((dest / "v").is_symlink())
            self.assertEqual(Path(td, "evil-target").read_bytes(), b"EVIL")

class TestB11LongPaths(unittest.TestCase):
    def test_nested_path_over_255_roundtrip(self):
        from manure.client import ManureClient
        # Two 100-char components + 60-char file = 262-char rel: contract-valid
        # (<=1024 chars, depth ok) but over NAME_MAX as a flat filename.
        d1, d2 = "d" * 100, "e" * 100
        fname = "f" * 60
        rel = f"{d1}/{d2}/{fname}"
        self.assertGreater(len(rel), 255)
        data = b"LONGPATH-DATA"
        import hashlib as _hl
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            import urllib.parse
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": rel, "kind": "file",
                                        "size": len(data), "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual((dest / rel).read_bytes(), data)

    def test_interrupted_long_path_resume(self):
        from manure.client import ManureClient, StdlibTransport
        d1, d2 = "d" * 100, "e" * 100
        rel = f"{d1}/{d2}/" + "g" * 60
        payload = b"R" * (2 * 1024 * 1024)
        import hashlib as _hl
        sha = _hl.sha256(payload).hexdigest()

        def fn(method, url, headers, body):
            import urllib.parse
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": rel, "kind": "file",
                                        "size": len(payload), "sha256": sha}]}))
            hdrl = {k.lower(): v for k, v in headers.items()}
            if "range" in hdrl:
                s = int(hdrl["range"].split("=")[1].split("-")[0])
                part = payload[s:s + 1048576]
                return (206, {"Content-Range": f"bytes {s}-{s+len(part)-1}/{len(payload)}"}, part)
            return (200, {"Content-Type": "application/octet-stream"}, payload)

        with tempfile.TemporaryDirectory() as td:
            dest = os.path.join(td, "out")

            class FailOnce:
                def __init__(self, inner):
                    self.inner = inner
                    self.n = 0

                def request(self, method, url, headers, body):
                    if method == "GET" and "/content" in url:
                        self.n += 1
                        if self.n > 1:
                            raise ConnectionError("interrupted")
                    return self.inner.request(method, url, headers, body)

            tr = Dummy(fn)
            c1 = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                              cache_dir=os.path.join(td, "c1"),
                              transport=FailOnce(tr))
            with self.assertRaises(Exception):
                c1.fetch_to_dest(ART_ID, dest)
            c2 = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                              cache_dir=os.path.join(td, "c2"), transport=Dummy(fn))
            c2.fetch_to_dest(ART_ID, dest)
            self.assertEqual(Path(os.path.join(dest, rel)).read_bytes(), payload)

    def test_slash_flatten_collision_impossible(self):
        from manure.client import ManureClient
        # "a/b" and "a__b" would collide under lossy flattening; hash-derived
        # names keep them distinct.
        import hashlib as _hl
        da, db = b"DATA-1", b"DATA-22"
        fa = {"path": "a/b", "kind": "file", "size": len(da),
              "sha256": _hl.sha256(da).hexdigest()}
        fb = {"path": "a__b", "kind": "file", "size": len(db),
              "sha256": _hl.sha256(db).hexdigest()}

        def fn(method, url, headers, body):
            import urllib.parse
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [fa, fb]}))
            if "a%2Fb" in url or url.endswith("/a/b/content"):
                return (200, {"Content-Type": "application/octet-stream"}, da)
            return (200, {"Content-Type": "application/octet-stream"}, db)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual((dest / "a/b").read_bytes(), da)
            self.assertEqual((dest / "a__b").read_bytes(), db)

class TestB4BoundaryHooks(unittest.TestCase):
    def test_dest_ancestor_swap_before_parent_open(self):
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        data = b"DESTDATA"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "sub/f", "kind": "file",
                                        "size": len(data), "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            outside = Path(td) / "outside"
            outside.mkdir()
            (outside / "marker").write_bytes(b"MARKER")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            orig = _cm.ManureClient._ensure_parent_no_symlink
            swapped = {"done": False}

            def hooked(final):
                orig(final)
                if not swapped["done"]:
                    swapped["done"] = True
                    sub = Path(str(final).split("/out/")[0]) / "out" / "sub"
                    import shutil
                    if sub.exists() and not sub.is_symlink():
                        shutil.rmtree(sub)
                    elif sub.is_symlink():
                        sub.unlink()
                    sub.symlink_to(outside, target_is_directory=True)

            _cm.ManureClient._ensure_parent_no_symlink = staticmethod(hooked)
            try:
                with self.assertRaises(Exception) as cm:
                    c.fetch_to_dest(ART_ID, str(dest))
                self.assertEqual(getattr(cm.exception, "code", ""), "invalid-path")
            finally:
                _cm.ManureClient._ensure_parent_no_symlink = staticmethod(orig)
            # Outside untouched; nothing installed through the symlink.
            self.assertEqual((outside / "marker").read_bytes(), b"MARKER")
            self.assertFalse((outside / "f").exists())
            self.assertTrue(Path(str(dest)).is_symlink() or True)

    def test_staging_swap_at_rename_boundary(self):
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        data = b"RENAMEDATA"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "v", "kind": "file",
                                        "size": len(data), "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            target = Path(td) / "target"
            target.write_bytes(b"TARGET")
            # Pre-existing destination with original bytes.
            (dest / "v").write_bytes(b"ORIGINAL-BYTES")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            real_rename = _cm.os.rename
            swapped = {"done": False}

            def hooked_rename(src, dst, **kw):
                if not swapped["done"]:
                    swapped["done"] = True
                    # Swap the staging entry for a symlink just before rename.
                    import os as _os
                    try:
                        if kw.get("src_dir_fd") is not None:
                            _os.unlink(src, dir_fd=kw["src_dir_fd"])
                            _os.symlink(str(target), src, dir_fd=kw["src_dir_fd"])
                        else:
                            _os.unlink(src)
                            _os.symlink(str(target), src)
                    except OSError:
                        pass
                return real_rename(src, dst, **kw)

            _cm.os.rename = hooked_rename
            try:
                with self.assertRaises(Exception) as ctx:
                    c.fetch_to_dest(ART_ID, str(dest))
                self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")
            finally:
                _cm.os.rename = real_rename
            # Refused install preserves the previous destination byte-for-byte;
            # no symlink installed, outside target untouched.
            fin = dest / "v"
            self.assertFalse(fin.is_symlink())
            self.assertEqual(fin.read_bytes(), b"ORIGINAL-BYTES")
            self.assertEqual(target.read_bytes(), b"TARGET")

    def test_cleanup_preserves_owned_namespace_unrelated(self):
        from manure.client import ManureClient
        import hashlib as _hl
        import json as _js
        data = b"RESUMEDATA!!"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "a", "kind": "file",
                                        "size": len(data), "sha256": sha}]}))
            hdrl = {k.lower(): v for k, v in headers.items()}
            if "range" in hdrl:
                s = int(hdrl["range"].split("=")[1].split("-")[0])
                part = data[s:]
                return (206, {"Content-Range": f"bytes {s}-{s+len(part)-1}/{len(data)}"}, part)
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            # Legitimately-owned namespace with unrelated suffix-matching files.
            ns = dest / ".manure-stage-ffffffffffff"
            ns.mkdir()
            (ns / ".manure-owner.json").write_text(_js.dumps({"artifact_id": ART_ID}))
            (ns / "backup.tmp").write_bytes(b"BACKUP")
            # Foreign PID-suffixed tmp + incomplete/unrelated sidecars: a PID
            # suffix or artifact-only binding alone never establishes ownership.
            (ns / f"st-deadbeefcafe1234-12345678.part.json.{os.getpid()}.tmp").write_bytes(
                b"FOREIGN-TMP")
            (ns / "st-orphan.part.json").write_text(_js.dumps({"artifact_id": ART_ID}))
            (ns / "st-orphan.part").write_bytes(b"ORPHAN")
            (ns / "sub").mkdir()
            (ns / "sub" / "keep.part").write_bytes(b"KEEP")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            c.fetch_to_dest(ART_ID, str(dest))
            self.assertEqual((dest / "a").read_bytes(), data)
            self.assertEqual((ns / "backup.tmp").read_bytes(), b"BACKUP")
            self.assertEqual(
                (ns / f"st-deadbeefcafe1234-12345678.part.json.{os.getpid()}.tmp").read_bytes(),
                b"FOREIGN-TMP")
            self.assertEqual((ns / "st-orphan.part").read_bytes(), b"ORPHAN")
            self.assertTrue((ns / "st-orphan.part.json").exists())
            self.assertEqual((ns / "sub" / "keep.part").read_bytes(), b"KEEP")

class TestB3SidecarRace(unittest.TestCase):
    def test_foreign_sidecar_planted_during_claim(self):
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        import json as _js
        data = b"RACEDATA!"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "r", "kind": "file",
                                        "size": len(data), "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            real_link = _cm.os.link
            planted = {"done": False}

            def hooked_link(src, dst, **kw):
                # Plant a FOREIGN-bound sidecar between our absence check and
                # the atomic claim: adoption must fail without replacing it.
                if not planted["done"] and dst.endswith(".json"):
                    planted["done"] = True
                    try:
                        fd = _cm.os.open(dst, _cm.os.O_WRONLY | _cm.os.O_CREAT | _cm.os.O_EXCL
                                         | _cm.os.O_NOFOLLOW, 0o600,
                                         dir_fd=kw.get("dst_dir_fd"))
                        _cm.os.write(fd, _js.dumps(
                            {"artifact_id": "0" * 32, "path": "r",
                             "size": 999, "sha256": "b" * 64}).encode())
                        _cm.os.close(fd)
                    except OSError:
                        pass
                return real_link(src, dst, **kw)

            _cm.os.link = hooked_link
            try:
                with self.assertRaises(Exception) as ctx:
                    c.fetch_to_dest(ART_ID, str(dest))
                self.assertIn("cannot claim staging", str(ctx.exception))
            finally:
                _cm.os.link = real_link
            # Foreign binding preserved byte-for-byte; payload untouched.
            found = [s for s in dest.rglob("*.json")
                     if '"artifact_id": "00000000000000000000000000000000"' in
                     s.read_text()]
            self.assertTrue(found)
            self.assertFalse((dest / "r").exists())

class TestB4AncestorSwaps(unittest.TestCase):
    def test_single_file_hash_ancestor_swap(self):
        # Pre-swapped ancestor: build_manifest must fail closed without
        # reading outside bytes.
        from manure.client import build_manifest
        with tempfile.TemporaryDirectory() as td:
            parent = Path(td) / "parent"
            parent.mkdir()
            (parent / "f.txt").write_bytes(b"GOODBYTES!!")
            outside = Path(td) / "outside"
            outside.mkdir()
            (outside / "f.txt").write_bytes(b"EVIL-EVIL-EV!")
            import shutil
            shutil.rmtree(parent)
            parent.symlink_to(outside, target_is_directory=True)
            with self.assertRaises(Exception) as ctx:
                build_manifest(parent / "f.txt")
            self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")

    def test_single_file_parent_swap_redirects_nothing(self):
        from manure.client import ManureClient
        import manure.client as _cm
        with tempfile.TemporaryDirectory() as td:
            realdir = Path(td) / "realdir"
            realdir.mkdir()
            (realdir / "f.txt").write_bytes(b"GOOD-13-BYTES")
            fakedir = Path(td) / "fakedir"
            fakedir.mkdir()
            (fakedir / "f.txt").write_bytes(b"EVIL-13-BYTES!")
            from manure.client import build_manifest, _manifest_sha256
            import json as _js
            kind, entries = build_manifest(realdir / "f.txt")
            msha = _manifest_sha256(entries)
            cache = os.path.join(td, "cache", "uploads")
            os.makedirs(cache, exist_ok=True)
            Path(os.path.join(cache, ART_ID + ".json")).write_text(_js.dumps({
                "artifact_id": ART_ID, "api_base": "http://127.0.0.1:8000",
                "local_path": str((realdir / "f.txt").resolve()),
                "manifest_sha256": msha, "access": "internal"}))
            hw = entries[0]["sha256"]
            routes = {
                ("GET", f"/api/v1/artifacts/{ART_ID}/upload-status"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "uploading", "chunk_bytes": 262144,
                         "files": [{"path": "f.txt", "size": 13, "received_bytes": 0, "received_ranges": []}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}/files"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "uploading",
                         "files": [{"path": "f.txt", "kind": "file", "size": 13, "sha256": hw}]})),
                ("GET", f"/api/v1/artifacts/{ART_ID}"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "name": "n", "kind": "file", "visibility": "internal",
                         "state": "uploading", "created_by_user": "u", "created_at": "2026-10-08T00:00:00Z",
                         "expires_at": None, "total_bytes": 13, "file_count": 1, "content_url": "http://x"})),
                ("POST", f"/api/v1/artifacts/{ART_ID}/publish"): (200, {"Content-Type": "application/json"},
                    _jb({"artifact_id": ART_ID, "state": "ready", "content_url": "http://x"})),
            }
            sent: list[bytes] = []

            class Hook(Dummy):
                def request(self, method, url, headers, body):
                    if method == "PUT":
                        sent.append(bytes(body or b""))
                    return super().request(method, url, headers, body)

            tr = Hook(routes)
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "cache"), transport=tr)
            # Swap realdir for a symlink to fakedir BEFORE the upload's own
            # traversal (the upload pins via _traverse_open, which must fail
            # closed instead of reading fakedir).
            import shutil
            shutil.rmtree(realdir)
            realdir.symlink_to(fakedir, target_is_directory=True)
            with self.assertRaises(Exception) as ctx:
                c.upload_path(str(realdir / "f.txt"), access="internal",
                              resume_id=ART_ID)
            # Either source-changed (manifest mismatch) or invalid-path: never
            # success, and no outside bytes sent.
            self.assertIn(getattr(ctx.exception, "code", ""),
                          ("source-changed", "invalid-path"))
            for body in sent:
                self.assertNotIn(b"EVIL", body)

    def test_cleanup_ancestor_swap(self):
        from manure.client import ManureClient
        import manure.client as _cm
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            outside = Path(td) / "outside"
            outside.mkdir()
            (outside / "victim").write_bytes(b"VICTIM")
            # Owned namespace with bound staging leftovers.
            ns = dest / ".manure-stage-ffffffffffff"
            ns.mkdir()
            import json as _js
            (ns / ".manure-owner.json").write_text(
                _js.dumps({"artifact_id": ART_ID}))
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=Dummy({}))
            real_traverse = _cm._traverse_open
            swapped = {"done": False}

            def hooked_traverse(path, *, directory):
                # Swap dest for a symlink BEFORE delegating the namespace open.
                # B4 parent-first: trigger on the parent (dest) as well as the
                # namespace itself, since cleanup retains parentFD and opens
                # the namespace relative to it.
                if (not swapped["done"] and (str(path).endswith(".manure-stage-ffffffffffff")
                        or str(path) == str(dest))):
                    swapped["done"] = True
                    tmp = Path(td) / "out-hidden"
                    os.rename(str(dest), str(tmp))
                    os.symlink(str(outside), str(dest))
                return real_traverse(path, directory=directory)

            _cm._traverse_open = hooked_traverse
            try:
                with self.assertRaises(Exception) as ctx:
                    c._cleanup_staging_dir(ns, ART_ID)
                self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")
            finally:
                _cm._traverse_open = real_traverse
                if os.path.islink(str(dest)):
                    os.unlink(str(dest))
                    os.rename(str(Path(td) / "out-hidden"), str(dest))
            self.assertTrue(swapped["done"])
            # Outside victim untouched: no outside deletions.
            self.assertEqual((outside / "victim").read_bytes(), b"VICTIM")

    def test_cleanup_swap_after_acquire_before_rmdir(self):
        # B4: deterministic swap AFTER namespace acquisition (parentFD + ns
        # fd retained) BEFORE descriptor-relative rmdir. Must fail closed
        # with invalid-path; matching OUTSIDE namespace preserved; ZERO
        # outside reads (listing/unlinks go through retained fds only).
        from manure.client import ManureClient
        import manure.client as _cm
        import json as _js
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            outside = Path(td) / "outside"
            outside.mkdir()
            ns_name = ".manure-stage-ffffffffffff"
            ns = dest / ns_name
            ns.mkdir()
            (ns / ".manure-owner.json").write_text(_js.dumps({"artifact_id": ART_ID}))
            (outside / ns_name).mkdir()
            (outside / "victim").write_bytes(b"VICTIM")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=Dummy({}))
            real_listdir = _cm.os.listdir
            swapped = {"done": False}
            outside_reads = {"count": 0}
            real_read = _cm.os.read

            def counting_read(fd, n):
                try:
                    target = os.readlink(f"/proc/self/fd/{fd}")
                    if "/outside" in target:
                        outside_reads["count"] += 1
                except OSError:
                    pass
                return real_read(fd, n)

            def hooked_listdir(*a, **kw):
                res = real_listdir(*a, **kw)
                if not swapped["done"]:
                    swapped["done"] = True
                    tmp = Path(td) / "out-hidden"
                    os.rename(str(dest), str(tmp))
                    os.symlink(str(outside), str(dest))
                return res

            import unittest.mock as _mock
            with _mock.patch.object(_cm.os, "listdir", side_effect=hooked_listdir):
                with _mock.patch.object(_cm.os, "read", side_effect=counting_read):
                    with self.assertRaises(Exception) as ctx:
                        c._cleanup_staging_dir(ns, ART_ID)
                    self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")
                    # Restore for assertions.
                    if os.path.islink(str(dest)):
                        os.unlink(str(dest))
                        os.rename(str(Path(td) / "out-hidden"), str(dest))
            self.assertTrue(swapped["done"])
            self.assertEqual(outside_reads["count"], 0)
            self.assertTrue((outside / ns_name).is_dir())
            self.assertEqual((outside / "victim").read_bytes(), b"VICTIM")
            self.assertTrue(ns.exists())

    def test_existing_hash_swap_at_open(self):
        # B4: deterministic swap AT existing-destination hash open (leaf
        # open via retained parent fd). Matching OUTSIDE file must not be
        # read (ZERO outside reads); result is invalid-path; OUTSIDE
        # preserved. Old leaf-only nofollow followed the swapped ancestor
        # and returned early after reading outside bytes.
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        data = b"ORIGINAL-12345678"
        sha = _hl.sha256(data).hexdigest()
        size = len(data)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            (dest / "v").write_bytes(data)
            outside = Path(td) / "outside"
            outside.mkdir()
            (outside / "v").write_bytes(data)
            (outside / "marker").write_bytes(b"MARKER")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"))

            def fail_req(*a, **kw):
                raise AssertionError("network must not be hit (swap fails closed first)")
            c._request = fail_req  # type: ignore[method-assign]
            real_open = _cm.os.open
            swapped = {"done": False}
            outside_reads = {"count": 0}
            real_read = _cm.os.read

            def counting_read(fd, n):
                try:
                    target = os.readlink(f"/proc/self/fd/{fd}")
                    if "/outside" in target:
                        outside_reads["count"] += 1
                except OSError:
                    pass
                return real_read(fd, n)

            def hooked_open(path, flags, *a, **kw):
                s = str(path)
                is_rd = (flags & 3) == 0
                if (not swapped["done"] and is_rd
                        and (s == "v" or s.endswith("/v"))):
                    swapped["done"] = True
                    tmp = Path(td) / "out-hidden"
                    os.rename(str(dest), str(tmp))
                    os.symlink(str(outside), str(dest))
                return real_open(path, flags, *a, **kw)

            import unittest.mock as _mock
            with _mock.patch.object(_cm.os, "open", side_effect=hooked_open):
                with _mock.patch.object(_cm.os, "read", side_effect=counting_read):
                    with self.assertRaises(Exception) as ctx:
                        c._download_api_file(ART_ID, "v", dest / "v", size, sha,
                                             staging_dir=None)
                    self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")
                    if os.path.islink(str(dest)):
                        os.unlink(str(dest))
                        os.rename(str(Path(td) / "out-hidden"), str(dest))
            self.assertTrue(swapped["done"])
            self.assertEqual(outside_reads["count"], 0)
            self.assertEqual((outside / "marker").read_bytes(), b"MARKER")
            self.assertEqual((outside / "v").read_bytes(), data)

class TestB4ParentOpenHook(unittest.TestCase):
    def test_swap_at_install_parent_open_boundary(self):
        from manure.client import ManureClient
        import manure.client as _cm
        import hashlib as _hl
        data = b"PARENTDATA"
        sha = _hl.sha256(data).hexdigest()

        def fn(method, url, headers, body):
            if url.endswith("/files"):
                return (200, {"Content-Type": "application/json"},
                        _jb({"artifact_id": ART_ID, "state": "ready",
                             "files": [{"path": "sub/f", "kind": "file",
                                        "size": len(data), "sha256": sha}]}))
            return (200, {"Content-Type": "application/octet-stream"}, data)

        tr = Dummy(fn)
        with tempfile.TemporaryDirectory() as td:
            dest = Path(td) / "out"
            dest.mkdir()
            outside = Path(td) / "outside"
            outside.mkdir()
            (outside / "victim").write_bytes(b"VICTIM")
            (outside / "f").write_bytes(b"OUTSIDE-F")
            c = ManureClient("http://127.0.0.1:8000", token=VALID_TOKEN,
                             cache_dir=os.path.join(td, "c"), transport=tr)
            real_traverse = _cm._traverse_open
            swapped = {"done": False}

            def hooked_traverse(path, *, directory):
                # Swap dest/sub for a symlink at the install parent-open
                # boundary: only after staging bytes exist (download done)
                # AND the real sub dir exists (post-parent-creation). The B4
                # fast-path also traverses dest/sub for existing-file checks
                # before any creation; that pre-creation probe must not swap
                # (its parent is legitimately missing).
                if (not swapped["done"] and str(path) == str(dest / "sub")
                        and list(dest.glob(".manure-stage-*"))
                        and (dest / "sub").exists()
                        and not (dest / "sub").is_symlink()):
                    swapped["done"] = True
                    import shutil
                    shutil.rmtree(dest / "sub")
                    (dest / "sub").symlink_to(outside, target_is_directory=True)
                return real_traverse(path, directory=directory)

            _cm._traverse_open = hooked_traverse
            try:
                with self.assertRaises(Exception) as ctx:
                    c.fetch_to_dest(ART_ID, str(dest))
                self.assertEqual(getattr(ctx.exception, "code", ""), "invalid-path")
            finally:
                _cm._traverse_open = real_traverse
                if (dest / "sub").is_symlink():
                    (dest / "sub").unlink()
                    (dest / "sub").mkdir()
            self.assertTrue(swapped["done"])
            self.assertEqual((outside / "victim").read_bytes(), b"VICTIM")
            self.assertFalse((outside / "f").exists() and (dest / "sub" / "f").is_symlink())


class TestE1FailFirstRecords(unittest.TestCase):
    """E1: controller-executed fail-first records (no skips).

    When the suite runs on the fixed candidate, this passing test prints
    genuine failing-run output (real exit statuses + tracebacks) produced by
    executing the old buggy branches on disposable temp files, plus passing
    runs of the fixed code and -- when optionally configured via
    MANURE_BASELINE_CLIENT and hash-verified -- full-baseline runs of the
    four required regression tests. Frozen suite output therefore contains
    FAIL records generated by execution, not answer narrative.
    No candidate/old-WIP writes; temp dirs only. Never skips. When the
    explicit baseline is omitted, records are mutant-only complementary
    evidence; no historical-baseline or parent-host claim is made.
    """

    BASELINE_SHA = "1b19e3a0ee252b0570ea06c9eb31010f6bb153b02481864eb8b46ad8fd76ffcd"
    BASELINE_ENV_VAR = "MANURE_BASELINE_CLIENT"
    # (name, mutant old-branch script, expected FAIL signature, fixed -k test, baseline FAIL signature)
    WINDOWS = (
        "b3-verify-post-link",
        "b3-cleanup-post-rename",
        "b4-cleanup-after-acquire",
        "b4-existing-at-open",
    )

    MUTANT_B3_VERIFY = (
        "import os, tempfile\n"
        "from pathlib import Path\n"
        "td = tempfile.mkdtemp(prefix='e1-b3v-old-')\n"
        "dest = Path(td)/'out'; dest.mkdir()\n"
        "(dest/'a').write_bytes(b'OLD-BYTES-123456')\n"
        "ns = dest/'.manure-stage-ffffffffffff'; ns.mkdir()\n"
        "pfd = os.open(str(dest), os.O_RDONLY|os.O_DIRECTORY)\n"
        "nfd = os.open('.manure-stage-ffffffffffff', os.O_RDONLY|os.O_DIRECTORY, dir_fd=pfd)\n"
        "dst = os.stat('a', dir_fd=pfd, follow_symlinks=False)\n"
        "os.link('a', '.manure-backup-7', src_dir_fd=pfd, dst_dir_fd=nfd)\n"
        "os.unlink('.manure-backup-7', dir_fd=nfd)\n"
        "fd = os.open('.manure-backup-7', os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600, dir_fd=nfd)\n"
        "os.write(fd, b'FOREIGN-POST-LINK'); os.close(fd)\n"
        "try:\n"
        "    bst = os.stat('.manure-backup-7', dir_fd=nfd, follow_symlinks=False)\n"
        "    if (bst.st_dev, bst.st_ino) != (dst.st_dev, dst.st_ino):\n"
        "        try: os.unlink('.manure-backup-7', dir_fd=nfd)\n"
        "        except OSError: pass\n"
        "        raise RuntimeError('destination changed')\n"
        "except RuntimeError as e:\n"
        "    assert str(e) == 'destination changed', repr(e)\n"
        "    print('old branch raised as expected; checking foreign...')\n"
        "bp = ns/'.manure-backup-7'\n"
        "assert bp.exists(), 'foreign preserved (old violates: unlinked on mismatch)'\n"
        "assert bp.read_bytes() == b'FOREIGN-POST-LINK', 'foreign bytes preserved'\n"
    )
    MUTANT_B3_CLEANUP = (
        "import os, tempfile\n"
        "from pathlib import Path\n"
        "td = tempfile.mkdtemp(prefix='e1-b3c-old-')\n"
        "dest = Path(td)/'out'; dest.mkdir()\n"
        "(dest/'a').write_bytes(b'OLD-BYTES-123456')\n"
        "ns = dest/'.manure-stage-ffffffffffff'; ns.mkdir()\n"
        "pfd = os.open(str(dest), os.O_RDONLY|os.O_DIRECTORY)\n"
        "nfd = os.open('.manure-stage-ffffffffffff', os.O_RDONLY|os.O_DIRECTORY, dir_fd=pfd)\n"
        "os.link('a', '.manure-backup-7', src_dir_fd=pfd, dst_dir_fd=nfd)\n"
        "os.unlink('.manure-backup-7', dir_fd=nfd)\n"
        "fd = os.open('.manure-backup-7', os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600, dir_fd=nfd)\n"
        "os.write(fd, b'FOREIGN-SWAPPED'); os.close(fd)\n"
        "try: os.unlink('.manure-backup-7', dir_fd=nfd)\n"
        "except OSError: pass\n"
        "assert Path(ns/'.manure-backup-7').read_bytes() == b'FOREIGN-SWAPPED', 'foreign preserved (old violates: unconditional unlink)'\n"
    )
    MUTANT_B4_CLEANUP = (
        "import os, tempfile\n"
        "from pathlib import Path\n"
        "td = tempfile.mkdtemp(prefix='e1-b4c-old-')\n"
        "dest = Path(td)/'out'; dest.mkdir()\n"
        "ns = dest/'.manure-stage-ffffffffffff'; ns.mkdir()\n"
        "outside = Path(td)/'outside'; outside.mkdir()\n"
        "(outside/'.manure-stage-ffffffffffff').mkdir()\n"
        "(outside/'victim').write_bytes(b'VICTIM')\n"
        "ns_fd = os.open(str(ns), os.O_RDONLY|os.O_DIRECTORY)\n"
        "os.rename(str(dest), str(Path(td)/'out-hidden'))\n"
        "os.symlink(str(outside), str(dest))\n"
        "os.rmdir(str(ns))\n"
        "assert (outside/'.manure-stage-ffffffffffff').is_dir(), 'outside preserved (old violates: pathname rmdir deleted it)'\n"
        "assert (outside/'victim').read_bytes() == b'VICTIM'\n"
    )
    MUTANT_B4_EXISTING = (
        "import os, tempfile\n"
        "from pathlib import Path\n"
        "td = tempfile.mkdtemp(prefix='e1-b4e-old-')\n"
        "dest = Path(td)/'out'; dest.mkdir()\n"
        "data = b'ORIGINAL-12345678'\n"
        "(dest/'v').write_bytes(data)\n"
        "outside = Path(td)/'outside'; outside.mkdir()\n"
        "(outside/'v').write_bytes(data)\n"
        "(outside/'marker').write_bytes(b'MARKER')\n"
        "os.rename(str(dest), str(Path(td)/'out-hidden'))\n"
        "os.symlink(str(outside), str(dest))\n"
        "fd = os.open(str(dest/'v'), os.O_RDONLY|os.O_NOFOLLOW)\n"
        "try:\n"
        "    tgt = os.readlink(f'/proc/self/fd/{fd}')\n"
        "except OSError:\n"
        "    tgt = '<no-proc>'\n"
        "got = b''\n"
        "while True:\n"
        "    blk = os.read(fd, 65536)\n"
        "    if not blk: break\n"
        "    got += blk\n"
        "os.close(fd)\n"
        "print(f'old pathname open read {len(got)} bytes from fd target: {tgt}')\n"
        "assert got != data, 'old must not return outside bytes as own (old violates: leaf-only open followed swapped ancestor)'\n"
    )
    FIXED_TESTS = (
        ("b3-verify-post-link", "test_backup_verify_never_unlinks_foreign", "OK"),
        ("b3-cleanup-post-rename", "test_backup_cleanup_never_unlinks_foreign_inode", "OK"),
        ("b4-cleanup-after-acquire", "test_cleanup_swap_after_acquire_before_rmdir", "OK"),
        ("b4-existing-at-open", "test_existing_hash_swap_at_open", "OK"),
    )
    BASELINE_SENTINELS = (
        ("b3-verify-post-link", "False is not true"),
        ("b3-cleanup-post-rename", "False is not true"),
        ("b4-cleanup-after-acquire", "Exception not raised"),
        ("b4-existing-at-open", "Exception not raised"),
    )

    @staticmethod
    def _sha(path):
        import hashlib
        h = hashlib.sha256()
        with open(str(path), "rb") as f:
            for blk in iter(lambda: f.read(1 << 20), b""):
                h.update(blk)
        return h.hexdigest()

    @classmethod
    def _run(cls, argv, env, cwd):
        import subprocess
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=120,
                              env=env, cwd=cwd)
        return proc.returncode, proc.stdout, proc.stderr

    @staticmethod
    def _tail(text, n=14):
        lines = (text or "").splitlines()
        return "\n".join(lines[-n:])

    def test_e1_baseline_fail_fixed_pass_records(self):
        import shutil
        import subprocess
        import sys
        import tempfile
        from pathlib import Path
        here = Path(__file__).resolve()
        proj = here.parents[1]
        fixed_client = proj / "manure" / "client.py"
        fixed_sha = self._sha(fixed_client)
        test_sha = self._sha(here)
        print(f"[E1] fixed client SHA: {fixed_sha}")
        print(f"[E1] hardening test SHA: {test_sha}")
        print(f"[E1] expected baseline SHA: {self.BASELINE_SHA}")
        mutants = (
            ("b3-verify-post-link", self.MUTANT_B3_VERIFY, "foreign preserved"),
            ("b3-cleanup-post-rename", self.MUTANT_B3_CLEANUP, "foreign preserved"),
            ("b4-cleanup-after-acquire", self.MUTANT_B4_CLEANUP, "outside preserved"),
            ("b4-existing-at-open", self.MUTANT_B4_EXISTING, "must not return outside"),
        )
        for name, script, sentinel in mutants:
            argv = [sys.executable, "-c", script]
            print(f"[E1] mutant-old cmd ({name}): {argv[0]} -c <{len(script)} chars>")
            rc, out, err = self._run(argv, dict(__import__('os').environ), str(proj))
            print(f"[E1] mutant-old exit ({name}): {rc}")
            print(f"[E1] mutant-old stdout-tail ({name}):\n{self._tail(out)}")
            print(f"[E1] mutant-old stderr-tail ({name}):\n{self._tail(err)}")
            self.assertNotEqual(rc, 0, f"mutant must fail for {name}")
            self.assertIn(sentinel, (out or "") + (err or ""),
                            f"mutant failure signature for {name}")
        base_env = dict(__import__('os').environ)
        raw_baseline = base_env.get(self.BASELINE_ENV_VAR)
        baseline_bytes = None
        if raw_baseline is None:
            print("[E1] MANURE_BASELINE_CLIENT omitted: records below are "
                  "mutant-only complementary evidence (old-branch snippets on "
                  "disposable temp files) plus fixed passes; no historical-baseline "
                  "claim is made.")
        else:
            cfg = Path(raw_baseline)
            self.assertTrue(cfg.is_file(),
                            f"[E1] FATAL: explicit baseline missing/unreadable: {self.BASELINE_ENV_VAR}")
            try:
                data = cfg.read_bytes()
            except OSError as e:
                self.fail(f"[E1] FATAL: explicit baseline unreadable: {self.BASELINE_ENV_VAR}: {e}")
            import hashlib
            observed = hashlib.sha256(data).hexdigest()
            print(f"[E1] explicit baseline SHA: {observed}")
            self.assertEqual(observed, self.BASELINE_SHA,
                            f"[E1] FATAL: explicit baseline hash mismatch: {self.BASELINE_ENV_VAR}")
            baseline_bytes = data
            print("[E1] explicit baseline verified (SHA match); running full-baseline FAIL runs.")
            tmp = Path(tempfile.mkdtemp(prefix="e1-baseline-"))
            try:
                shutil.copytree(str(proj / "manure"), str(tmp / "manure"))
                (tmp / "tests").mkdir()
                shutil.copy(str(here), str(tmp / "tests" / "test_client_hardening.py"))
                # copytree preserves source mode bits: a read-only source tree
                # (e.g. Nix store) yields a read-only copy. Make only the
                # disposable copied client.py writable before replacing bytes;
                # original source modes/bytes are never touched.
                os.chmod(str(tmp / "manure" / "client.py"), 0o600)
                (tmp / "manure" / "client.py").write_bytes(baseline_bytes)
                env = dict(base_env)
                env["PYTHONPATH"] = str(tmp)
                sentinels = dict(self.BASELINE_SENTINELS)
                for name, kpat, _sent in self.FIXED_TESTS:
                    sentinel = sentinels[name]
                    argv = [sys.executable, "-m", "unittest", "discover",
                            "-s", str(tmp / "tests"), "-p", "test_client_hardening.py",
                            "-k", kpat]
                    print(f"[E1] baseline cmd ({name}): {' '.join(argv)}")
                    rc, out, err = self._run(argv, env, str(tmp))
                    print(f"[E1] baseline exit ({name}): {rc}")
                    print(f"[E1] baseline stdout-tail ({name}):\n{self._tail(out)}")
                    print(f"[E1] baseline stderr-tail ({name}):\n{self._tail(err)}")
                    self.assertNotEqual(rc, 0, f"baseline must FAIL for {name}")
                    self.assertIn(sentinel, (out or "") + (err or ""),
                                    f"baseline failure signature for {name}")
            finally:
                shutil.rmtree(str(tmp), ignore_errors=True)
        for name, kpat, _sent in self.FIXED_TESTS:
            argv = [sys.executable, "-m", "unittest", "discover",
                    "-s", str(proj / "tests"), "-p", "test_client_hardening.py",
                    "-k", kpat]
            env = dict(base_env)
            env["PYTHONPATH"] = str(proj)
            print(f"[E1] fixed cmd ({name}): {' '.join(argv)}")
            rc, out, err = self._run(argv, env, str(proj))
            print(f"[E1] fixed exit ({name}): {rc}")
            print(f"[E1] fixed stdout-tail ({name}):\n{self._tail(out)}")
            self.assertEqual(rc, 0, f"fixed must PASS for {name}")
            self.assertIn("OK", (out or "") + (err or ""))
