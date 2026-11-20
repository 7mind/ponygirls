#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.ts';
import { CollectorError } from './domain.ts';
import { pathAliases } from './controls.ts';
import { excludedPath } from './discovery.ts';
import { FileSecretReader } from './runtime-privacy.ts';
import { HttpProgressReporter } from './progress.ts';
import { HttpIngester } from './ingest.ts';
import { Collector, POLICY_CHANGED } from './collector.ts';
import { LocalGitMetadata } from './git.ts';
import { DaemonLock, droppedOnlyFor, readOnlySpool, SqliteSpool, type Spool } from './spool.ts';
import { formatCollectorStatus, formatTombstones, literal, type TombstoneReport } from './status.ts';

const PROGRAM = 'chronicle-collector';
const HELP = `${PROGRAM} — uploads local Claude, Codex and Pi session histories to Chronicle

Usage: ${PROGRAM} [--config PATH] [COMMAND] [--json]

Commands:
  (none)              run as a daemon, scanning every poll interval
  --once              scan and upload once, then exit (1 on failure or leftovers)
  --status            show the last scan, the queue and diagnostics
  --pause             stop collecting; queued uploads are kept
  --resume            continue collecting
  --exclude PATH      stop collecting from a directory
  --unexclude PATH    collect from it again
  --exclusions        list excluded directories
  --retry REQUEST_ID  retry a stopped upload on the next scan
  --drop REQUEST_ID   discard a queued upload; its source is not collected again
  --clear-policy-tombstones [--apply]
                      list the sources that a privacy or destination change
                      stopped collecting; with --apply, collect them again

--once, --retry and --drop need the daemon stopped.

Options:
  --config PATH       absolute path of the configuration
                      (default: $XDG_CONFIG_HOME/chronicle/collector.json)
  --json              machine-readable output instead of text (not for --once
                      or the daemon, which always print JSON)
  -h, --help          show this help
`;
// The command line itself is wrong: reported as text with exit 2, unlike runtime failures.
class UsageError extends Error {}
const COMMANDS = ['once', 'status', 'retry', 'drop', 'pause', 'resume', 'exclude', 'unexclude', 'exclusions', 'clear-policy-tombstones'] as const;
type Command = typeof COMMANDS[number];
const OPERANDS: Partial<Record<Command, string>> = { retry: 'a request id', drop: 'a request id', exclude: 'a path', unexclude: 'a path' };
interface Arguments { configPath: string; operation: 'daemon' | Command; operand: string | null; json: boolean; apply: boolean }
function args(argv: string[], defaultConfigPath: string): Arguments {
  let configPath: string | null = null; let operation: Command | null = null; let operand: string | null = null; let json = false; let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]!;
    if (argument === '--config') {
      if (configPath !== null) throw new UsageError('--config given twice');
      const explicitConfig = argv[++i];
      if (explicitConfig === undefined) throw new UsageError('--config needs a path');
      configPath = explicitConfig; continue;
    }
    if (argument === '--json') { if (json) throw new UsageError('--json given twice'); json = true; continue; }
    if (argument === '--apply') { if (apply) throw new UsageError('--apply given twice'); apply = true; continue; }
    const command = COMMANDS.find(name => `--${name}` === argument);
    if (command === undefined) throw new UsageError(`unknown argument '${literal(argument)}'`);
    if (operation !== null) throw new UsageError(operation === command ? `${argument} given twice` : `--${operation} and ${argument} cannot be combined; give one command`);
    operation = command;
    const expected = OPERANDS[command];
    if (expected === undefined) continue;
    operand = argv[++i] ?? '';
    if (operand.length === 0) throw new UsageError(`${argument} needs ${expected}`);
  }
  if ((operation === 'retry' || operation === 'drop') && !/^[0-9a-f-]{36}$/i.test(operand!)) throw new UsageError(`--${operation} needs a request id as --status prints it, got '${literal(operand!)}'`);
  if (apply && operation !== 'clear-policy-tombstones') throw new UsageError('--apply needs --clear-policy-tombstones');
  if (json && operation === null) throw new UsageError('--json needs a command; the daemon always prints JSON');
  if (json && operation === 'once') throw new UsageError('--json cannot be combined with --once, which always prints JSON');
  if (configPath !== null && !isAbsolute(configPath)) throw new UsageError(`--config needs an absolute path, got '${literal(configPath)}'`);
  if (configPath === null && !isAbsolute(defaultConfigPath)) throw new UsageError(`the default configuration path '${literal(defaultConfigPath)}' is not absolute; give --config PATH`);
  return { configPath: configPath ?? defaultConfigPath, operation: operation ?? 'daemon', operand, json, apply };
}
const print = (value: unknown): void => { process.stdout.write(JSON.stringify(value) + '\n'); };
type Control = 'pause' | 'resume' | 'exclude' | 'unexclude' | 'exclusions';
// Each control applies its change and returns the text that reports it.
const CONTROLS: Record<Control, (spool: Spool, operand: string | null) => string> = {
  pause: spool => { spool.setPaused(true); return 'Collection paused. Queued uploads are kept; --resume continues.'; },
  resume: spool => { spool.setPaused(false); return 'Collection resumed.'; },
  exclude: (spool, operand) => { const path = resolve(operand!); spool.exclude(path); return `Excluded ${literal(path)}.`; },
  unexclude: (spool, operand) => {
    const path = resolve(operand!); spool.unexclude(path);
    // A remaining exclusion above the path, or above what it links to, still holds its sessions.
    const aliases = pathAliases(path);
    const covering = spool.controls().exclusions.find(exclusion => aliases.some(alias => excludedPath(alias, [exclusion])));
    return covering === undefined ? `No longer excluded: ${literal(path)}.` : `Still excluded: ${literal(path)} is under ${literal(covering)}.`;
  },
  exclusions: spool => { const paths = spool.controls().exclusions; return paths.length === 0 ? 'No excluded directories.' : paths.map(literal).join('\n'); },
};
const isControl = (operation: Arguments['operation']): operation is Control => Object.hasOwn(CONTROLS, operation);
// Earlier releases tombstoned the sources of uploads discarded by a policy change; only those tombstones are cleared.
function clearPolicyTombstones(collector: Collector, spool: Spool, apply: boolean): TombstoneReport {
  const tombstones = spool.tombstones();
  const others = tombstones.filter(tombstone => !droppedOnlyFor(tombstone, POLICY_CHANGED));
  const policyChanged = apply ? spool.clearTombstones(POLICY_CHANGED) : tombstones.filter(tombstone => droppedOnlyFor(tombstone, POLICY_CHANGED));
  // Listing reads the discovered files to find those of each source; clearing touches the spool only.
  const located = apply ? null : collector.locate(new Set(policyChanged.map(tombstone => tombstone.sourceKey)));
  return {
    applied: apply,
    policyChanged: policyChanged.map(({ sourceKey, head }) => ({ sourceKey, revision: head.revision, acknowledged: head.digest !== null, ...(located === null ? {} : { files: located.files.get(sourceKey) ?? [] }) })),
    ...(located === null ? {} : { unidentifiedFiles: located.unidentified }),
    otherReasons: others.filter(tombstone => tombstone.reasons.length > 0).map(({ sourceKey, reasons }) => ({ sourceKey, reasons })),
    unattributed: others.filter(tombstone => tombstone.reasons.length === 0).map(tombstone => tombstone.sourceKey),
  };
}
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  process.umask(0o077);
  const configHome = process.env.XDG_CONFIG_HOME;
  const defaultConfigPath = join(configHome !== undefined && isAbsolute(configHome) ? configHome : join(homedir(), '.config'), 'chronicle', 'collector.json');
  const arguments_ = args(argv, defaultConfigPath);
  let input: unknown;
  try {
    if (statSync(arguments_.configPath).size > 1_048_576) throw new Error();
    input = JSON.parse(readFileSync(arguments_.configPath, 'utf8')) as unknown;
  } catch { throw new CollectorError('config-read-failed'); }
  const config = loadConfig(input);
  const controlMutation = ['pause', 'resume', 'exclude', 'unexclude'].includes(arguments_.operation) || arguments_.apply;
  // The daemon and --once report JSON lines to the journal; every other command answers in text unless --json.
  const text = !arguments_.json && arguments_.operation !== 'daemon' && arguments_.operation !== 'once';
  if (!config.enabled) {
    if (controlMutation) throw new CollectorError('collector-disabled');
    if (text) process.stdout.write('Chronicle collector: disabled\n');
    else print({ enabled: false });
    return;
  }
  const lock = ['status', 'pause', 'resume', 'exclude', 'unexclude', 'exclusions', 'clear-policy-tombstones'].includes(arguments_.operation) ? null : new DaemonLock(config.stateDir);
  let spool: Spool | null = null;
  try {
    // The dry run of --clear-policy-tombstones creates, initialises and chmods nothing.
    const dryRun = arguments_.operation === 'clear-policy-tombstones' && !arguments_.apply;
    spool = dryRun ? readOnlySpool(config.stateDir) : new SqliteSpool(config.stateDir);
    if (spool === null) {
      if (text) process.stdout.write('No collector state yet: nothing to clear.\n');
      else print({ initialized: false });
      return;
    }
    if (isControl(arguments_.operation)) {
      const answer = CONTROLS[arguments_.operation](spool, arguments_.operand);
      if (text) process.stdout.write(answer + '\n');
      else print(spool.controls());
      return;
    }
    const collector = new Collector(config, spool, new HttpIngester(config), Math.random, new LocalGitMetadata('git', 1000, 65536), new HttpProgressReporter(config), new FileSecretReader());
    const printStatus = (): void => {
      const status = collector.status();
      if (text) process.stdout.write(formatCollectorStatus(status));
      else print(status);
    };
    if (arguments_.operation === 'status') { printStatus(); return; }
    if (arguments_.operation === 'clear-policy-tombstones') {
      const report = clearPolicyTombstones(collector, spool, arguments_.apply);
      if (text) process.stdout.write(formatTombstones(report));
      else print(report);
      return;
    }
    if (arguments_.operation === 'retry' || arguments_.operation === 'drop') {
      if (arguments_.operand === null) throw new CollectorError('request-id-required');
      if (arguments_.operation === 'retry') spool.retry(arguments_.operand);
      else spool.drop(arguments_.operand, 'operator-drop');
      printStatus(); return;
    }
    // Keep OS signal termination: SQLite preserves pending work and releases the
    // daemon lock even while a synchronous scan cannot yield to a JS handler.
    for (;;) {
      const result = await collector.runOnce(Date.now()); print(result);
      if (arguments_.operation === 'once') {
        if (result.uploadFailures + result.quarantined + result.deferred + result.pending + result.stopped + result.conflicts > 0 || spool.diagnostics().some(d => d.rootId === 'reporting')) process.exitCode = 1;
        return;
      }
      await sleep(config.pollMs);
    }
  } finally { if (spool !== null) spool.close(); if (lock !== null) lock.close(); }
}
void main().catch((error: unknown) => {
  if (error instanceof UsageError) { process.stderr.write(`${PROGRAM}: ${error.message}\nTry '${PROGRAM} --help'.\n`); process.exitCode = 2; return; }
  process.stderr.write(JSON.stringify({ code: error instanceof CollectorError ? error.code : 'collector-failed' }) + '\n');
  process.exitCode = 1;
});
