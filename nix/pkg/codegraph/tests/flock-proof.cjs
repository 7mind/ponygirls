// Proves Linux flock(1) locks the inherited open-file-description, not child PID.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const flock = process.env.CODEGRAPH_FLOCK || 'flock';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-flock-'));
const file = path.join(dir, 'stable.lock');
try {
  const fd = fs.openSync(file, 'a+', 0o600);
  assert.equal(spawnSync(flock, ['-n', '3'], { stdio: ['ignore', 'pipe', 'pipe', fd] }).status, 0);
  // flock child has exited; independent open must still conflict.
  assert.equal(spawnSync(flock, ['-n', file, 'true']).status, 1);
  fs.closeSync(fd);
  assert.equal(spawnSync(flock, ['-n', file, 'true']).status, 0);
  console.log('PASS: inherited FD holds kernel flock after helper exits; close releases it');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
