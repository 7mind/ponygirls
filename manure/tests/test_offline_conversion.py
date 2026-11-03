"""Specified-origin offline conversion contracts.

Pure representation vectors are BA. SQLite/FS and owned PostgreSQL contracts
are Effectual–GoodCommunication: these deliberately exercise durability and
SQL atomicity, not a simulated second database. No live services are used.
The full run requires pinned PG binaries; missing prerequisites fail, not skip.
"""

import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from pathlib import Path

# Tests can be discovered from root with PYTHONPATH=<repo>/manure.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from manure.storage import ArtifactStore, StorageError
from migration import offline as M

CHUNK = 262144
NOW = math.nextafter(1700000000.0, math.inf)
OWNER = "owner\0雪💩"
PATH = "雪/é.bin"
PAYLOAD = b"A" * CHUNK + b"tail!"
SHA = hashlib.sha256(PAYLOAD).hexdigest()


def build_fixture(root, crash=False):
    root = Path(root)
    source = root / "source"
    store = ArtifactStore(str(source), now=lambda: NOW, chunk_bytes=CHUNK)
    ids = {}

    def init(label, visibility="internal", ttl=None, complete=True):
        item = store.init_artifact(
            OWNER,
            "token\0λ",
            label + "\0🌿",
            "dir",
            visibility,
            [
                {"path": "empty", "kind": "dir"},
                {"path": PATH, "kind": "file", "size": len(PAYLOAD), "sha256": SHA},
            ],
            ttl,
        )
        aid = ids[label] = item["id"]
        store.put_chunk(
            OWNER,
            aid,
            PATH,
            0,
            PAYLOAD[:CHUNK],
            hashlib.sha256(PAYLOAD[:CHUNK]).hexdigest(),
        )
        if complete:
            store.put_chunk(
                OWNER,
                aid,
                PATH,
                CHUNK,
                PAYLOAD[CHUNK:],
                hashlib.sha256(PAYLOAD[CHUNK:]).hexdigest(),
            )
        return item

    init("uploading", complete=False)
    init("pre_rename")
    store._set_state_for_test(ids["pre_rename"], "publishing")
    init("post_rename")
    store._failpoints = {"after_rename"}
    try:
        store.publish(OWNER, ids["post_rename"])
    except StorageError:
        pass
    init("missing", complete=False)
    store._set_state_for_test(ids["missing"], "publishing")
    shutil.rmtree(source / "staging" / ids["missing"] / "tree")
    ext = init("external", "external")
    store.publish(OWNER, ext["id"])
    external_cookie, _ = store.unlock_with_password(ext["id"], ext["external_password"])
    init("internal")
    store.publish(OWNER, ids["internal"])
    used = store.create_one_time_grant(
        ids["internal"], "principal\0雪", OWNER, "token\0λ", "d" * 64
    )
    internal_cookie, _ = store.redeem_handoff(
        ids["internal"], used, lambda u, t, d: True
    )
    unused = store.create_one_time_grant(
        ids["internal"], "principal\0雪", OWNER, "token\0λ", "d" * 64
    )
    init("expired", "public", 60)
    store.publish(OWNER, ids["expired"])
    # P5 committed, P6 lost remnants. They must survive conversion untouched.
    (source / "staging" / (ids["internal"] + ".json")).write_text('{"remnant":true}')
    config = {
        "api_origin": "https://api.example:8443",
        "content_mode": "path",
        "content_suffix": "content.example",
        "chunk_bytes": CHUNK,
        "allowed_api_origins": ["http://overlay.example:8080"],
        "users": [
            {
                "id": OWNER,
                "tokens": [
                    {"id": "token\0λ", "hashFile": "/protected/operator.digest"}
                ],
            }
        ],
    }
    (root / "config.json").write_bytes(M.canonical(config))
    secrets = {
        "password": ext["external_password"],
        "external_cookie": external_cookie,
        "internal_cookie": internal_cookie,
        "unused": unused,
        "ids": ids,
    }
    (root / "fixture.json").write_bytes(M.canonical(secrets))
    if crash:
        os._exit(0)  # real process death retains committed WAL, releases root claim
    store.close()
    return source, root / "config.json", secrets


