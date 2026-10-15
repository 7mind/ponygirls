"""Specified catalogue behavior against SQLite and local HTTP (no browser)."""

import base64
import hashlib
import json
import os
import tempfile
import unittest
import urllib.parse

from manure import domain as D
from manure.storage import ArtifactStore
from manure.server import create_server
from test_server_lifecycle import _Http, _make_config, _mint_user


SORT_FIELDS = (
    "name", "created_at", "expires_at", "total_bytes", "file_count",
    "visibility", "state", "kind", "created_by_user",
)


def _seed(store, clock):
    rows = []
    for i in range(12):
        clock[0] = 1800000000.25 + (i // 3) * 10
        kind = "file" if i % 2 else "dir"
        files = [{"path": "f", "kind": "file", "size": i // 3,
                  "sha256": hashlib.sha256(b"x").hexdigest()}]
        if kind == "dir" and i % 3:
            files.append({"path": "d", "kind": "dir"})
        aid = store.init_artifact(
            "u%d" % (i % 3), "t", ("zeta", "Alpha", "Straße%_", "Alpha")[i % 4],
            kind, ("internal", "public", "external")[i % 3], files,
            None if i % 3 == 0 else 60 + (i % 2) * 60)["id"]
        store._set_state_for_test(aid, ("uploading", "ready", "publishing")[i % 3])
        rows.append(store.get_artifact(aid))
    clock[0] = 1800000040.25
    return rows


class CatalogueStorageCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.clock = [1800000000.25]
        self.store = ArtifactStore(os.path.join(tmp.name, "data"),
                                   now=lambda: self.clock[0])
        self.addCleanup(self.store.close)
        self.rows = _seed(self.store, self.clock)

    def _page(self, cursor="", **kw):
        options = dict(limit=2, cursor=cursor, include_expired=True,
                       sort_by="created_at", direction="desc")
        options.update(kw)
        return self.store.list_artifacts(**options)

    def _traverse(self, **kw):
        got = []
        cursor = ""
        for _ in range(len(self.rows) + 1):
            page, nxt = self._page(cursor=cursor, **kw)
            self.assertLessEqual(len(page), kw.get("limit", 2))
            got.extend(r["id"] for r in page)
            if nxt is None:
                return got
            self.assertTrue(page)
            cursor = nxt
        self.fail("cursor traversal did not terminate")

    def test_all_sorts_directions_ties_and_null_expiry_across_pages(self):
        for field in SORT_FIELDS:
            for direction in ("asc", "desc"):
                with self.subTest(field=field, direction=direction):
                    key = {"created_at": "created_at_s",
                           "expires_at": "expires_at_s"}.get(field, field)
                    finite = [r for r in self.rows if r[key] is not None]
                    never = [r for r in self.rows if r[key] is None]
                    reverse = direction == "desc"
                    expected = sorted(finite, key=lambda r: (r[key], r["id"]),
                                      reverse=reverse)
                    expected += sorted(never, key=lambda r: r["id"], reverse=reverse)
                    got = self._traverse(sort_by=field, direction=direction)
                    self.assertEqual(got, [r["id"] for r in expected])
                    self.assertEqual(len(set(got)), len(self.rows))

    def test_unicode_literal_search_id_and_combined_filters(self):
        matching = [r["id"] for r in self.rows if r["name"] == "Straße%_"]
        self.assertCountEqual(self._traverse(q="STRASSE%_"), matching)
        self.assertCountEqual(self._traverse(q="%_"), matching)
        self.assertEqual(self._traverse(q="STRASSE__"), [])
        self.assertEqual(self._traverse(q="' OR 1=1 --"), [])
        row = self.rows[-1]
        self.assertEqual(self._traverse(q=row["id"].upper()), [row["id"]])
        self.clock[0] += 70
        expected = [r["id"] for r in self.rows
                    if r["visibility"] == "external" and r["state"] == "publishing"
                    and r["name"] == "Straße%_"
                    and (r["expires_at_s"] is None or r["expires_at_s"] > self.clock[0])]
        self.assertCountEqual(self._traverse(
            q="strasse", include_expired=False, visibility="external",
            state="publishing", sort_by="expires_at", direction="asc"), expected)

    def test_search_casefold_expansion_is_not_limited_to_name_length(self):
        aid = self.store.init_artifact("u", "t", "ß" * 256, "dir", "internal",
                                      [], None)["id"]
        self.assertEqual(self._traverse(q="S" * 512), [aid])
        self.assertEqual(self._traverse(q=" STRASSE"), [])

    def test_cursor_binds_every_effective_query_option(self):
        first, cursor = self._page(q="", limit=1)
        self.assertTrue(first)
        self.assertIsNotNone(cursor)
        for changes in (dict(q="alpha"), dict(limit=2), dict(include_expired=False),
                        dict(visibility="public"), dict(state="ready"),
                        dict(sort_by="name"), dict(direction="asc")):
            options = dict(limit=1)
            options.update(changes)
            with self.subTest(changes=changes):
                with self.assertRaises(D.DomainError) as ctx:
                    self._page(cursor, **options)
                self.assertEqual(ctx.exception.code, "bad-envelope")
        with self.assertRaises(D.DomainError):
            self.store.list_artifacts(1, cursor, True)
        _, legacy = self.store.list_artifacts(1, "", True)
        with self.assertRaises(D.DomainError):
            self._page(legacy, limit=1)

    def test_cursor_binds_effective_not_raw_search_or_default_options(self):
        _, cursor = self._page(limit=1, q="STRASSE")
        page, _ = self._page(cursor, limit=1, q="straße")
        self.assertEqual(len(page), 1)
        self.assertEqual(page[0]["name"], "Straße%_")
        _, cursor = self.store.list_artifacts(1, "", True, q="")
        page, _ = self._page(cursor, limit=1)
        self.assertEqual(len(page), 1)

    def test_cursor_saves_boundary_value_across_mutation_and_deletion(self):
        for action in ("move", "delete"):
            with self.subTest(action=action):
                before, cursor = self._page(sort_by="name", direction="asc", limit=1)
                boundary = before[-1]
                expected = [r["id"] for r in sorted(
                    self.rows, key=lambda r: (r["name"], r["id"]))
                    if (r["name"], r["id"]) > (boundary["name"], boundary["id"])]
                if action == "move":
                    self.store._db.execute("UPDATE artifacts SET name=? WHERE id=?",
                                           ("!moved-before-boundary", boundary["id"]))
                else:
                    self.store.delete_artifact(boundary["id"])
                got = []
                while cursor is not None:
                    page, cursor = self._page(cursor, sort_by="name", direction="asc", limit=1)
                    got.extend(r["id"] for r in page)
                self.assertEqual(got, expected)
                if action == "move":
                    self.store._db.execute("UPDATE artifacts SET name=? WHERE id=?",
                                           (boundary["name"], boundary["id"]))

    def test_invalid_query_and_typed_cursors_are_domain_errors(self):
        for invalid in (dict(sort_by="name; DROP TABLE artifacts"), dict(sort_by=""),
                        dict(direction="DESC"), dict(direction=""), dict(q=12),
                        dict(q="\ud800")):
            with self.subTest(invalid=repr(invalid)):
                with self.assertRaises(D.DomainError) as ctx:
                    self._page(**invalid)
                self.assertEqual(ctx.exception.code, "bad-envelope")
        _, cursor = self._page()
        obj = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
        bad_values = [None, True, [], {}, "not-a-number", float("nan"), float("inf")]
        bad_cursors = ["!!!", "é", "e30", cursor + "!", D.encode_cursor("bad", "bad")]
        for value in bad_values:
            altered = dict(obj, value=value)
            bad_cursors.append(base64.urlsafe_b64encode(json.dumps(altered).encode()).decode())
        for field, value in (("v", True), ("id", "not-id"), ("query", [])):
            bad_cursors.append(base64.urlsafe_b64encode(
                json.dumps(dict(obj, **{field: value})).encode()).decode())
        for invalid in bad_cursors:
            with self.subTest(cursor=invalid), self.assertRaises(D.DomainError) as ctx:
                self._page(invalid)
            self.assertEqual(ctx.exception.code, "bad-envelope")

    def test_cursor_rejects_wrong_sort_value_types_before_sql(self):
        for field in SORT_FIELDS:
            _, cursor = self._page(sort_by=field)
            obj = json.loads(base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)))
            values = [[], {}, True, 2**100, "\ud800"]
            if field != "expires_at":
                values.append(None)
            if field not in ("created_at", "expires_at", "total_bytes", "file_count"):
                values.append(1)
            else:
                values.extend(["1", float("nan"), float("inf")])
            for value in values:
                malformed = base64.urlsafe_b64encode(
                    json.dumps(dict(obj, value=value)).encode()).decode()
                with self.subTest(field=field, value=repr(value)):
                    with self.assertRaises(D.DomainError) as ctx:
                        self._page(malformed, sort_by=field)
                    self.assertEqual(ctx.exception.code, "bad-envelope")

    def test_sql_filters_and_sort_are_bounded_not_fetch_all_or_offset(self):
        seen = []
        real_db = self.store._db
        class Spy:
            def execute(self, sql, params=()):
                if "FROM artifacts" in sql:
                    seen.append((sql, params))
                return real_db.execute(sql, params)
            def __getattr__(self, name):
                return getattr(real_db, name)
        self.store._db = Spy()
        try:
            self._page(q="Straße%_", visibility="external", state="publishing",
                       include_expired=False, sort_by="total_bytes", direction="desc")
        finally:
            self.store._db = real_db
        self.assertEqual(len(seen), 1)
        sql, params = seen[0]
        self.assertIn("instr(", sql.lower())
        self.assertIn("ORDER BY", sql)
        self.assertIn("total_bytes DESC", sql)
        self.assertIn("LIMIT ?", sql)
        self.assertNotIn("OFFSET", sql.upper())
        self.assertNotIn("Straße%_", sql)
        self.assertEqual(params[-1], 3)


class CatalogueHttpCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        users, self.token = _mint_user(tmp.name)
        clock = [1800000000.25]
        self.server = create_server(_make_config(tmp.name, users), _now=lambda: clock[0])
        self.addCleanup(self.server.close)
        self.http = _Http(self.server.bound_port, self.server.effective_api_origin)
        self.rows = _seed(self.server._state.store, clock)

    def _get(self, query):
        return self.http.api("GET", "/api/v1/artifacts?" + query, self.token, origin=None)

    def test_http_search_sort_and_legacy_defaults(self):
        st, _, raw = self._get("q=STRASSE%25_&sort_by=name&direction=asc&limit=200")
        self.assertEqual(st, 200, raw)
        self.assertEqual([a["name"] for a in json.loads(raw)["artifacts"]], ["Straße%_"] * 3)
        for query, reverse in (("limit=200", False), ("q=&limit=200", True),
                               ("sort_by=created_at&limit=200", True),
                               ("direction=desc&limit=200", True)):
            st, _, raw = self._get(query)
            self.assertEqual(st, 200, raw)
            expected = sorted(self.rows, key=lambda r: (r["created_at_s"], r["id"]),
                              reverse=reverse)
            self.assertEqual([a["artifact_id"] for a in json.loads(raw)["artifacts"]],
                             [r["id"] for r in expected])

    def test_http_cursor_uses_clamped_limit(self):
        self.server._state.config = self.server._state.config.__class__(
            **{**self.server._state.config.__dict__, "max_list_limit": 2})
        st, _, raw = self._get("sort_by=name&direction=asc&limit=99999")
        self.assertEqual(st, 200, raw)
        cursor = json.loads(raw)["next_cursor"]
        self.assertIsNotNone(cursor)
        st, _, raw = self._get(urllib.parse.urlencode(dict(
            sort_by="name", direction="asc", limit=2, cursor=cursor)))
        self.assertEqual(st, 200, raw)
        self.assertEqual(len(json.loads(raw)["artifacts"]), 2)

    def test_http_bad_query_and_cursor_are_domain_errors(self):
        for query in ("sort_by=bad", "direction=up", "sort_by=", "direction=",
                      "q=%C3%28", "q=%ED%A0%80", "q=a&q=b", "sort_by=name&sort_by=state",
                      "direction=asc&direction=desc", "q=x&limit=1&limit=2",
                      "sort_by=name&cursor=%C3%A9", "q=&cursor=!!!"):
            with self.subTest(query=query):
                st, _, raw = self._get(query)
                self.assertEqual(st, 400, raw)
                self.assertEqual(json.loads(raw)["error"]["code"], "bad-envelope")
        st, _, raw = self._get("sort_by=name&direction=asc&limit=1")
        self.assertEqual(st, 200, raw)
        cursor = json.loads(raw)["next_cursor"]
        st, _, raw = self._get(urllib.parse.urlencode(dict(
            sort_by="name", direction="asc", limit=2, cursor=cursor)))
        self.assertEqual(st, 400, raw)
        self.assertEqual(json.loads(raw)["error"]["code"], "bad-envelope")


if __name__ == "__main__":
    unittest.main()
