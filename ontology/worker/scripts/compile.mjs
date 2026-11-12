import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sdk = process.env.ONTOLOGY_PI_SDK_ROOT;
if (typeof sdk !== 'string' || !isAbsolute(sdk)) throw new Error('ONTOLOGY_PI_SDK_ROOT must name an explicit absolute installed Pi SDK root');
const manifest = JSON.parse(await readFile(resolve(sdk, 'package.json'), 'utf8'));
if (!/^1\.5\./.test(manifest.version)) throw new Error('controlled SDK compilation currently requires Pi 1.5.x');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) throw new Error('expected optional --check');
await mkdir('.cache', { recursive: true });
await writeFile('.cache/tsconfig.json', JSON.stringify({ extends: '../tsconfig.json', compilerOptions: {
  outDir: '.', paths: {
    'lossless-json': [resolve('node_modules/lossless-json')],
    '@earendil-works/pi-coding-agent': [resolve(sdk, 'dist/index.d.ts')],
    '@earendil-works/pi-agent-core': [resolve(sdk, 'node_modules/@earendil-works/pi-agent-core/dist/index.d.ts')],
  },
} }, null, 2) + '\n');
const result = spawnSync(resolve('node_modules/.bin/tsc'), ['-p', '.cache/tsconfig.json', ...(args.length === 1 ? ['--noEmit'] : [])], { stdio: 'inherit' });
if (result.error !== undefined || result.signal !== null || result.status === null) throw new Error('TypeScript process did not complete normally');
process.exitCode = result.status;
