#!/usr/bin/env python3
"""Test-only admin seam: exact disposable DB+HBA, non-superuser runtime role.
One validated DB name argument; no arbitrary connection/SQL/prod state input.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def main():
    os.umask(0o077)
    root=Path(os.environ['PONYGIRLS_OWNED_FIXTURE_ROOT'])
    if (root.resolve()!=root or not root.name.startswith('ponygirls-owned-pg-')
            or (root/'.owned-test-only').read_text()!='ponygirls-owned-test-v1\n'):
        raise ValueError('owned disposable fixture required')
    service=os.environ['PONYGIRLS_TEST_PROVISION_SERVICE']
    if service not in ('haystack','manure','chronicle'): raise ValueError('unknown service')
    drop = len(sys.argv)==3 and sys.argv[1]=='--drop'
    if not (len(sys.argv)==2 or drop): raise ValueError('one test database name required')
    name=sys.argv[-1]
    if not re.fullmatch('[a-z_][a-z0-9_]{0,62}',name) or name in ('postgres','template0','template1') or name.startswith('pg_') or not name.startswith(service+'_'):
        raise ValueError('invalid disposable database identifier')
    cfg=json.loads((root/'provider.json').read_text())
    if cfg['stateDirectory']!=str(root/'cluster'): raise ValueError('fixture binding differs')
    with (root/'provision.lock').open('a') as lock:
        os.chmod(root/'provision.lock',0o600);fcntl.flock(lock,fcntl.LOCK_EX)
        registry_path=root/'created-databases.json'
        registry=json.loads(registry_path.read_text()) if registry_path.exists() else {}
        spec=importlib.util.spec_from_file_location('provider',os.environ['PG_PROVIDER'])
        provider=importlib.util.module_from_spec(spec);spec.loader.exec_module(provider)
        if drop:
            if registry.get(name)!=service: raise ValueError('only helper-created database may be dropped')
            provider.sql(cfg,'postgres',f'DROP DATABASE "{name}" WITH (FORCE);')
            del registry[name]
            registry_path.write_text(json.dumps(registry))
            print('{}')
            return
        if name in registry: raise ValueError('test database already registered')
        d=cfg['databases'][service]
        d['name']=name
        hba=root/'hba'
        rule=f"host {name} {d['user']} 127.0.0.1/32 scram-sha-256\n"
        text=hba.read_text()
        if rule not in text:
            if text.count('host all all 0.0.0.0/0 reject')!=1: raise ValueError('unexpected fixture HBA')
            temporary=root/'hba.tmp';temporary.write_text(text.replace('host all all 0.0.0.0/0 reject',rule+'host all all 0.0.0.0/0 reject'))
            os.replace(temporary,hba)
            subprocess.run([cfg['postgresBin']+'/pg_ctl','-D',str(root/'cluster'/'data'),'reload'],check=True,capture_output=True,timeout=10)
        provider.provision(cfg,service,False)
        registry[name]=service
        registry_path.write_text(json.dumps(registry))
        print(json.dumps({'jdbcUrl':f'jdbc:postgresql://127.0.0.1:{cfg["port"]}/{name}',
            'user':d['user'],'passwordFile':d['passwordFile']}))

if __name__=='__main__':
    try: main()
    except Exception:
        print('owned test database provisioning failed (no SQL/credentials logged)',file=sys.stderr)
        sys.exit(1)
