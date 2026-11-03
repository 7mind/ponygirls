#!/usr/bin/env python3
"""Explicit local logical backups; matched Manure snapshots require quiescence.
Never invoked automatically by application startup. No restore/activation tool.
"""
import argparse
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


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


def matched(cfg, output, payload, receipts, config_path, offline_path, quiesced):
    if not quiesced: raise ValueError('explicit --quiesced attestation required')
    spec=importlib.util.spec_from_file_location('manure_offline',offline_path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    output=Path(output).absolute();payload=Path(payload).absolute()
    if payload==output or payload in output.parents: raise ValueError('snapshot must be outside payload root')
    roots=[payload]+([Path(receipts).absolute()] if receipts else [])
    if len(set(roots)) != len(roots): raise ValueError('payload and receipt roots must be distinct')
    with contextlib.ExitStack() as stack:
        identities=[stack.enter_context(module.claim(root)) for root in roots]
        before=[module.inventory(root) for root in roots]
        config_bytes=module.regular_bytes(config_path)
        output.mkdir(mode=0o700)
        for root,name in zip(roots,['payload','migration-control']):
            module.copy_tree(root,output/name)
        # Full PG metadata shares the same quiesced/root-claimed boundary.
        backup(cfg,output/'postgres',['manure'])
        for root,name,expected in zip(roots,['payload','migration-control'],before):
            if module.inventory(root)!=expected or module.inventory(output/name)!=expected:
                raise ValueError('quiesced snapshot inventory changed')
        if module.regular_bytes(config_path)!=config_bytes:
            raise ValueError('effective configuration changed during snapshot')
        module.atomic(output/'config.json',config_bytes)
        manifest={'format':'ponygirls-manure-matched-1','roots':identities,'inventories':before,
            'configSHA256':hashlib.sha256(config_bytes).hexdigest(),'quiescedOperatorAttestation':True,
            'scope':'PG metadata + complete payload/staging/live/sidecars + optional migration control under BOTH physical-root claims. Operator must also stop external writers; not an online snapshot algorithm.'}
        module.atomic(output/'manifest.json',module.canonical(manifest))
        module.atomic(output/'COMPLETE',module.canonical({'manifestSHA256':hashlib.sha256(module.canonical(manifest)).hexdigest()}))


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['cluster','manure-matched'])
    p.add_argument('--manifest',required=True);p.add_argument('--output',required=True)
    p.add_argument('--payload-root');p.add_argument('--migration-receipt-root');p.add_argument('--config')
    p.add_argument('--quiesced',action='store_true')
    p.add_argument('--offline-tool',default=os.environ.get('PONYGIRLS_MANURE_OFFLINE_TOOL'))
    args=p.parse_args();cfg=json.loads(Path(args.manifest).read_text())
    if args.command=='cluster': backup(cfg,args.output)
    else:
        if not args.payload_root or not args.config or not args.offline_tool: p.error('matched snapshot requires payload-root, config and offline-tool')
        matched(cfg,args.output,args.payload_root,args.migration_receipt_root,args.config,args.offline_tool,args.quiesced)

if __name__=='__main__':
    try: main()
    except Exception:
        print('logical backup refused or failed; private output retained for inspection, no credentials/SQL logged',file=sys.stderr)
        sys.exit(1)
