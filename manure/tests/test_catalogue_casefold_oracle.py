"""Complementary historical supported-query oracle, NOT target/HTTP acceptance.

Exercises only an owned SQLite ArtifactStore and its real registered
str.casefold SQL function. No server.main/create_server, live files, credentials
or network. The replacement's independent Memory/PG and all-scalar JVM cases
remain mandatory; this case documents the normative source behavior directly.
"""

from __future__ import annotations

import sys
import tempfile
import unicodedata
import unittest

from manure.storage import ArtifactStore


class HistoricalCatalogueCasefoldOracleTests(unittest.TestCase):
    def test_owned_sqlite_uses_full_casefold_for_eleven_supported_queries(self):
        self.assertEqual(sys.version_info[:2], (3, 14), "use the pinned Python oracle")
        self.assertEqual(unicodedata.unidata_version, "16.0.0")
        names = (
            "Straße",
            "STRASSE",
            "straße",
            "Σ",
            "σ",
            "ς",
            "ΟΣ",
            "οσ",
            "ος",
            "ﬃ",
            "FFI",
            "İ\0X",
            "i\u0307\0x",
            "𐐀\0",
            "𐐨\0",
            "a%_'\\\0",
        )
        strasse = {"Straße", "STRASSE", "straße"}
        sigma = {"Σ", "σ", "ς", "ΟΣ", "οσ", "ος"}
        words = {"ΟΣ", "οσ", "ος"}
        checks = {
            "strasse": strasse,
            "straße": strasse,
            "σ": sigma,
            "ς": sigma,
            "οσ": words,
            "ος": words,
            "ﬃ": {"ﬃ", "FFI"},
            "FFI": {"ﬃ", "FFI"},
            "İ\0X": {"İ\0X", "i\u0307\0x"},
            "𐐨\0": {"𐐀\0", "𐐨\0"},
            "%_'\\\0": {"a%_'\\\0"},
        }
        with (
            tempfile.TemporaryDirectory(prefix="manure-casefold-oracle-") as root,
            ArtifactStore(root, max_sessions_per_user=100) as store,
        ):
            for name in names:
                store.init_artifact(
                    "owned-oracle", "owned-label", name, "dir", "internal", [], None
                )
            traced = []
            store._db.set_trace_callback(traced.append)
            for query, expected in checks.items():
                with self.subTest(query=query):
                    rows, cursor = store.list_artifacts(
                        100, "", True, q=query, sort_by="name", direction="asc"
                    )
                    self.assertEqual({r["name"] for r in rows}, expected)
                    self.assertIsNone(cursor)
            self.assertEqual(
                store._db.execute("SELECT casefold(?)", ("Straße ς ﬃ 𐐀\0",)).fetchone()[
                    0
                ],
                "strasse σ ffi 𐐨\0",
            )
            self.assertTrue(any("instr(casefold(name)," in sql for sql in traced))
            self.assertEqual(len(checks), 11)


if __name__ == "__main__":
    unittest.main()
