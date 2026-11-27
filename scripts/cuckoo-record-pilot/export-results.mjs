// Usage: node export-results.mjs OUTPUT_DIR RESULTS_DIR/LABEL [...]   Writes OUTPUT_DIR/<label>.jsonl, one session per line.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compact, labelOf, loadResults } from './results.mjs';

const [output, ...directories] = process.argv.slice(2);
if (output === undefined || directories.length === 0) throw new Error('Usage: node export-results.mjs OUTPUT_DIR RESULTS_DIR/LABEL [...]');
mkdirSync(output, { recursive: true });
for (const directory of directories) {
  const results = loadResults(directory);
  const text = results.map(result => JSON.stringify(compact(result))).join('\n') + '\n';
  writeFileSync(join(output, `${labelOf(directory)}.jsonl`), text);
  console.log(`${labelOf(directory)}: ${results.length} sessions, ${text.length} characters`);
}
