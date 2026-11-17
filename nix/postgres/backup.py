#!/usr/bin/env python3
"""Explicit local logical backups; matched Manure snapshots require quiescence.
Never invoked automatically by application startup. No restore/activation tool.
"""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys


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
            sock.bind("\0manure-" + key)  # the Manure server's physical-root claim (ConfinedDirectory.scala)
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


def run(cfg, command, args, destination):
    env = {**os.environ, 'PGHOST':cfg['stateDirectory']+'/socket',
        'PGPORT':str(cfg['port']),'PGUSER':cfg['adminRole'],'PGCONNECT_TIMEOUT':'5'}
    partial = destination.with_suffix(destination.suffix+'.partial')
    fd = os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,'wb') as output:
            result = subprocess.run([cfg['postgresBin']+'/'+command,*args],env=env,stdout=output,stderr=subprocess.PIPE,timeout=1800)
            if result.returncode:
                raise ValueError('logical backup command failed; diagnostics suppressed')
            output.flush();os.fsync(output.fileno())
        os.rename(partial,destination)
    finally:
        partial.unlink(missing_ok=True)


def backup(cfg, destination, databases=None):
    root=Path(cfg['stateDirectory'])
    if (root/'ponygirls-provider-v1').read_text()!='postgresql-18\n' or (root/'data'/'PG_VERSION').read_text().strip()!='18':
        raise ValueError('only marked shared PostgreSQL 18 provider accepted')
    destination=Path(destination).absolute()
    destination.mkdir(mode=0o700)  # Existing output is NEVER overwritten/adopted.
    for key in databases or cfg['databases']:
        d=cfg['databases'][key]
        run(cfg,'pg_dump',['--no-password','-Fc','-d',d['name']],destination/(key+'.dump'))
    run(cfg,'pg_dumpall',['--no-password','--globals-only'],destination/'globals.sql')
    (destination/'provider.json').write_text(json.dumps(cfg,sort_keys=True)+'\n')
    inventory={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in destination.iterdir() if p.is_file()}
    (destination/'logical-backup.json').write_text(json.dumps({'format':'ponygirls-logical-backup-1','files':inventory,
        'scope':'Full independent logical databases plus privileged global role/password-verifier/configuration defaults. Not WAL/PITR; Manure payloads require matched quiesced snapshot.'},indent=2)+'\n')
    for path in destination.iterdir(): path.chmod(0o600)
    fd=os.open(destination,os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)


def matched(cfg, output, payload, receipts, config_path, quiesced):
    if not quiesced: raise ValueError('explicit --quiesced attestation required')
    output=Path(output).absolute();payload=Path(payload).absolute()
    if payload==output or payload in output.parents: raise ValueError('snapshot must be outside payload root')
    roots=[payload]+([Path(receipts).absolute()] if receipts else [])
    if len(set(roots)) != len(roots): raise ValueError('payload and receipt roots must be distinct')
    with contextlib.ExitStack() as stack:
        identities=[stack.enter_context(claim(root)) for root in roots]
        before=[inventory(root) for root in roots]
        config_bytes=regular_bytes(config_path)
        output.mkdir(mode=0o700)
        for root,name in zip(roots,['payload','migration-control']):
            copy_tree(root,output/name)
        # Full PG metadata shares the same quiesced/root-claimed boundary.
        backup(cfg,output/'postgres',['manure'])
        for root,name,expected in zip(roots,['payload','migration-control'],before):
            if inventory(root)!=expected or inventory(output/name)!=expected:
                raise ValueError('quiesced snapshot inventory changed')
        if regular_bytes(config_path)!=config_bytes:
            raise ValueError('effective configuration changed during snapshot')
        atomic(output/'config.json',config_bytes)
        manifest={'format':'ponygirls-manure-matched-1','roots':identities,'inventories':before,
            'configSHA256':hashlib.sha256(config_bytes).hexdigest(),'quiescedOperatorAttestation':True,
            'scope':'PG metadata + complete payload/staging/live/sidecars + optional migration control under BOTH physical-root claims. Operator must also stop external writers; not an online snapshot algorithm.'}
        atomic(output/'manifest.json',canonical(manifest))
        atomic(output/'COMPLETE',canonical({'manifestSHA256':hashlib.sha256(canonical(manifest)).hexdigest()}))


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['cluster','manure-matched'])
    p.add_argument('--manifest',required=True);p.add_argument('--output',required=True)
    p.add_argument('--payload-root');p.add_argument('--migration-receipt-root');p.add_argument('--config')
    p.add_argument('--quiesced',action='store_true')
    args=p.parse_args();cfg=json.loads(Path(args.manifest).read_text())
    if args.command=='cluster': backup(cfg,args.output)
    else:
        if not args.payload_root or not args.config: p.error('matched snapshot requires payload-root and config')
        matched(cfg,args.output,args.payload_root,args.migration_receipt_root,args.config,args.quiesced)

if __name__=='__main__':
    try: main()
    except Exception:
        print('logical backup refused or failed; private output retained for inspection, no credentials/SQL logged',file=sys.stderr)
        sys.exit(1)
