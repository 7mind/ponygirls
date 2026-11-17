import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleWidth } from '@earendil-works/pi-tui';
import { PLAIN_THEME } from '@ponygirls/pi-ui';
import { historianStatusView, styleHistorianStatus, styleHistorianJournal } from '../src/presentation.ts';

const theme = { fg: (color, text) => `<${color}>${text}</${color}>`, bold: text => `<bold>${text}</bold>` };
test('status separates groups and gives errors, coverage and enabled state distinct semantics', () => {
  const text = 'Historian ON (session)\nProject: /project\nActivity: idle\nError: provider timeout\nMarkdown projection error: none\nCoverage: not capturing';
  const styled = styleHistorianStatus(text, theme);
  assert.match(styled, /<success>Historian ON/);
  assert.match(styled, /\n\n<accent>Project:/);
  assert.match(styled, /<error>provider timeout/);
  assert.match(styled, /<muted>none/);
  assert.match(styled, /<warning>not capturing/);
  assert.match(styleHistorianStatus('Historian OFF (default)', theme), /<muted>Historian OFF/);
  assert.match(styleHistorianStatus('Historian ERROR: invalid preferences', theme), /<error>Historian ERROR/);
});
test('journal styling preserves every evidence and qualification line', () => {
  const text = '# Historian project journal\n\n## Experiment — ongoing\nEpisode e, revision 2\n### objective (reported)\nA claim\n- Evidence ref: session s, entry x, SHA-256 digest\n  - Coverage: truncated';
  const styled = styleHistorianJournal(text, theme);
  assert.equal(styled.replace(/<\/?\w+>/g, ''), text);
  assert.match(styled, /<accent>### objective \(reported\)/);
  assert.match(styled, /<muted>- Evidence/);
  assert.match(styled, /<warning>  - Coverage:/);
});

// Specified Behavioral-Active / Blackbox-Group: the status pane is rendered through the shared facts view.
const HOME = '/home/u';
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const HASH = '4be1c0a97d3f52e86a1b09c4d7f3e2a5b8c6d1e0f9a7b4c3d2e1f0a9b8c7d6e5';
const WIDTHS = [60, 80, 100, 120, 170];
/** The status text captured before this view existed; it stays available behind `d`. */
const OBSERVED = `Historian OFF (global)
Project: /home/u/work/flakes/ponygirls/.git
Journal: /home/u/.pi/agent/historian/projects/${HASH}/journal.md
Disclosure approval: approved
Model origin: managed
Focus source: default
Model: openai-codex/gpt-6.1-sol (medium) (global)
Activity: idle; pending events: 0
Last commit this runtime: none; failed attempts: 0/3
Chronicle upload: ON (private global settings; new commits only)
Chronicle destination: https://chronicle.example/api/ingest
Chronicle delivery: idle; pending: 0; stopped: 0; acknowledged: 0; paused/other destinations: 0
Chronicle error: none
Only summary claims and provenance references are sent, never underlying evidence bodies. Existing claims may recur in new revisions. Chronicle indexing providers and account sharing apply. OFF retains queued work, does not retract admitted requests or delete remote copies.
Attempt totals: 0; validated: 0; failed: 0; recovered: 0; cancelled: 0; interrupted: 0; running: 0
This session, since diagnostics began. Admissions, not wire requests (SDK retries may occur). Validated is not published; interrupted means outcome unknown. Recovery means a later validated response for the same batch.
Error: none
Markdown projection error: none
Coverage: not capturing
Configured provider receives this session family’s eligible evidence and shared published project episodes. Journals are historical, not current-state verification.`;
const quiet = Object.freeze({
  kind: 'ready', enabled: false, enabledSource: 'global', disclosureApproved: true,
  model: { provider: 'openai-codex', id: 'gpt-6.1-sol', thinking: 'medium' },
  project: '/home/u/work/flakes/ponygirls/.git', journal: `/home/u/.pi/agent/historian/projects/${HASH}/journal.md`, projectDigest: HASH,
  capturing: false, coverageNotices: 0, activity: 'idle', pendingEvents: 0, lastCommit: null, failures: 0, maxFailures: 3,
  chronicle: { kind: 'ready', enabled: true, endpoint: 'https://chronicle.example/api/ingest', uploading: false,
    queue: { pending: 0, stopped: 0, acknowledged: 0, otherDestinations: 0 }, error: null },
  attempts: { total: 0, running: 0, validated: 0, failed: 0, cancelled: 0, interrupted: 0, recovered: 0 },
  error: null, projectionError: null,
});
const busy = Object.freeze({
  ...quiet, enabled: true, enabledSource: 'session', capturing: true, coverageNotices: 2, activity: 'journaling', pendingEvents: 2,
  lastCommit: '2026-11-17T11:58:00.000Z',
  chronicle: { ...quiet.chronicle, uploading: true, queue: { pending: 3, stopped: 0, acknowledged: 1200, otherDestinations: 2 } },
  attempts: { total: 5, running: 1, validated: 3, failed: 1, cancelled: 0, interrupted: 0, recovered: 1 },
});
const failing = Object.freeze({
  ...busy, failures: 1, error: 'Historian provider returned an error; response body not retained', projectionError: 'EACCES: permission denied, open journal.md',
  chronicle: { ...busy.chronicle, queue: { ...busy.chronicle.queue, stopped: 1 }, error: 'upload-storage-unavailable' },
});
/** Zero-width, distinguishable SGR codes per token, so widths stay real. */
const CODES = { text: 1, muted: 2, dim: 3, accent: 4, border: 5, success: 6, warning: 7, error: 8 };
const colored = (color, text) => `\x1b[38;5;${CODES[color]}m${text}\x1b[39m`;
const COLORS = { fg: colored, bg: (_color, text) => text, bold: text => text };
const view = (status, theme) => historianStatusView({ status, text: OBSERVED, home: HOME, nowMs: NOW },
  { theme, keys: { matches: () => false }, rows: () => 400, requestRender() {}, close() {} });
const plain = (status, width) => view(status, PLAIN_THEME).render(width);
/** The value of one labelled fact, unwrapped. */
const fact = (status, label) => {
  const row = plain(status, 400).map(line => new RegExp(`^ {2}${label} {2,}(.*)$`).exec(line)).find(match => match !== null);
  return row === undefined ? null : row[1];
};

test('the quiet OFF status reads state first, as the specified 120-column pane', () => {
  assert.deepEqual(plain(quiet, 120), [
    `── Historian ${'─'.repeat(91)} off · global ──`,
    '  State      off (global setting) · not capturing this session',
    '  Model      openai-codex/gpt-6.1-sol · medium · disclosure approved',
    '  Project    ~/work/flakes/ponygirls',
    '  Journal    ~/.pi/agent/historian/projects/4be1c0a9…/journal.md',
    '',
    '  Activity   idle · nothing pending · no commits this run',
    '  Chronicle  upload on → chronicle.example · idle · nothing pending',
    '  Attempts   none this session',
    '─'.repeat(120),
    '↑↓ scroll  d details  esc close',
  ]);
});

test('facts and details fit every supported width for quiet, busy, failing and fault states', () => {
  const fault = { kind: 'fault', message: `Invalid Historian defaults at ${HOME}/.pi/agent/historian.json: unexpected end of JSON input` };
  for (const [name, status] of Object.entries({ quiet, busy, failing, fault })) for (const theme of [PLAIN_THEME, COLORS]) for (const width of WIDTHS) {
    const pane = view(status, theme);
    const facts = pane.render(width);
    assert.equal(visibleWidth(facts[0]), width, `${name} title at ${width}`);
    assert.ok(facts.every(line => visibleWidth(line) <= width), `${name} facts at ${width}`);
    assert.match(facts[0].replace(/\x1b\[[0-9;]*m/g, ''), /^── Historian ─/, `${name} keeps its name at ${width}`);
    pane.handleInput('d');
    const details = pane.render(width);
    assert.ok(details.every(line => visibleWidth(line) <= width), `${name} details at ${width}`);
  }
});

test('details are the complete earlier status text under the same title', () => {
  const pane = view(quiet, PLAIN_THEME);
  pane.handleInput('d');
  const details = pane.render(400);
  assert.equal(details[0].startsWith('── Historian ─'), true);
  assert.equal(details.at(-1), '↑↓ scroll  d facts  esc close');
  // The status styling separates groups with blank lines; no status line may be lost or reworded.
  assert.deepEqual(details.slice(1, -2).map(line => line.trimEnd()).filter(line => line !== ''), OBSERVED.split('\n'));
});

test('zero counters collapse into words and non-zero counters carry their number', () => {
  assert.equal(fact(quiet, 'Activity'), 'idle · nothing pending · no commits this run');
  assert.equal(fact(quiet, 'Attempts'), 'none this session');
  assert.equal(fact(busy, 'State'), 'on (session setting) · capturing this session · 2 coverage notices');
  assert.equal(fact(busy, 'Activity'), 'journaling · 2 pending · last commit 2m ago');
  assert.equal(fact(busy, 'Chronicle'), 'upload on → chronicle.example · uploading · 3 pending · 1,200 acknowledged · 2 for other destinations');
  assert.equal(fact(busy, 'Attempts'), '5 this session · 3 validated · 1 failed · 1 recovered · 1 running');
  assert.match(plain(busy, 120)[0], / on · session ──$/);
  assert.equal(fact(failing, 'Activity'), 'journaling · 2 pending · last commit 2m ago · 1 failed of 3 attempts');
  assert.equal(fact(failing, 'Chronicle'), 'upload on → chronicle.example · uploading · 3 pending · 1 stopped · 1,200 acknowledged · 2 for other destinations');
  assert.equal(fact({ ...busy, coverageNotices: 1 }, 'State'), 'on (session setting) · capturing this session · 1 coverage notice');
  assert.equal(fact({ ...quiet, activity: 'draining' }, 'Activity'), 'cancelled, waiting for provider drain · nothing pending · no commits this run');
  assert.doesNotMatch(plain(quiet, 120).join('\n'), /\b0\b|none(?! this session)|: /, 'no zero counters, bare "none" values or label: value sentences');
});

test('an error is its own fact in the error colour, first in its group, and absent when there is none', () => {
  const lines = view(failing, COLORS).render(400);
  assert.ok(lines[0].includes(colored('warning', 'attention')), 'the title state asks for attention');
  const labels = lines.slice(1, -2).map(line => /^ {2}\x1b\[38;5;3m([^\x1b]+)\x1b/.exec(line)?.[1] ?? '');
  assert.deepEqual(labels, ['Error', 'Markdown error', 'State', 'Model', 'Project', 'Journal', '', 'Chronicle error', 'Activity', 'Chronicle', 'Attempts']);
  assert.ok(lines[1].includes(colored('error', 'Historian provider returned an error; response body not retained')));
  assert.ok(lines[2].includes(colored('error', 'EACCES: permission denied, open journal.md')));
  assert.ok(lines[8].includes(colored('error', 'upload-storage-unavailable')));
  assert.ok(lines.some(line => line.includes(colored('error', '1 failed of 3 attempts'))));
  assert.ok(lines.some(line => line.includes(colored('warning', '1 stopped'))));
  for (const status of [quiet, busy]) {
    const calm = view(status, COLORS).render(400).join('\n');
    assert.doesNotMatch(calm, /[Ee]rror|\x1b\[38;5;[78]m/, 'no error row, word, or error/attention colour without a fault');
  }
  assert.ok(view(busy, COLORS).render(400)[0].includes(colored('success', 'on · session')));
  assert.ok(view(busy, COLORS).render(400).some(line => line.includes(colored('success', 'on (session setting)'))));
  assert.ok(view(busy, COLORS).render(400).some(line => line.includes(colored('accent', 'journaling'))));
  assert.ok(view(quiet, COLORS).render(400)[0].includes(colored('muted', 'off · global')));
});

test('missing disclosure approval needs attention only while Historian is on', () => {
  const requested = view({ ...busy, disclosureApproved: false, capturing: false, coverageNotices: 0 }, COLORS).render(400);
  assert.ok(requested[0].includes(colored('warning', 'attention')));
  assert.ok(requested.some(line => line.includes(colored('warning', 'disclosure approval required'))));
  const unapproved = { ...quiet, disclosureApproved: false, model: null };
  const off = view(unapproved, COLORS).render(400);
  assert.ok(off[0].includes(colored('muted', 'off · global')));
  assert.doesNotMatch(off.join('\n'), /\x1b\[38;5;7m/);
  assert.equal(fact(unapproved, 'Model'), 'not configured · disclosure approval required');
});

test('paths are home-relative, the project hash is shortened and the destination is its host', () => {
  assert.equal(fact(quiet, 'Project'), '~/work/flakes/ponygirls');
  assert.equal(fact({ ...quiet, project: '/srv/git/tools.git' }, 'Project'), '/srv/git/tools.git');
  assert.equal(fact({ ...quiet, project: '/home/u/notes' }, 'Project'), '~/notes');
  assert.equal(fact(quiet, 'Journal'), '~/.pi/agent/historian/projects/4be1c0a9…/journal.md');
  assert.equal(fact({ ...quiet, journal: `/var/journals/projects/${HASH}/journal.md` }, 'Journal'), '/var/journals/projects/4be1c0a9…/journal.md');
  const destination = endpoint => fact({ ...quiet, chronicle: { ...quiet.chronicle, enabled: false, endpoint } }, 'Chronicle');
  assert.equal(destination('http://127.0.0.1:8787/api/ingest'), 'upload off → 127.0.0.1:8787 · idle · nothing pending');
  assert.equal(destination(''), 'upload off · no destination · idle · nothing pending');
});

test('unknown journal state and unusable upload settings are said, never shown as zero', () => {
  const closed = { ...quiet, chronicle: { ...quiet.chronicle, queue: null }, attempts: null };
  assert.equal(fact(closed, 'Chronicle'), 'upload on → chronicle.example · idle · queue unknown');
  assert.equal(fact(closed, 'Attempts'), 'journal not open');
  const unusable = { ...quiet, chronicle: { kind: 'unavailable' } };
  assert.equal(fact(unusable, 'Chronicle'), 'upload unavailable · invalid settings');
  assert.match(plain(unusable, 120)[0], / attention ──$/);
});

test('a configuration fault shows the error alone and asks for attention', () => {
  const lines = plain({ kind: 'fault', message: 'Invalid Historian defaults' }, 80);
  assert.match(lines[0], /^── Historian ─+ attention ──$/);
  assert.deepEqual(lines.slice(1, -2), ['  Error  Invalid Historian defaults']);
  assert.ok(view({ kind: 'fault', message: 'Invalid Historian defaults' }, COLORS).render(80)[1].includes(colored('error', 'Invalid Historian defaults')));
});
