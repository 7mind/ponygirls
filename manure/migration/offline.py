#!/usr/bin/env python3
"""Explicit quiesced SQLite/filesystem snapshot and owned PostgreSQL import.

Migration-only stdlib SQLite. Private inputs/outputs; see offline-conversion.md.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import math
import os
import shutil
import socket
import sqlite3
import stat
import struct
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

FORMAT = "manure-offline-1"
PAYLOAD_FORMAT = "manure-payload-1"
COPY_FORMAT = "manure-copy-1"
# Exact storage.py schema, not an API DTO.
TABLES = {
    "artifacts": (
        ("id", "T"),
        ("name", "T"),
        ("kind", "T"),
        ("visibility", "T"),
        ("created_by_user", "T"),
        ("created_by_token", "T"),
        ("created_at", "T"),
        ("created_at_s", "R"),
        ("expires_at", "T"),
        ("expires_at_s", "R"),
        ("state", "T"),
        ("total_bytes", "I"),
        ("file_count", "I"),
        ("reserved_bytes", "I"),
        ("ext_pwd_hash", "T"),
        ("last_activity_at", "R"),
        ("manifest_json", "T"),
    ),
    "receipts": (
        ("artifact_id", "T"),
        ("path", "T"),
        ("offset", "I"),
        ("length", "I"),
        ("sha256", "T"),
    ),
    "one_time_grants": (
        ("grant_hash", "T"),
        ("artifact_id", "T"),
        ("principal", "T"),
        ("expires_at", "R"),
        ("used", "I"),
        ("user_id", "T"),
        ("token_id", "T"),
        ("token_digest", "T"),
    ),
    "content_grants": (
        ("grant_hash", "T"),
        ("artifact_id", "T"),
        ("expires_at", "R"),
        ("created_at", "R"),
        ("user_id", "T"),
        ("token_id", "T"),
        ("token_digest", "T"),
        ("pwd_hash", "T"),
    ),
}
ROOT_NAMES = {"manure.db", "manure.db-wal", "manure.db-shm", "staging", "live"}


class Refused(ValueError):
    """Safe refusal; messages intentionally contain no source values."""


def require(ok, message):
    if not ok:
        raise Refused(message)


def canonical(value):
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    ).encode("ascii")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def syncdir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, data):
    path = Path(path)
    temp = path.with_name(path.name + ".tmp")
    if temp.exists() or temp.is_symlink():
        st = temp.lstat()
        require(
            stat.S_ISREG(st.st_mode) and st.st_uid == os.getuid() and st.st_nlink == 1,
            "unsafe interrupted atomic temporary",
        )
        temp.unlink()
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
        syncdir(path.parent)
    finally:
        temp.unlink(missing_ok=True)


def private_root(path):
    path = Path(path).absolute()
    st = path.lstat()
    require(
        stat.S_ISDIR(st.st_mode)
        and st.st_uid == os.getuid()
        and stat.S_IMODE(st.st_mode) == 0o700,
        "destination must be an owned real directory mode 0700",
    )
    require(path.resolve() == path, "destination parent aliases forbidden")
    return path


def regular_bytes(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        require(stat.S_ISREG(os.fstat(fd).st_mode), "not a regular file")
        with os.fdopen(os.dup(fd), "rb") as src:
            return src.read()
    finally:
        os.close(fd)


def inventory(root):
    """No links/special files; names are filesystem bytes in hex.

    Operator must own/quiesce the entire namespace. Before/after inventories
    detect drift but are NOT a concurrent filesystem snapshot algorithm.
    """
    result = []

    def visit(path, rel):
        st = path.lstat()
        require(st.st_uid == os.getuid(), "tree must be operator-owned")
        if stat.S_ISDIR(st.st_mode):
            result.append(
                {
                    "path": os.fsencode(rel).hex(),
                    "kind": "dir",
                    "mtime_ns": st.st_mtime_ns,
                }
            )
            for name in sorted(os.listdir(path), key=os.fsencode):
                visit(path / name, rel + "/" + name if rel else name)
        else:
            require(
                stat.S_ISREG(st.st_mode) and st.st_nlink == 1,
                "links/special files forbidden",
            )
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                before = os.fstat(fd)
                require(
                    (before.st_dev, before.st_ino) == (st.st_dev, st.st_ino),
                    "file changed",
                )
                h = hashlib.sha256()
                while block := os.read(fd, 1 << 20):
                    h.update(block)
                after = os.fstat(fd)
                require(
                    (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    == (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                    "file changed",
                )
                result.append(
                    {
                        "path": os.fsencode(rel).hex(),
                        "kind": "file",
                        "size": st.st_size,
                        "sha256": h.hexdigest(),
                        "mtime_ns": st.st_mtime_ns,
                    }
                )
            finally:
                os.close(fd)

    visit(Path(root), "")
    return result


def copy_tree(source, dest):
    """Copy inventoried quiesced owned tree without overwrites/symlinks."""
    root_stat = Path(source).stat()
    os.mkdir(dest, 0o700)
    for name in sorted(os.listdir(source), key=os.fsencode):
        src, dst = Path(source) / name, Path(dest) / name
        st = src.lstat()
        if stat.S_ISDIR(st.st_mode):
            copy_tree(src, dst)
        else:
            require(
                stat.S_ISREG(st.st_mode) and st.st_nlink == 1,
                "links/special files forbidden",
            )
            infd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                require(stat.S_ISREG(os.fstat(infd).st_mode), "source changed")
                outfd = os.open(
                    dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
                )
                with (
                    os.fdopen(outfd, "wb") as out,
                    os.fdopen(os.dup(infd), "rb") as inp,
                ):
                    shutil.copyfileobj(inp, out, 1 << 20)
                    out.flush()
                    os.fsync(out.fileno())
                os.utime(
                    dst, ns=(st.st_atime_ns, st.st_mtime_ns), follow_symlinks=False
                )
                sync_fd = os.open(dst, os.O_RDONLY | os.O_NOFOLLOW)
                try:
                    os.fsync(sync_fd)
                finally:
                    os.close(sync_fd)
            finally:
                os.close(infd)
    os.utime(
        dest, ns=(root_stat.st_atime_ns, root_stat.st_mtime_ns), follow_symlinks=False
    )
    syncdir(dest)


@contextlib.contextmanager
def claim(source):
    source = Path(source).absolute()
    require(
        source.resolve() == source and source.is_dir(),
        "source must be canonical real directory",
    )
    st = source.lstat()
    require(st.st_uid == os.getuid(), "source not operator-owned")
    key = digest(f"{st.st_dev}:{st.st_ino}".encode())
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        try:
            sock.bind("\0manure-" + key)  # exact physical-root claim from storage.py
        except OSError as exc:
            raise Refused("source active or ownership unavailable") from exc
        yield {"path": str(source), "device": st.st_dev, "inode": st.st_ino}
        current = source.lstat()
        require(
            (current.st_dev, current.st_ino) == (st.st_dev, st.st_ino),
            "source identity changed",
        )
    finally:
        sock.close()


def sqlite_export(raw):
    # Even read-only WAL readers can mutate SHM: only open a throwaway copy.
    with tempfile.TemporaryDirectory(prefix="manure-sqlite-read-") as temp:
        work = Path(temp) / "copy"
        work.mkdir(mode=0o700)
        for name in ROOT_NAMES - {"staging", "live"}:
            if (raw / name).exists():
                shutil.copyfile(raw / name, work / name)
        con = sqlite3.connect((work / "manure.db").as_uri() + "?mode=ro", uri=True)
        try:
            require(
                con.execute("PRAGMA integrity_check").fetchall() == [("ok",)],
                "SQLite integrity failed",
            )
            names = {
                r[0]
                for r in con.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                )
            }
            require(names == set(TABLES), "unrecognized SQLite tables")
            tables, schema = {}, {}
            for table, columns in TABLES.items():
                info = con.execute(f'PRAGMA table_info("{table}")').fetchall()
                expected = [
                    (n, {"T": "TEXT", "R": "REAL", "I": "INTEGER"}[t])
                    for n, t in columns
                ]
                actual = [(r[1], r[2].upper()) for r in info]
                optional = {"user_id", "token_id", "token_digest", "pwd_hash"}
                require(
                    actual == [c for c in expected if c in actual]
                    and all(
                        n in {a[0] for a in actual}
                        or (table.endswith("grants") and n in optional)
                        for n, _ in expected
                    ),
                    "unrecognized SQLite schema",
                )
                schema[table] = info
                rows = []
                for (rowid,) in con.execute(
                    f'SELECT rowid FROM "{table}" ORDER BY rowid'
                ):
                    values = []
                    for name, typ in columns:
                        if name not in {r[1] for r in info}:
                            values.append(None)
                            continue
                        kind, val = con.execute(
                            f"SELECT typeof(\"{name}\"), CASE WHEN typeof(\"{name}\") IN ('text','blob') "
                            f'THEN CAST("{name}" AS BLOB) ELSE "{name}" END FROM "{table}" WHERE rowid=?',
                            (rowid,),
                        ).fetchone()
                        if kind == "null":
                            values.append(None)
                        elif kind == "real":
                            values.append(["R", struct.pack(">d", val).hex()])
                        elif kind == "integer":
                            values.append(["I", str(val)])
                        else:
                            values.append(["T" if kind == "text" else "B", val.hex()])
                    rows.append({"rowid": rowid, "values": values})
                tables[table] = rows
            return {
                "tables": tables,
                "sqlite_schema": schema,
                "sqlite_user_version": con.execute("PRAGMA user_version").fetchone()[0],
            }
        finally:
            con.close()


def decode(cell):
    if cell is None:
        return None
    typ, value = cell
    if typ == "R":
        return struct.unpack(">d", bytes.fromhex(value))[0]
    if typ == "I":
        return int(value)
    return bytes.fromhex(value).decode("utf-8") if typ == "T" else bytes.fromhex(value)


def records(manifest, table):
    names = [n for n, _ in TABLES[table]]
    return [
        dict(zip(names, map(decode, row["values"])))
        for row in manifest["tables"][table]
    ]


def url_for(config, aid, origin):
    if config.get("content_mode", "subdomain") == "path":
        return origin.rstrip("/") + "/view/" + aid
    parts = urlsplit(origin)
    suffix = config.get("content_suffix", "")
    require(bool(suffix), "subdomain config needs content_suffix")
    port = ":" + str(parts.port) if parts.port else ""
    return urlunsplit((parts.scheme, aid + "." + suffix + port, "", "", ""))


def audit(manifest, raw):
    """Comparison inventory, NOT reconciliation: inconsistencies survive."""
    config = json.loads(bytes.fromhex(manifest["config_hex"]))
    require(
        type(config.get("chunk_bytes")) is int and config["chunk_bytes"] > 0,
        "explicit effective chunk_bytes required",
    )
    require(bool(config.get("api_origin")), "effective api_origin required")
    artifacts = records(manifest, "artifacts")
    states, urls, receipts = {}, {}, []
    require(
        config.get("content_mode", "subdomain") in ("path", "subdomain"),
        "unknown content mode",
    )
    require(
        not config.get("allowed_api_origins") or config.get("content_mode") == "path",
        "alias origins require path mode",
    )
    origins = [config["api_origin"], *config.get("allowed_api_origins", [])]
    for origin in origins:
        parsed = urlsplit(origin)
        require(
            parsed.scheme in ("http", "https")
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and parsed.port != 0
            and parsed.path in ("", "/")
            and not parsed.query
            and not parsed.fragment,
            "effective bare origin required",
        )
    for item in artifacts:
        states[item["state"]] = states.get(item["state"], 0) + 1
        urls[item["id"]] = [url_for(config, item["id"], o) for o in origins]
    by_id = {a["id"]: a for a in artifacts}
    for r in records(manifest, "receipts"):
        aid, rel = r["artifact_id"], r["path"]
        safe = (
            isinstance(aid, str)
            and len(aid) == 32
            and all(c in "0123456789abcdef" for c in aid)
            and isinstance(rel, str)
            and "\0" not in rel
            and not rel.startswith("/")
            and all(p not in ("", ".", "..") for p in rel.split("/"))
            and type(r["offset"]) is int
            and r["offset"] >= 0
            and type(r["length"]) is int
            and 0 < r["length"] <= config["chunk_bytes"]
        )
        locations = []
        if safe:
            for label, prefix in (
                ("staging", raw / "staging" / aid / "tree"),
                ("live", raw / "live" / aid),
            ):
                file = prefix / rel
                if file.is_file():
                    with file.open("rb") as src:
                        src.seek(r["offset"])
                        got = src.read(r["length"])
                    if len(got) == r["length"] and digest(got) == r["sha256"]:
                        locations.append(label)
        receipts.append(
            {
                "artifact_id_hex": aid.encode().hex() if isinstance(aid, str) else None,
                "path_hex": rel.encode().hex() if isinstance(rel, str) else None,
                "offset": r["offset"],
                "length": r["length"],
                "verified_locations": locations,
                "artifact_exists": aid in by_id,
            }
        )
    return {
        "counts": {t: len(rows) for t, rows in manifest["tables"].items()},
        "states": states,
        "reserved_bytes": sum(a["reserved_bytes"] or 0 for a in artifacts),
        "total_bytes": sum(a["total_bytes"] or 0 for a in artifacts),
        "urls": urls,
        "receipt_coverage": receipts,
        "credential_refs": [
            {"user_id": u["id"], "token_id": t["id"], "hashFile": t["hashFile"]}
            for u in config.get("users", [])
            for t in u.get("tokens", [])
        ],
    }


def snapshot(source, bundle, config_path, *, quiesced=False, failpoint=None):
    require(quiesced, "explicit quiesced acknowledgement required")
    source, bundle = Path(source).absolute(), Path(bundle).absolute()
    require(
        source != bundle and source not in bundle.parents,
        "snapshot must be outside source",
    )
    config_bytes = regular_bytes(config_path)
    with claim(source) as identity:
        require(
            set(os.listdir(source)) <= ROOT_NAMES
            and {"manure.db", "staging", "live"} <= set(os.listdir(source)),
            "unexpected source root layout",
        )
        before = inventory(source)
        binding = {
            "format": FORMAT,
            "source": identity,
            "config_sha256": digest(config_bytes),
            "inventory_sha256": digest(canonical(before)),
            "quiesced": True,
        }
        if not bundle.exists():
            bundle.mkdir(mode=0o700)
            syncdir(bundle.parent)
            atomic(bundle / "OWNER.json", canonical(binding))
        private_root(bundle)
        require(
            json.loads(regular_bytes(bundle / "OWNER.json")) == binding,
            "snapshot restart binding mismatch",
        )
        if (bundle / "COMPLETE").exists():
            return verify_bundle(bundle)
        require(
            set(os.listdir(bundle))
            <= {
                "OWNER.json",
                "raw",
                "manifest.json",
                "manifest.json.tmp",
                "COMPLETE.tmp",
            },
            "unrecognized incomplete snapshot contents",
        )
        for name in ("manifest.json.tmp", "manifest.json", "COMPLETE.tmp"):
            (bundle / name).unlink(missing_ok=True)
        if (bundle / "raw").exists():
            inventory(bundle / "raw")
            shutil.rmtree(bundle / "raw")
        copy_tree(source, bundle / "raw")
        if failpoint:
            failpoint("snapshot_copied")
        require(
            before == inventory(source) == inventory(bundle / "raw"),
            "source changed during matched snapshot",
        )
        require(
            regular_bytes(config_path) == config_bytes,
            "config changed during matched snapshot",
        )
        manifest = {
            **binding,
            **sqlite_export(bundle / "raw"),
            "config_hex": config_bytes.hex(),
            "config_ref": str(Path(config_path).absolute()),
            "files": before,
            "pg_schema_sha256": digest(
                Path(__file__).with_name("schema.sql").read_bytes()
            ),
        }
        manifest["audit"] = audit(manifest, bundle / "raw")
        atomic(bundle / "manifest.json", canonical(manifest))
        atomic(bundle / "COMPLETE", (digest(canonical(manifest)) + "\n").encode())
        return verify_bundle(bundle)


def verify_bundle(bundle, expected=None):
    bundle = private_root(bundle)
    require(
        set(os.listdir(bundle)) == {"OWNER.json", "raw", "manifest.json", "COMPLETE"},
        "incomplete snapshot",
    )
    content = regular_bytes(bundle / "manifest.json")
    identity = digest(content)
    require(
        regular_bytes(bundle / "COMPLETE") == (identity + "\n").encode(),
        "completion/hash mismatch",
    )
    require(expected is None or expected == identity, "unexpected snapshot identity")
    manifest = json.loads(content)
    require(
        manifest["format"] == FORMAT and manifest["quiesced"] is True,
        "unsupported snapshot",
    )
    binding = json.loads(regular_bytes(bundle / "OWNER.json"))
    require(
        all(manifest[k] == v for k, v in binding.items()), "snapshot binding mismatch"
    )
    require(
        digest(bytes.fromhex(manifest["config_hex"])) == manifest["config_sha256"],
        "config hash mismatch",
    )
    require(
        inventory(bundle / "raw") == manifest["files"], "snapshot payload corruption"
    )
    exported = sqlite_export(bundle / "raw")
    require(
        all(canonical(exported[k]) == canonical(manifest[k]) for k in exported),
        "SQLite/export mismatch",
    )
    require(
        audit(manifest, bundle / "raw") == manifest["audit"], "snapshot audit mismatch"
    )
    return identity, manifest


class Psql:
    """Only explicit libpq service reference; no passwords in argv."""

    def __init__(self, service, executable="psql"):
        require(
            bool(service) and all(c.isalnum() or c in "_-" for c in service),
            "invalid PG service reference",
        )
        self.service, self.executable = service, executable

    def run(self, sql):
        result = subprocess.run(
            [
                self.executable,
                "-X",
                "-q",
                "-A",
                "-t",
                "-v",
                "ON_ERROR_STOP=1",
                "--dbname",
                "service=" + self.service,
            ],
            input=sql,
            check=False,
            text=True,
            capture_output=True,
            timeout=120,
        )
        require(
            result.returncode == 0, "PostgreSQL failed (private diagnostics withheld)"
        )
        return result.stdout.strip()


def literal(value):
    return "E'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def qname(name):
    return '"' + name + '"'


def assertion(condition, message):
    body = (
        " BEGIN IF ("
        + condition
        + ") IS NOT TRUE THEN RAISE EXCEPTION "
        + literal(message)
        + "; END IF; END "
    )
    i = 0
    while (tag := "$offline_guard_" + str(i) + "$") in body:
        i += 1
    return "DO " + tag + body + tag + ";\n"


def prepare_destination(root, pg, *, disposable=False):
    require(
        disposable, "explicit owned disposable destination acknowledgement required"
    )
    root = Path(root).absolute()
    require(not root.exists(), "destination exists; never adopt arbitrary files")
    root.mkdir(mode=0o700)
    syncdir(root.parent)
    private_root(root)
    owner = {
        "format": FORMAT,
        "id": uuid.uuid4().hex,
        "root": str(root),
        "device": root.stat().st_dev,
        "inode": root.stat().st_ino,
        "service": pg.service,
    }
    atomic(root / "OWNER.json", canonical(owner))
    # Never provision/create a database or adopt an existing application's rows.
    sql = "BEGIN;\n" + assertion(
        "current_database() NOT IN ('postgres','template0','template1') AND "
        "(SELECT datdba=(SELECT usesysid FROM pg_user WHERE usename=current_user) "
        "FROM pg_database WHERE datname=current_database())",
        "owned disposable database required",
    )
    sql += assertion(
        "NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' "
        "AND c.relkind IN ('r','p','v','m','S','f'))",
        "database not empty",
    )
    sql += "CREATE SCHEMA manure_offline;\nCREATE TABLE manure_offline.destination "
    sql += "(id text PRIMARY KEY, root text NOT NULL, source text, writes_started boolean NOT NULL DEFAULT false);\n"
    sql += (
        "INSERT INTO manure_offline.destination(id,root) VALUES("
        + literal(owner["id"])
        + ","
        + literal(str(root))
        + ");\n"
    )
    sql += Path(__file__).with_name("schema.sql").read_text() + "\nCOMMIT;\n"
    pg.run(sql)
    return owner


def destination_owner(root, pg):
    root = private_root(root)
    owner = json.loads(regular_bytes(root / "OWNER.json"))
    require(
        owner["format"] == FORMAT
        and owner["root"] == str(root)
        and owner["service"] == pg.service
        and (owner["device"], owner["inode"])
        == (root.stat().st_dev, root.stat().st_ino),
        "destination root/service ownership mismatch",
    )
    return owner


def guard(owner, source=None, allow_writes=False):
    sql = "LOCK TABLE manure_offline.destination IN EXCLUSIVE MODE;\n"
    cond = "id=" + literal(owner["id"]) + " AND root=" + literal(owner["root"])
    if not allow_writes:
        cond += " AND NOT writes_started"
    if source:
        cond += " AND (source IS NULL OR source=" + literal(source) + ")"
    return sql + assertion(
        "(SELECT count(*)=1 FROM manure_offline.destination WHERE " + cond + ")",
        "destination/source/rollback boundary mismatch",
    )


def sql_cell(cell, typ):
    if cell is None:
        return "NULL"
    require(
        cell[0] == typ,
        "SQLite dynamic type unsupported by frozen PG schema; source retained",
    )
    if typ == "I":
        value = int(cell[1])
        require(-(1 << 63) <= value < (1 << 63), "integer outside bigint")
        return str(value)
    raw = bytes.fromhex(cell[1])
    require(typ != "R" or len(raw) == 8, "invalid timestamp bits")
    return "decode(" + literal(raw.hex()) + ",'hex')"


def projection(cell):
    if cell is None:
        return "NULL"
    value = decode(cell)
    text = (
        repr(value)
        if math.isfinite(value)
        else ("NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity")
    )
    return literal(text) + "::double precision"


def import_sql(manifest, owner, identity):
    sql = "BEGIN;\nSET LOCAL lock_timeout='5s';\nSET LOCAL statement_timeout='60s';\n"
    sql += guard(owner, identity)
    sql += assertion(
        "(SELECT source IS NULL FROM manure_offline.destination)",
        "already imported; verify retry",
    )
    sql += assertion(
        " AND ".join(f'NOT EXISTS (SELECT 1 FROM manure."{t}")' for t in TABLES),
        "destination not empty",
    )
    for table, columns in TABLES.items():
        names = [n for n, _ in columns] + [n + "_value" for n, t in columns if t == "R"]
        for row in manifest["tables"][table]:
            cells = row["values"]
            require(len(cells) == len(columns), "column count mismatch")
            values = [sql_cell(c, t) for c, (_, t) in zip(cells, columns)]
            values += [projection(c) for c, (_, t) in zip(cells, columns) if t == "R"]
            sql += (
                f'INSERT INTO manure."{table}" ('
                + ",".join(map(qname, names))
                + ") VALUES("
                + ",".join(values)
                + ");\n"
            )
    sql += (
        "UPDATE manure_offline.destination SET source="
        + literal(identity)
        + ";\nCOMMIT;\n"
    )
    return sql


def pg_tables(pg):
    result = {}
    for table, columns in TABLES.items():
        values = [
            f"CASE WHEN {qname(n)} IS NULL THEN NULL ELSE "
            + (f"{qname(n)}::text" if t == "I" else f"encode({qname(n)},'hex')")
            + " END"
            for n, t in columns
        ]
        expr = "json_build_array(" + ",".join(values) + ")::text"
        lines = pg.run(f'SELECT {expr} FROM manure."{table}";')
        result[table] = sorted(
            (json.loads(s) for s in lines.splitlines()), key=canonical
        )
        for name, typ in columns:
            if typ == "R":
                pg.run(
                    assertion(
                        f'NOT EXISTS (SELECT 1 FROM manure."{table}" WHERE '
                        f"({qname(name)} IS NULL) IS DISTINCT FROM ({qname(name + '_value')} IS NULL) OR "
                        f"({qname(name)} IS NOT NULL AND {qname(name)} <> float8send({qname(name + '_value')})))",
                        "timestamp projection mismatch",
                    )
                )
    return result


def payload_inventory(manifest):
    return [
        e
        for e in manifest["files"]
        if os.fsdecode(bytes.fromhex(e["path"])).split("/")[0] in ("staging", "live")
        or e["path"] == ""
    ]


def payload_entries(entries):
    """Target adoption inventory: raw names and exact bytes, no mutable mtimes."""
    return [
        {k: value for k, value in entry.items() if k != "mtime_ns"} for entry in entries
    ]


def data_binding(path, owner, source, format_name):
    try:
        st = Path(path).lstat()
    except OSError as exc:
        raise Refused("payload root unavailable") from exc
    require(stat.S_ISDIR(st.st_mode), "payload root must be a real directory")
    return {
        "format": format_name,
        "source": source,
        "destination": owner["id"],
        "device": st.st_dev,
        "inode": st.st_ino,
    }


def proof_exists(path):
    # A dangling symlink is still an existing invalid proof, never an absent
    # record that the restart path may replace with newly generated authority.
    path = Path(path)
    return path.exists() or path.is_symlink()


def payload_bytes(path):
    try:
        return regular_bytes(path)
    except OSError as exc:
        raise Refused("missing or unsafe payload proof") from exc


def verify_copy_binding(root, owner, source, data=None):
    """Never adopt a substituted data inode, even before final receipts exist."""
    path = Path(root) / "data" if data is None else Path(data)
    expected = data_binding(path, owner, source, COPY_FORMAT)
    require(
        payload_bytes(Path(root) / "COPY.json") == canonical(expected),
        "copied payload identity/source/destination mismatch",
    )
    return expected


def verify_payload_receipt(root, owner, source, *, complete=True):
    root = Path(root)
    content = payload_bytes(root / "PAYLOAD.json")
    expected = data_binding(root / "data", owner, source, PAYLOAD_FORMAT)
    expected["entries"] = payload_entries(inventory(root / "data"))
    require(content == canonical(expected), "payload receipt or current bytes mismatch")
    marker = {
        "source": source,
        "destination": owner["id"],
        "payloadManifestSha256": digest(content),
    }
    if complete or proof_exists(root / "COMPLETE"):
        require(
            payload_bytes(root / "COMPLETE") == canonical(marker),
            "completion payload receipt binding mismatch",
        )
    return expected, marker


def _verify_destination(bundle, root, pg, expected, *, receipts=True):
    identity, manifest = verify_bundle(bundle, expected)
    owner = destination_owner(root, pg)
    # Fail at the operational write boundary before any target hash inventory.
    pg.run(
        "BEGIN;\n"
        + guard(owner, identity)
        + assertion(
            "(SELECT source=" + literal(identity) + " FROM manure_offline.destination)",
            "import not complete",
        )
        + "COMMIT;"
    )
    verify_copy_binding(root, owner, identity)
    expected_rows = {
        t: sorted(
            ([None if c is None else c[1] for c in r["values"]] for r in rows),
            key=canonical,
        )
        for t, rows in manifest["tables"].items()
    }
    require(pg_tables(pg) == expected_rows, "PG metadata differs from snapshot")
    require(
        inventory(Path(root) / "data") == payload_inventory(manifest),
        "destination payload differs",
    )
    if receipts or proof_exists(Path(root) / "PAYLOAD.json"):
        verify_payload_receipt(root, owner, identity, complete=receipts)
    else:
        require(not proof_exists(Path(root) / "COMPLETE"), "payload receipt missing")
    return identity, manifest["audit"]


def _import_bundle(bundle, root, pg, expected, *, failpoint=None, claim_new=None):
    identity, manifest = verify_bundle(bundle, expected)
    require(
        manifest["pg_schema_sha256"]
        == digest(Path(__file__).with_name("schema.sql").read_bytes()),
        "target schema version differs from snapshot",
    )
    owner = destination_owner(root, pg)
    root = Path(root)
    pg.run("BEGIN;\n" + guard(owner, identity) + "COMMIT;")
    status = pg.run("SELECT coalesce(source,'') FROM manure_offline.destination;")
    if not status:
        if not (root / "data").exists():
            incoming = root / "incoming"
            if proof_exists(root / "COPY.json"):
                # Crash after binding the copied inode but before its rename.
                # A missing/replaced/incomplete incoming tree is not re-blessed.
                verify_copy_binding(root, owner, identity, incoming)
                require(
                    inventory(incoming) == payload_inventory(manifest),
                    "bound incoming payload mismatch",
                )
            else:
                require(
                    not proof_exists(root / "PAYLOAD.json")
                    and not proof_exists(root / "COMPLETE"),
                    "orphan final receipts",
                )
                if incoming.exists():
                    inventory(incoming)
                    shutil.rmtree(incoming)
                incoming.mkdir(mode=0o700)
                for name in ("staging", "live"):
                    copy_tree(Path(bundle) / "raw" / name, incoming / name)
                raw_stat = (Path(bundle) / "raw").stat()
                os.utime(incoming, ns=(raw_stat.st_atime_ns, raw_stat.st_mtime_ns))
                syncdir(incoming)
                require(
                    inventory(incoming) == payload_inventory(manifest),
                    "incoming payload mismatch",
                )
                # Durable identity BEFORE rename and BEFORE PG writes. A retry
                # after COMMIT/pre-PAYLOAD cannot bless a replacement data root.
                atomic(
                    root / "COPY.json",
                    canonical(data_binding(incoming, owner, identity, COPY_FORMAT)),
                )
                if failpoint:
                    failpoint("copy_bound")
            os.rename(incoming, root / "data")
            syncdir(root)
            if claim_new:
                claim_new()
        verify_copy_binding(root, owner, identity)
        require(
            inventory(root / "data") == payload_inventory(manifest),
            "payload mismatch before import",
        )
        if failpoint:
            failpoint("files_durable")
        sql = import_sql(manifest, owner, identity)
        atomic(root / "import.sql", sql.encode())
        pg.run(sql)
        if failpoint:
            failpoint("metadata_committed")
    result = _verify_destination(bundle, root, pg, expected, receipts=False)
    receipt = data_binding(root / "data", owner, identity, PAYLOAD_FORMAT)
    receipt["entries"] = payload_entries(payload_inventory(manifest))
    content = canonical(receipt)
    if proof_exists(root / "PAYLOAD.json"):
        require(
            regular_bytes(root / "PAYLOAD.json") == content,
            "existing payload receipt differs; never regenerate",
        )
    else:
        require(not proof_exists(root / "COMPLETE"), "payload receipt missing")
        atomic(root / "PAYLOAD.json", content)
    if failpoint:
        failpoint("payload_receipt_durable")
    _, marker = verify_payload_receipt(root, owner, identity, complete=False)
    if not proof_exists(root / "COMPLETE"):
        atomic(root / "COMPLETE", canonical(marker))
    return result


def verify_destination(bundle, root, pg, expected):
    with claim(root), claim(Path(root) / "data"):
        return _verify_destination(bundle, root, pg, expected)


def import_bundle(bundle, root, pg, expected, *, failpoint=None):
    # Exclude both a concurrent converter and an active destination backend.
    with claim(root), contextlib.ExitStack() as stack:
        data = Path(root) / "data"
        if data.exists() or data.is_symlink():
            stack.enter_context(claim(data))
        return _import_bundle(
            bundle,
            root,
            pg,
            expected,
            failpoint=failpoint,
            claim_new=lambda: stack.enter_context(claim(data)),
        )


def mark_writable(root, pg, expected):
    # No active process or concurrent conversion can change the verified tree
    # between hashing and the short control-row transaction.
    with claim(root), claim(Path(root) / "data"):
        owner = destination_owner(root, pg)
        pg.run("BEGIN;\n" + guard(owner, expected) + "COMMIT;")
        verify_copy_binding(root, owner, expected)
        verify_payload_receipt(root, owner, expected)
        pg.run(
            "BEGIN;\n"
            + guard(owner, expected)
            + assertion(
                "(SELECT source="
                + literal(expected)
                + " FROM manure_offline.destination)",
                "source not imported",
            )
            + "UPDATE manure_offline.destination SET writes_started=true; COMMIT;"
        )


def rollback_policy(root, pg):
    owner = destination_owner(root, pg)
    pg.run("BEGIN;\n" + guard(owner, allow_writes=True) + "COMMIT;")
    flag = pg.run("SELECT writes_started FROM manure_offline.destination;")
    return (
        "fix-forward; old SQLite restart would lose acknowledged new writes"
        if flag == "t"
        else "pre-writes only: restart untouched quiesced old snapshot; never converted destination"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    snap = sub.add_parser("snapshot")
    for name in ("source", "bundle", "config"):
        snap.add_argument("--" + name, required=True)
    snap.add_argument("--quiesced", action="store_true")
    verify = sub.add_parser("verify-snapshot")
    verify.add_argument("--bundle", required=True)
    verify.add_argument("--expected-source")
    for command in (
        "prepare-destination",
        "import",
        "verify-destination",
        "mark-writable",
        "rollback-policy",
    ):
        cmd = sub.add_parser(command)
        cmd.add_argument("--destination", required=True)
        cmd.add_argument("--pg-service", required=True)
        cmd.add_argument("--psql", default="psql")
        if command == "prepare-destination":
            cmd.add_argument("--owned-disposable", action="store_true")
        if command in ("import", "verify-destination"):
            cmd.add_argument("--bundle", required=True)
        if command in ("import", "verify-destination", "mark-writable"):
            cmd.add_argument("--expected-source", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "snapshot":
            result = snapshot(
                args.source, args.bundle, args.config, quiesced=args.quiesced
            )[0]
        elif args.command == "verify-snapshot":
            result = verify_bundle(args.bundle, args.expected_source)[0]
        else:
            pg = Psql(args.pg_service, args.psql)
            if args.command == "prepare-destination":
                result = prepare_destination(
                    args.destination, pg, disposable=args.owned_disposable
                )["id"]
            elif args.command == "import":
                result = import_bundle(
                    args.bundle, args.destination, pg, args.expected_source
                )[0]
            elif args.command == "verify-destination":
                result = verify_destination(
                    args.bundle, args.destination, pg, args.expected_source
                )[0]
            elif args.command == "mark-writable":
                mark_writable(args.destination, pg, args.expected_source)
                result = "fix-forward boundary recorded"
            else:
                result = rollback_policy(args.destination, pg)
        print(result)
    except (
        Refused,
        OSError,
        ValueError,
        KeyError,
        TypeError,
        OverflowError,
        struct.error,
        sqlite3.Error,
        subprocess.SubprocessError,
    ):
        parser.exit(
            1, "offline conversion refused; verify private inputs/ownership/state\n"
        )


if __name__ == "__main__":
    main()
