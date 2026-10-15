// Owned lifecycle-fault fixture: scoped override so ONLY appends to
// compaction-lifecycle.jsonl throw. ENTRY appends, usage records, latch
// files and release markers are unaffected. Loaded via NODE_OPTIONS preload
// in the worker.
import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const originalAppend = fs.appendFileSync;
fs.appendFileSync = function (path, ...rest) {
  if (typeof path === 'string' && path.endsWith('compaction-lifecycle.jsonl')) {
    throw new Error('CONTROLLER_R7_LIFECYCLE_APPEND_FAULT');
  }
  return Reflect.apply(originalAppend, this, [path, ...rest]);
};
syncBuiltinESMExports();
assert.equal(typeof process.send, 'function', 'controlled worker must have its genuine IPC channel');
