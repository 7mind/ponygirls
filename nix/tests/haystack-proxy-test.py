#!/usr/bin/env python3
"""Actual rendered HM nginx config, owned ports/state, current Failure response.
Behavioral-Active / Blackbox-GoodCommunication (local nginx only).
"""
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

expected=json.loads(Path(sys.argv[2]).read_text())
passed=[]
with tempfile.TemporaryDirectory(prefix='haystack-proxy-test-') as temporary:
    root=Path(temporary);state=root/'state';(state/'nginx'/'body').mkdir(parents=True);(state/'nginx'/'proxy').mkdir()
    def port():
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
    config=Path(sys.argv[1]).read_text().replace('/home/alice/.local/state/ivm-services',str(state)).replace('100.64.0.2:','127.0.0.1:')
    ports={old:port() for old in (8443,8444,8445,8446,8447)}
    for old,new in ports.items():config=config.replace(':'+str(old),':'+str(new))
    config=config.replace(':47328',':'+str(port())) # intentionally absent backend
    (root/'nginx.conf').write_text(config)
    log=(root/'nginx.log').open('wb')
    process=subprocess.Popen([os.environ['NGINX'],'-e','stderr','-p',str(root)+'/', '-c',str(root/'nginx.conf'),'-g','daemon off;'],stdout=log,stderr=log)
    try:
        for _ in range(100):
            if process.poll() is not None:raise AssertionError('owned nginx exited before bind')
            try:
                with socket.create_connection(('127.0.0.1',ports[8445]),timeout=.2):break
            except OSError:time.sleep(.05)
        else:raise AssertionError('owned nginx readiness deadline')
        canary=secrets.token_hex(24)
        for route in ['/api/v1/get','/mcp']:
            request=urllib.request.Request(f'http://127.0.0.1:{ports[8445]}{route}?private='+canary,data=b'{}',headers={'Host':f'services.example.test:{ports[8445]}','Content-Type':'application/json','Authorization':'Bearer '+canary},method='POST')
            try:urllib.request.urlopen(request,timeout=5);raise AssertionError('missing backend did not fail')
            except urllib.error.HTTPError as response:
                assert response.code==503
                assert json.load(response)==expected
                assert response.headers.get('Cache-Control')=='no-store'
            passed.append(route+'-typed-unavailable-no-store')
        time.sleep(.1);log.flush()
        assert canary not in (root/'nginx.log').read_text()
        passed.append('upstream-error-query-and-header-canary-not-logged')
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait()
        log.close()
Path(sys.argv[3]).write_text(json.dumps({'tests':passed,'cases':len(passed),'failures':0,'errors':0,'skips':0},indent=2)+'\n')
