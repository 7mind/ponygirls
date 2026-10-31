#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.ts';
import { CollectorError } from './domain.ts';
import { FileSecretReader } from './runtime-privacy.ts';
import { HttpProgressReporter } from './progress.ts';
import { HttpIngester } from './ingest.ts';
import { Collector } from './collector.ts';
import { LocalGitMetadata } from './git.ts';
import { DaemonLock, SqliteSpool } from './spool.ts';
import { formatCollectorStatus } from './status.ts';

interface Arguments { configPath: string; operation: 'daemon' | 'once' | 'status' | 'retry' | 'drop'; requestId: string | null; json: boolean }
const USAGE = 'usage: [--config ABSOLUTE_PATH] [--once|--status [--json]|--retry REQUEST_ID|--drop REQUEST_ID]';
function args(argv: string[], defaultConfigPath: string): Arguments {
  let configPath: string | null = null; let operation: Arguments['operation'] = 'daemon'; let requestId: string | null = null; let json = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--config' && configPath === null) {
      const explicitConfig = argv[++i];
      if (explicitConfig === undefined) throw new CollectorError('invalid-arguments');
      configPath = explicitConfig; continue;
    }
    if (argument === '--json' && !json) { json = true; continue; }
    if (['--once', '--status', '--retry', '--drop'].includes(argument ?? '') && operation === 'daemon') {
      operation = argument!.slice(2) as Arguments['operation'];
      if (operation === 'retry' || operation === 'drop') requestId = argv[++i] ?? null;
      continue;
    }
    throw new CollectorError(USAGE);
  }
  if (json && operation !== 'status') throw new CollectorError(USAGE);
  if (configPath === null) configPath = defaultConfigPath;
  if (!isAbsolute(configPath) || ((operation === 'retry' || operation === 'drop') && (requestId === null || !/^[0-9a-f-]{36}$/i.test(requestId)))) throw new CollectorError('invalid-arguments');
  return { configPath, operation, requestId, json };
}
const print = (value: unknown): void => { process.stdout.write(JSON.stringify(value) + '\n'); };
async function main(): Promise<void> {
  process.umask(0o077);
  const configHome = process.env.XDG_CONFIG_HOME;
  const defaultConfigPath = join(configHome !== undefined && isAbsolute(configHome) ? configHome : join(homedir(), '.config'), 'chronicle', 'collector.json');
  const arguments_ = args(process.argv.slice(2), defaultConfigPath);
  let input: unknown;
  try {
    if (statSync(arguments_.configPath).size > 1_048_576) throw new Error();
    input = JSON.parse(readFileSync(arguments_.configPath, 'utf8')) as unknown;
  } catch { throw new CollectorError('config-read-failed'); }
  const config = loadConfig(input);
  if (!config.enabled) {
    if (arguments_.operation === 'status' && !arguments_.json) process.stdout.write('Chronicle collector: disabled\n');
    else print({ enabled: false });
    return;
  }
  const lock = arguments_.operation === 'status' ? null : new DaemonLock(config.stateDir);
  let spool: SqliteSpool | null = null;
  try {
    spool = new SqliteSpool(config.stateDir);
    const collector = new Collector(config, spool, new HttpIngester(config), Math.random, new LocalGitMetadata('git', 1000, 65536), new HttpProgressReporter(config), new FileSecretReader());
    if (arguments_.operation === 'status') {
      const status = collector.status();
      if (arguments_.json) print(status);
      else process.stdout.write(formatCollectorStatus(status));
      return;
    }
    if (arguments_.operation === 'retry' || arguments_.operation === 'drop') {
      if (arguments_.requestId === null) throw new CollectorError('request-id-required');
      if (arguments_.operation === 'retry') spool.retry(arguments_.requestId);
      else spool.drop(arguments_.requestId, 'operator-drop');
      print(collector.status()); return;
    }
    // Keep OS signal termination: SQLite preserves pending work and releases the
    // daemon lock even while a synchronous scan cannot yield to a JS handler.
    for (;;) {
      const result = await collector.runOnce(Date.now()); print(result);
      if (arguments_.operation === 'once') {
        if (result.uploadFailures + result.quarantined + result.pending + result.stopped + result.conflicts > 0 || spool.diagnostics().some(d => d.rootId === 'reporting')) process.exitCode = 1;
        return;
      }
      await sleep(config.pollMs);
    }
  } finally { if (spool !== null) spool.close(); if (lock !== null) lock.close(); }
}
void main().catch((error: unknown) => {
  process.stderr.write(JSON.stringify({ code: error instanceof CollectorError ? error.code : 'collector-failed' }) + '\n');
  process.exitCode = 1;
});
