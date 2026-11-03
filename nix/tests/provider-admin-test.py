#!/usr/bin/env python3
"""Owned PG HBA/initdb acceptance of quoted hyphenated administrative roles.
An exact fixture peer map compensates ONLY for the sandbox account name; real
HM uses the actual matching Unix principal unchanged (no role-name rewriting).
"""
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import tempfile

pg=os.environ['PG_BIN']
provider=os.environ['PG_PROVIDER']
with tempfile.TemporaryDirectory(prefix='provider-hyphen-admin-') as name:
    root=Path(name)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    config={'stateDirectory':str(root/'cluster'),'adminRole':'owned-admin','port':port,'postgresBin':pg,'databases':{}}
    manifest=root/'manifest.json';manifest.write_text(json.dumps(config))
    subprocess.run([sys.executable,provider,'init',str(manifest)],check=True,capture_output=True,timeout=60)
    (root/'hba').write_text('local all "owned-admin" peer map=owned_admin\nlocal all all reject\n')
    user=pwd.getpwuid(os.getuid()).pw_name
    (root/'ident').write_text(f'owned_admin "{user}" "owned-admin"\n')
    (root/'config').write_text(f"listen_addresses=''\nport={port}\nunix_socket_directories='{root}/cluster/socket'\nhba_file='{root}/hba'\nident_file='{root}/ident'\n")
    data=str(root/'cluster'/'data')
    subprocess.run([pg+'/pg_ctl','-D',data,'-l',str(root/'pg.log'),'-o',f'-c config_file={root}/config','-w','-t','30','start'],check=True,capture_output=True,timeout=45)
    try:
        result=subprocess.run([pg+'/psql','-X','-w','-qAt','-h',str(root/'cluster'/'socket'),'-p',str(port),'-U','owned-admin','-d','postgres','-c','SELECT current_user'],check=True,capture_output=True,text=True,timeout=10)
        assert result.stdout.strip()=='owned-admin'
    finally:
        subprocess.run([pg+'/pg_ctl','-D',data,'-m','fast','-w','-t','30','stop'],check=True,capture_output=True,timeout=45)
receipt={'cases':2,'tests':['initdb-hyphen-admin-preserved','quoted-hba-hyphen-admin-peer-authentication'],'failures':0,'errors':0,'skips':0,'scope':'Disposable PG18 with exact fixture peer map; production admin principal is not rewritten.'}
if len(sys.argv)>1: Path(sys.argv[1]).write_text(json.dumps(receipt,indent=2)+'\n')
print('PASS: hyphenated admin initdb identity and quoted HBA peer mapping')