class SnapshotContracts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="manure-snapshot-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source, self.config, self.fixture = build_fixture(self.root)
        self.bundle = self.root / "bundle"

    def snapshot(self, **kwargs):
        return M.snapshot(
            self.source, self.bundle, self.config, quiesced=True, **kwargs
        )

    def test_exact_snapshot_and_no_source_mutations(self):
        before = M.inventory(self.source)
        identity, manifest = self.snapshot()
        self.assertEqual(M.inventory(self.source), before)
        self.assertEqual(M.verify_bundle(self.bundle, identity), (identity, manifest))
        self.assertEqual(
            manifest["audit"]["states"], {"uploading": 1, "publishing": 3, "ready": 3}
        )
        self.assertEqual(manifest["audit"]["reserved_bytes"], 7 * len(PAYLOAD))
        self.assertEqual(
            manifest["audit"]["counts"],
            {"artifacts": 7, "receipts": 6, "one_time_grants": 2, "content_grants": 2},
        )
        item = M.records(manifest, "artifacts")[0]
        self.assertEqual(item["created_by_user"], OWNER)
        self.assertEqual(
            struct.pack(">d", item["last_activity_at"]), struct.pack(">d", NOW)
        )
        self.assertEqual(
            manifest["audit"]["credential_refs"][0]["hashFile"],
            "/protected/operator.digest",
        )
        aid = self.fixture["ids"]["external"]
        self.assertEqual(
            manifest["audit"]["urls"][aid],
            [
                f"https://api.example:8443/view/{aid}",
                f"http://overlay.example:8080/view/{aid}",
            ],
        )
        self.assertTrue(
            any(
                r["verified_locations"] == ["live"]
                for r in manifest["audit"]["receipt_coverage"]
            )
        )
        self.assertTrue(
            any(
                not r["verified_locations"]
                for r in manifest["audit"]["receipt_coverage"]
            )
        )

    def test_requires_quiescence_and_exclusive_source(self):
        with self.assertRaises(M.Refused):
            M.snapshot(self.source, self.bundle, self.config)
        with ArtifactStore(str(self.source)), self.assertRaises(M.Refused):
            self.snapshot()
        self.assertFalse(self.bundle.exists())

    def test_interruption_restart_and_source_binding(self):
        def stop(stage):
            raise RuntimeError(stage)

        with self.assertRaises(RuntimeError):
            self.snapshot(failpoint=stop)
        with self.assertRaises(M.Refused):
            M.verify_bundle(self.bundle)
        changed = self.root / "changed-config.json"
        changed.write_text("{}")
        with self.assertRaises(M.Refused):
            M.snapshot(self.source, self.bundle, changed, quiesced=True)
        identity, _ = self.snapshot()
        self.assertEqual(self.snapshot()[0], identity)
        with self.assertRaises(M.Refused):
            M.verify_bundle(self.bundle, "0" * 64)

    def test_partial_restart_refuses_changed_source(self):
        def stop(stage):
            raise RuntimeError(stage)

        with self.assertRaises(RuntimeError):
            self.snapshot(failpoint=stop)
        (self.source / "live" / self.fixture["ids"]["external"] / PATH).write_bytes(
            b"changed"
        )
        with self.assertRaises(M.Refused):
            self.snapshot()

    def test_corrupt_payload_metadata_and_completion_fail_closed(self):
        self.snapshot()
        file = self.bundle / "raw" / "live" / self.fixture["ids"]["external"] / PATH
        original = file.read_bytes()
        file.write_bytes(b"corrupt")
        with self.assertRaises(M.Refused):
            M.verify_bundle(self.bundle)
        file.write_bytes(original)
        complete = (self.bundle / "COMPLETE").read_bytes()
        (self.bundle / "COMPLETE").write_text("0" * 64 + "\n")
        with self.assertRaises(M.Refused):
            M.verify_bundle(self.bundle)
        (self.bundle / "COMPLETE").write_bytes(complete)
        m = json.loads((self.bundle / "manifest.json").read_bytes())
        m["tables"]["artifacts"][0]["values"][1] = ["T", "00"]
        (self.bundle / "manifest.json").write_bytes(M.canonical(m))
        (self.bundle / "COMPLETE").write_text(M.digest(M.canonical(m)) + "\n")
        with self.assertRaises(M.Refused):
            M.verify_bundle(self.bundle)

    def test_links_and_special_files_refused(self):
        (self.source / "live" / "link").symlink_to(self.config)
        with self.assertRaises(M.Refused):
            self.snapshot()
        (self.source / "live" / "link").unlink()
        os.mkfifo(self.source / "live" / "pipe")
        with self.assertRaises(M.Refused):
            self.snapshot()

    def test_wal_including_uncheckpointed_rows_is_archived_without_opening_source(self):
        other = self.root / "crashed"
        other.mkdir()
        code = (
            "from test_offline_conversion import build_fixture; build_fixture("
            + repr(str(other))
            + ",True)"
        )
        env = dict(
            os.environ,
            PYTHONPATH=os.pathsep.join(
                [str(Path(__file__).parent), str(Path(__file__).parents[1])]
            ),
        )
        subprocess.run([sys.executable, "-c", code], env=env, check=True)
        self.assertGreater((other / "source" / "manure.db-wal").stat().st_size, 0)
        before = M.inventory(other / "source")
        _, manifest = M.snapshot(
            other / "source", other / "bundle", other / "config.json", quiesced=True
        )
        self.assertEqual(manifest["audit"]["counts"]["artifacts"], 7)
        self.assertEqual(before, M.inventory(other / "source"))
        self.assertEqual(before, M.inventory(other / "bundle" / "raw"))

    def test_ieee_vectors_and_subdomain_urls(self):
        for raw in (
            "8000000000000000",
            "0000000000000001",
            "3ff0000000000001",
            "7fefffffffffffff",
            "fff0000000000000",
        ):
            cell = ["R", raw]
            self.assertEqual(struct.pack(">d", M.decode(cell)).hex(), raw)
            self.assertIn(raw, M.sql_cell(cell, "R"))
        with self.assertRaises(M.Refused):
            M.sql_cell(["I", "3"], "T")
        self.assertEqual(
            M.url_for(
                {"content_suffix": "content.example"},
                "a" * 32,
                "https://api.example:8443",
            ),
            "https://" + "a" * 32 + ".content.example:8443",
        )


class PostgresContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # No ambient DB URLs or shared services. Always boot our own cluster.
        binary = os.environ.get("MANURE_TEST_PG_BIN")
        cls.bin = (
            Path(binary)
            if binary
            else Path(shutil.which("initdb") or "/missing").parent
        )
        for name in ("initdb", "pg_ctl", "psql"):
            if not (cls.bin / name).is_file():
                raise RuntimeError(
                    "required owned PostgreSQL rehearsal binaries missing: MANURE_TEST_PG_BIN"
                )
        cls.cluster_tmp = tempfile.TemporaryDirectory(prefix="manure-pg-")
        cls.cluster = Path(cls.cluster_tmp.name)
        cls.addClassCleanup(cls.cluster_tmp.cleanup)
        cls.socket = cls.cluster / "socket"
        cls.socket.mkdir(mode=0o700)
        subprocess.run(
            [
                str(cls.bin / "initdb"),
                "-D",
                str(cls.cluster / "db"),
                "-A",
                "trust",
                "--no-locale",
                "--encoding=UTF8",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        subprocess.run(
            [
                str(cls.bin / "pg_ctl"),
                "-D",
                str(cls.cluster / "db"),
                "-l",
                str(cls.cluster / "log"),
                "-o",
                f"-k {cls.socket} -c listen_addresses='' -c fsync=on",
                "-w",
                "start",
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        cls.addClassCleanup(
            lambda: subprocess.run(
                [
                    str(cls.bin / "pg_ctl"),
                    "-D",
                    str(cls.cluster / "db"),
                    "-m",
                    "immediate",
                    "-w",
                    "stop",
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        )
        cls.old_servicefile = os.environ.get("PGSERVICEFILE")
        os.environ["PGSERVICEFILE"] = str(cls.cluster / "services.conf")

        def reset_env():
            if cls.old_servicefile is None:
                os.environ.pop("PGSERVICEFILE", None)
            else:
                os.environ["PGSERVICEFILE"] = cls.old_servicefile

        cls.addClassCleanup(reset_env)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="manure-import-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source, self.config, self.fixture = build_fixture(self.root)
        self.bundle, self.destination = self.root / "bundle", self.root / "destination"
        self.identity, self.manifest = M.snapshot(
            self.source, self.bundle, self.config, quiesced=True
        )
        name = "rehearsal_" + uuid.uuid4().hex
        admin = [
            str(self.bin / "psql"),
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-h",
            str(self.socket),
            "-d",
            "postgres",
        ]
        subprocess.run(
            admin + ["-c", f'CREATE DATABASE "{name}";'],
            check=True,
            stdout=subprocess.DEVNULL,
        )
        (self.cluster / "services.conf").write_text(
            f"[rehearsal]\nhost={self.socket}\ndbname={name}\n"
        )
        self.pg = M.Psql("rehearsal", str(self.bin / "psql"))
        self.addCleanup(
            lambda: subprocess.run(
                admin + ["-c", f'DROP DATABASE "{name}" WITH (FORCE);'],
                check=True,
                stdout=subprocess.DEVNULL,
            )
        )
        self.owner = M.prepare_destination(self.destination, self.pg, disposable=True)

    def import_data(self, **kw):
        return M.import_bundle(
            self.bundle, self.destination, self.pg, self.identity, **kw
        )

    def test_lossless_pg_roundtrip_then_executable_source_state_rehearsal(self):
        before = M.inventory(self.source)
        self.import_data()
        self.assertEqual(
            M.verify_destination(self.bundle, self.destination, self.pg, self.identity)[
                0
            ],
            self.identity,
        )
        # Decode REAL/TEXT bytea from the REAL PG adapter back to disposable
        # SQLite ONLY as a roundtrip/recovery oracle, not a production rollback.
        restored = self.root / "oracle"
        M.copy_tree(self.destination / "data", restored)
        store = ArtifactStore(str(restored), now=lambda: NOW, chunk_bytes=CHUNK)
        self.addCleanup(store.close)
        encoded = M.pg_tables(self.pg)
        for table, columns in M.TABLES.items():
            sql = (
                f'INSERT INTO "{table}" ('
                + ",".join(M.qname(n) for n, _ in columns)
                + ") VALUES ("
                + ",".join("?" for _ in columns)
                + ")"
            )
            for row in encoded[table]:
                values = [
                    None if v is None else M.decode([t, v])
                    for v, (_, t) in zip(row, columns)
                ]
                store._db.execute(sql, values)
        # Raw values before reconciliation are exactly the original source.
        for table in M.TABLES:
            self.assertEqual(
                sorted(M.records(self.manifest, table), key=M.canonical),
                sorted(
                    [dict(r) for r in store._db.execute(f'SELECT * FROM "{table}"')],
                    key=M.canonical,
                ),
            )
        store.reconcile()
        ids = self.fixture["ids"]
        self.assertEqual(store.get_artifact(ids["pre_rename"])["state"], "ready")
        self.assertEqual(store.get_artifact(ids["post_rename"])["state"], "ready")
        self.assertEqual(store.get_artifact(ids["missing"])["state"], "uploading")
        self.assertFalse((restored / "staging" / (ids["internal"] + ".json")).exists())
        for label in ("uploading", "missing"):
            aid = ids[label]
            for off in (0, CHUNK):
                chunk = PAYLOAD[off : off + CHUNK]
                store.put_chunk(
                    OWNER, aid, PATH, off, chunk, hashlib.sha256(chunk).hexdigest()
                )
            self.assertEqual(store.publish(OWNER, aid)["state"], "ready")
            self.assertEqual((restored / "live" / aid / PATH).read_bytes(), PAYLOAD)
        self.assertIsNotNone(
            store.lookup_content_grant(self.fixture["external_cookie"], ids["external"])
        )
        self.assertIsNotNone(
            store.lookup_content_grant(self.fixture["internal_cookie"], ids["internal"])
        )
        self.assertIsNotNone(
            store.unlock_with_password(ids["external"], self.fixture["password"])
        )
        store.redeem_handoff(
            ids["internal"], self.fixture["unused"], lambda u, t, d: True
        )
        with self.assertRaises(KeyError):
            store.redeem_handoff(
                ids["internal"], self.fixture["unused"], lambda u, t, d: True
            )
        store._now = lambda: NOW + 61
        self.assertTrue(store.is_expired(store.get_artifact(ids["expired"]), NOW + 61))
        store.sweep()
        self.assertIsNone(store.get_artifact(ids["expired"]))
        self.assertTrue(store.delete_artifact(ids["external"]))
        self.assertIsNone(
            store.lookup_content_grant(self.fixture["external_cookie"], ids["external"])
        )
        self.assertEqual(M.inventory(self.source), before)
        self.assertEqual(M.verify_bundle(self.bundle)[0], self.identity)

    def test_interruption_before_and_after_atomic_metadata_completion(self):
        for stage in ("files_durable", "metadata_committed"):

            def stop(actual, expected=stage):
                if actual == expected:
                    raise RuntimeError(actual)

            with self.assertRaises(RuntimeError):
                self.import_data(failpoint=stop)
            self.assertFalse((self.destination / "COMPLETE").exists())
            count = int(self.pg.run("SELECT count(*) FROM manure.artifacts;"))
            self.assertEqual(count, 0 if stage == "files_durable" else 7)
        self.import_data()
        self.import_data()
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.receipts;"), "6")

    def test_process_death_after_commit_retries_without_duplicate_rows(self):
        code = (
            "import os; from migration import offline as M; "
            "M.import_bundle("
            + repr(str(self.bundle))
            + ","
            + repr(str(self.destination))
            + ","
            "M.Psql('rehearsal',"
            + repr(str(self.bin / "psql"))
            + "),"
            + repr(self.identity)
            + ","
            "failpoint=lambda stage: os._exit(77) if stage=='metadata_committed' else None)"
        )
        child = subprocess.run(
            [sys.executable, "-c", code], check=False, capture_output=True
        )
        self.assertEqual(child.returncode, 77, child.stderr.decode())
        self.assertFalse((self.destination / "COMPLETE").exists())
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "7")
        self.import_data()
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "7")

    def test_killed_sql_connection_rolls_back_import_transaction(self):
        self.pg.run(
            "CREATE FUNCTION manure.pause_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN PERFORM pg_sleep(60); RETURN NEW; END $$; CREATE TRIGGER pause_receipt "
            "BEFORE INSERT ON manure.receipts FOR EACH ROW EXECUTE FUNCTION manure.pause_receipt();"
        )
        code = (
            "from migration import offline as M; M.import_bundle("
            + repr(str(self.bundle))
            + ","
            + repr(str(self.destination))
            + ",M.Psql('rehearsal',"
            + repr(str(self.bin / "psql"))
            + "),"
            + repr(self.identity)
            + ")"
        )
        child = subprocess.Popen(
            [sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        self.addCleanup(lambda: child.kill() if child.poll() is None else None)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            pid = self.pg.run(
                "SELECT pid FROM pg_stat_activity WHERE datname=current_database() "
                "AND pid<>pg_backend_pid() AND query LIKE 'INSERT INTO manure.\"receipts\"%' "
                "AND wait_event='PgSleep';"
            )
            if pid:
                self.pg.run("SELECT pg_terminate_backend(" + str(int(pid)) + ");")
                break
            self.assertIsNone(child.poll(), "child exited before real SQL interruption")
            time.sleep(0.02)
        else:
            self.fail("real SQL import did not reach interrupted transaction boundary")
        _, stderr = child.communicate(timeout=10)
        self.assertNotEqual(child.returncode, 0, stderr.decode())
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "0")
        self.assertEqual(
            self.pg.run(
                "SELECT coalesce(source,'unset') FROM manure_offline.destination;"
            ),
            "unset",
        )
        self.pg.run("DROP TRIGGER pause_receipt ON manure.receipts;")
        self.import_data()

    def test_bad_destination_payload_never_writes_metadata(self):
        def stop(stage):
            if stage == "files_durable":
                raise RuntimeError(stage)

        with self.assertRaises(RuntimeError):
            self.import_data(failpoint=stop)
        path = (
            self.destination / "data" / "live" / self.fixture["ids"]["external"] / PATH
        )
        path.write_bytes(b"corrupt")
        with self.assertRaises(M.Refused):
            self.import_data()
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "0")
        self.assertEqual(M.verify_bundle(self.bundle)[0], self.identity)

    def test_sql_failure_rolls_back_all_rows_and_marker_then_retry_succeeds(self):
        self.pg.run(
            "CREATE FUNCTION manure.reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ "
            "BEGIN RAISE EXCEPTION 'rehearsal'; END $$; CREATE TRIGGER reject_receipt "
            "BEFORE INSERT ON manure.receipts FOR EACH ROW EXECUTE FUNCTION manure.reject_receipt();"
        )
        with self.assertRaises(M.Refused):
            self.import_data()
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "0")
        self.assertEqual(
            self.pg.run(
                "SELECT coalesce(source,'unset') FROM manure_offline.destination;"
            ),
            "unset",
        )
        self.pg.run("DROP TRIGGER reject_receipt ON manure.receipts;")
        self.import_data()

    def test_source_destination_corruption_and_projection_binding(self):
        with self.assertRaises(M.Refused):
            M.import_bundle(self.bundle, self.destination, self.pg, "0" * 64)
        self.import_data()
        self.pg.run("UPDATE manure.artifacts SET last_activity_at_value=0;")
        with self.assertRaises(M.Refused):
            M.verify_destination(self.bundle, self.destination, self.pg, self.identity)
        self.assertEqual(M.verify_bundle(self.bundle)[0], self.identity)

    def test_writable_boundary_is_fix_forward_and_old_snapshot_untouched(self):
        self.import_data()
        self.assertIn("pre-writes", M.rollback_policy(self.destination, self.pg))
        M.mark_writable(self.destination, self.pg, self.identity)
        self.assertIn("fix-forward", M.rollback_policy(self.destination, self.pg))
        self.pg.run("UPDATE manure.artifacts SET name=decode('6e65772d61636b','hex');")
        for operation in (
            self.import_data,
            lambda: M.verify_destination(
                self.bundle, self.destination, self.pg, self.identity
            ),
        ):
            with self.assertRaises(M.Refused):
                operation()
        self.assertEqual(M.verify_bundle(self.bundle)[0], self.identity)
        self.assertEqual(
            self.pg.run(
                "SELECT count(*) FROM manure.artifacts WHERE name=decode('6e65772d61636b','hex');"
            ),
            "7",
        )

    def assert_boundary_refusal_preserves_state(self):
        """Regression: an adoption failure must never mutate PG or repair bytes."""
        saved_records = {
            name: (self.destination / name).read_bytes()
            for name in ("COPY.json", "PAYLOAD.json", "COMPLETE")
            if (self.destination / name).exists()
        }
        rows = M.pg_tables(self.pg)
        current = M.inventory(self.destination / "data")
        source = M.inventory(self.source)
        for operation in (
            lambda: M.mark_writable(self.destination, self.pg, self.identity),
            self.import_data,
            lambda: M.verify_destination(
                self.bundle, self.destination, self.pg, self.identity
            ),
        ):
            with self.assertRaises(M.Refused):
                operation()
            self.assertEqual(
                self.pg.run("SELECT writes_started FROM manure_offline.destination;"),
                "f",
            )
            self.assertEqual(M.pg_tables(self.pg), rows)
            self.assertEqual(M.inventory(self.destination / "data"), current)
            self.assertEqual(
                {
                    name: (self.destination / name).read_bytes()
                    for name in saved_records
                },
                saved_records,
            )
        self.assertEqual(M.inventory(self.source), source)
        self.assertEqual(M.verify_bundle(self.bundle, self.identity)[0], self.identity)

    def test_payload_receipt_binds_every_raw_path_hash_and_actual_data_inode(self):
        self.import_data()
        content = (self.destination / "PAYLOAD.json").read_bytes()
        receipt = json.loads(content)
        st = (self.destination / "data").stat()
        entries = M.payload_entries(M.payload_inventory(self.manifest))
        self.assertEqual(
            receipt,
            {
                "format": "manure-payload-1",
                "source": self.identity,
                "destination": self.owner["id"],
                "device": st.st_dev,
                "inode": st.st_ino,
                "entries": entries,
            },
        )
        self.assertEqual(entries[0], {"path": "", "kind": "dir"})
        self.assertTrue(
            any(bytes.fromhex(e["path"]).endswith(os.fsencode(PATH)) for e in entries)
        )
        self.assertTrue(
            any(
                bytes.fromhex(e["path"]).endswith(b"/empty") and e["kind"] == "dir"
                for e in entries
            )
        )
        self.assertTrue(all("mtime_ns" not in e for e in entries))
        self.assertEqual(
            json.loads((self.destination / "COMPLETE").read_bytes()),
            {
                "source": self.identity,
                "destination": self.owner["id"],
                "payloadManifestSha256": hashlib.sha256(content).hexdigest(),
            },
        )
        # Target receipt comparison deliberately ignores mutable mtimes. The
        # source snapshot still retains and checks its nanosecond timestamps.
        file = (
            self.destination / "data" / "live" / self.fixture["ids"]["external"] / PATH
        )
        st = file.stat()
        os.utime(file, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
        M.mark_writable(self.destination, self.pg, self.identity)
        self.assertEqual(
            self.pg.run("SELECT writes_started FROM manure_offline.destination;"), "t"
        )
        self.assertEqual((self.destination / "PAYLOAD.json").read_bytes(), content)

    def test_same_size_corrupt_payload_before_mark_is_never_adopted_or_reblessed(self):
        self.import_data()
        file = (
            self.destination / "data" / "live" / self.fixture["ids"]["external"] / PATH
        )
        st = file.stat()
        file.write_bytes(b"X" * len(PAYLOAD))
        os.utime(file, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assert_boundary_refusal_preserves_state()
        self.assertEqual(file.read_bytes(), b"X" * len(PAYLOAD))

    def test_replaced_data_inode_with_identical_bytes_before_mark_is_not_adopted(self):
        self.import_data()
        data = self.destination / "data"
        replacement = self.destination / "replacement"
        M.copy_tree(data, replacement)
        self.assertEqual(M.inventory(data), M.inventory(replacement))
        data.rename(self.destination / "original-data")
        replacement.rename(data)
        self.assert_boundary_refusal_preserves_state()

    def test_new_or_missing_entries_before_mark_are_not_adopted(self):
        self.import_data()
        added = self.destination / "data" / "live" / "unrecorded"
        added.mkdir()
        self.assert_boundary_refusal_preserves_state()
        added.rmdir()
        # Restore parent mtime to isolate the negative to absent topology.
        (
            self.destination
            / "data"
            / "live"
            / self.fixture["ids"]["external"]
            / "empty"
        ).rmdir()
        self.assert_boundary_refusal_preserves_state()

    def test_missing_or_corrupt_final_proofs_are_not_regenerated_in_place(self):
        self.import_data()
        payload = self.destination / "PAYLOAD.json"
        original = payload.read_bytes()
        for corruption in (b"not-json", original + b"\n"):
            payload.write_bytes(corruption)
            self.assert_boundary_refusal_preserves_state()
        payload.write_bytes(original)
        complete = self.destination / "COMPLETE"
        marker = json.loads(complete.read_bytes())
        marker["payloadManifestSha256"] = "0" * 64
        complete.write_bytes(M.canonical(marker))
        self.assert_boundary_refusal_preserves_state()
        # Existing COMPLETE without PAYLOAD is old/partial output, not an
        # invitation to compute a new receipt over whichever bytes exist now.
        payload.unlink()
        self.assert_boundary_refusal_preserves_state()
        self.assertFalse(payload.exists())

    def test_bound_copy_restart_before_rename_and_after_payload_receipt(self):
        for stage in ("copy_bound", "payload_receipt_durable"):

            def stop(actual, wanted=stage):
                if actual == wanted:
                    raise RuntimeError(actual)

            with self.assertRaises(RuntimeError):
                self.import_data(failpoint=stop)
            self.assertFalse((self.destination / "COMPLETE").exists())
            if stage == "copy_bound":
                self.assertFalse((self.destination / "data").exists())
                self.assertTrue((self.destination / "incoming").is_dir())
            else:
                payload = (self.destination / "PAYLOAD.json").read_bytes()
        self.import_data()
        self.assertEqual((self.destination / "PAYLOAD.json").read_bytes(), payload)
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "7")

    def test_postcommit_pre_receipt_replaced_root_cannot_be_blessed_on_retry(self):
        def stop(stage):
            if stage == "metadata_committed":
                raise RuntimeError(stage)

        with self.assertRaises(RuntimeError):
            self.import_data(failpoint=stop)
        self.assertFalse((self.destination / "PAYLOAD.json").exists())
        self.assertFalse((self.destination / "COMPLETE").exists())
        data = self.destination / "data"
        M.copy_tree(data, self.destination / "replacement")
        data.rename(self.destination / "original-data")
        (self.destination / "replacement").rename(data)
        self.assert_boundary_refusal_preserves_state()
        self.assertFalse((self.destination / "PAYLOAD.json").exists())
        self.assertFalse((self.destination / "COMPLETE").exists())

    def test_old_converter_completion_without_payload_proofs_requires_new_destination(
        self,
    ):
        self.import_data()
        (self.destination / "COPY.json").unlink()
        (self.destination / "PAYLOAD.json").unlink()
        (self.destination / "COMPLETE").write_bytes(
            M.canonical({"source": self.identity, "destination": self.owner["id"]})
        )
        self.assert_boundary_refusal_preserves_state()
        self.assertFalse((self.destination / "COPY.json").exists())
        self.assertFalse((self.destination / "PAYLOAD.json").exists())

    def test_postcommit_pre_receipt_corruption_never_gets_a_fresh_hash_receipt(self):
        def stop(stage):
            if stage == "metadata_committed":
                raise RuntimeError(stage)

        with self.assertRaises(RuntimeError):
            self.import_data(failpoint=stop)
        file = (
            self.destination / "data" / "live" / self.fixture["ids"]["external"] / PATH
        )
        st = file.stat()
        file.write_bytes(b"X" * len(PAYLOAD))
        os.utime(file, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assert_boundary_refusal_preserves_state()
        self.assertFalse((self.destination / "PAYLOAD.json").exists())
        self.assertFalse((self.destination / "COMPLETE").exists())

    def test_no_payload_completion_receipt_before_pg_readback_verifies(self):
        def corrupt(stage):
            if stage == "metadata_committed":
                self.pg.run(
                    "UPDATE manure.artifacts SET name=decode('6368616e676564','hex');"
                )

        with self.assertRaises(M.Refused):
            self.import_data(failpoint=corrupt)
        self.assertFalse((self.destination / "PAYLOAD.json").exists())
        self.assertFalse((self.destination / "COMPLETE").exists())
        self.assertEqual(
            self.pg.run("SELECT writes_started FROM manure_offline.destination;"), "f"
        )
        self.assertEqual(self.pg.run("SELECT count(*) FROM manure.artifacts;"), "7")
        self.assertEqual(M.verify_bundle(self.bundle, self.identity)[0], self.identity)

    def test_dangling_final_proof_is_not_treated_as_missing_for_restart(self):
        def stop(stage):
            if stage == "metadata_committed":
                raise RuntimeError(stage)

        with self.assertRaises(RuntimeError):
            self.import_data(failpoint=stop)
        payload = self.destination / "PAYLOAD.json"
        payload.symlink_to(self.destination / "does-not-exist")
        with self.assertRaises(M.Refused):
            self.import_data()
        self.assertTrue(payload.is_symlink())
        self.assertFalse((self.destination / "COMPLETE").exists())
        self.assertEqual(
            self.pg.run("SELECT writes_started FROM manure_offline.destination;"), "f"
        )

    def test_active_payload_owner_blocks_writable_boundary(self):
        self.import_data()
        with M.claim(self.destination / "data"), self.assertRaises(M.Refused):
            M.mark_writable(self.destination, self.pg, self.identity)
        self.assertEqual(
            self.pg.run("SELECT writes_started FROM manure_offline.destination;"), "f"
        )
        M.mark_writable(self.destination, self.pg, self.identity)

    def test_mark_after_new_writes_refuses_before_scanning_old_payload_inventory(self):
        self.import_data()
        M.mark_writable(self.destination, self.pg, self.identity)
        # This new topology is deliberately outside the old receipt. It must
        # survive refused importer/mark calls, with no inventory refresh.
        data = self.destination / "data"
        new = data / "new-after-writes"
        new.write_bytes(b"acknowledged new bytes")
        proof = (self.destination / "PAYLOAD.json").read_bytes()
        for operation in (
            lambda: M.mark_writable(self.destination, self.pg, self.identity),
            self.import_data,
        ):
            with self.assertRaises(M.Refused):
                operation()
        self.assertEqual(new.read_bytes(), b"acknowledged new bytes")
        self.assertEqual((self.destination / "PAYLOAD.json").read_bytes(), proof)
        self.assertEqual(
            self.pg.run("SELECT writes_started FROM manure_offline.destination;"), "t"
        )

    def test_ownership_and_nonempty_destination_refused(self):
        with self.assertRaises(M.Refused):
            M.prepare_destination(self.root / "unsafe", self.pg, disposable=True)
        with self.assertRaises(M.Refused):
            M.prepare_destination(self.root / "unacknowledged", self.pg)
        self.assertFalse((self.root / "unacknowledged").exists())
        owner = json.loads((self.destination / "OWNER.json").read_bytes())
        owner["id"] = "0" * 32
        (self.destination / "OWNER.json").write_bytes(M.canonical(owner))
        with self.assertRaises(M.Refused):
            self.import_data()
        self.assertFalse((self.destination / "data").exists())


if __name__ == "__main__":
    unittest.main()
