#!/usr/bin/env python3
"""Behavioral-Active/Blackbox-Atomic; credential boundary regressions."""
import importlib.util
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

spec = importlib.util.spec_from_file_location('provider', sys.argv[1])
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
passed=[]
with tempfile.TemporaryDirectory(prefix='provider-files-') as name:
    root=Path(name)
    good=root/'good'; good.write_text('existing-value\n'); good.chmod(0o600)
    ref=root/'managed'; ref.symlink_to(good)
    assert p.private_secret(ref) == 'existing-value'
    assert good.read_text() == 'existing-value\n'
    passed += ['managed-symlink-target-read','existing-secret-preserved']
    for bad in [root/'fifo', root/'empty', root/'directory', Path('/dev/null')]:
        if bad.name=='fifo': os.mkfifo(bad,0o600)
        elif bad.name=='empty': bad.touch(mode=0o600)
        elif bad.name=='directory': bad.mkdir()
        # Separate bounded child: a regression must fail the test, not hang CI.
        code='import importlib.util,sys; s=importlib.util.spec_from_file_location("p",sys.argv[1]); p=importlib.util.module_from_spec(s);s.loader.exec_module(p); p.private_secret(sys.argv[2])'
        result=subprocess.run([sys.executable,'-c',code,sys.argv[1],str(bad)],capture_output=True,timeout=2)
        assert result.returncode != 0
        passed.append('reject-'+bad.name)
    for raw,expected in [('IX','IX'),('\u00adIX','IX'),('\u2168','IX'),('a\u00a0b','a b'),('p\u00e4ss','p\u00e4ss'),('\u0007raw','\u0007raw'),('\u0221raw','\u0221raw'),('\u0627abc','\u0627abc')]:
        assert p.saslprep(raw) == expected.encode()
        passed.append('saslprep-case-'+str(len(passed)))
if len(sys.argv)>2:
    Path(sys.argv[2]).write_text(json.dumps({'tests':passed,'cases':len(passed),'failures':0,'errors':0,'skips':0,'providerSHA256':hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest(),'testSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},indent=2)+'\n')
print('PASS: managed reference preservation; FIFO/character/directory/empty rejection; Unicode3.2 SASLprep normalization and raw fallback')
