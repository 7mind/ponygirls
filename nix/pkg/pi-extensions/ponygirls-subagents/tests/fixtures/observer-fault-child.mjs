import assert from 'node:assert/strict';
import { syncBuiltinESMExports } from 'node:module';
import { createRequire } from 'node:module';

// Owned observer-fault fixture (cloned from the R6 fault technique).
// Scoped override: ONLY appends to summary-usage.jsonl throw, AFTER the
// actual public result observation point. ENTRY appends, latch files,
// release markers and error-checkpoint writes are unaffected.
const require = createRequire(import.meta.url);
const fs = require('node:fs');
const originalAppend = fs.appendFileSync;
fs.appendFileSync = function (path, ...rest) {
  if (typeof path === 'string' && path.endsWith('summary-usage.jsonl')) {
    throw new Error('CONTROLLER_R6_POST_RESULT_USAGE_APPEND_FAULT');
  }
  return Reflect.apply(originalAppend, this, [path, ...rest]);
};
syncBuiltinESMExports();
assert.equal(typeof process.send, 'function', 'controlled worker must have its genuine IPC channel');
