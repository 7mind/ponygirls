// Usage: node export-results.mjs [--gz] OUTPUT_DIR RESULTS_DIR/LABEL [...]
// Writes OUTPUT_DIR/<label>.jsonl, one session per line; with --gz, OUTPUT_DIR/<label>.jsonl.gz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { compact, labelOf, loadResults } from './results.mjs';

const args = process.argv.slice(2); const gz = args[0] === '--gz'; if (gz) args.shift();
const [output, ...directories] = args;
if (output === undefined || directories.length === 0) throw new Error('Usage: node export-results.mjs [--gz] OUTPUT_DIR RESULTS_DIR/LABEL [...]');
mkdirSync(output, { recursive: true });
for (const directory of directories) {
  const results = loadResults(directory);
  const text = results.map(result => JSON.stringify(compact(result))).join('\n') + '\n';
  if (gz) writeFileSync(join(output, `${labelOf(directory)}.jsonl.gz`), gzipSync(text, { level: 9 })); else writeFileSync(join(output, `${labelOf(directory)}.jsonl`), text);
  console.log(`${labelOf(directory)}: ${results.length} sessions, ${text.length} characters`);
}
