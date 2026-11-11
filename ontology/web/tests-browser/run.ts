import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { preview } from 'vite';
import { chromium, type Page, type Route } from 'playwright-core';
import * as C from '../src/contracts.js';
import type { Codec } from '../src/client.js';
import { checkTheme, checkNarrowLayout, type ThemeObservation } from './theme.js';
import { assessmentRecords } from './assessment-fixture.js';

async function main(): Promise<void> {
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned development shell; browser downloads are not allowed.');
const root = process.cwd();
await mkdir(path.join(root, 'test-results'), { recursive: true });
const report = await mkdtemp(path.join(root, 'test-results', 'browser-'));
async function inputIdentity(): Promise<{ path: string; sha256: string }[]> {
  const files: string[] = [];
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) files.push(child);
      else throw new Error(`Nonregular validation input: ${child}`);
    }
  }
  for (const directory of ['src', 'tests', 'tests-browser', '../generated/typescript', 'dist']) await visit(directory);
  files.push('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.fixtures.json', 'vite.config.ts');
  return Promise.all(files.sort().map(async relative => ({ path: relative, sha256: createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex') })));
}
const sourceIdentity = await inputIdentity();
await writeFile(path.join(report, 'inputs.json'), JSON.stringify(sourceIdentity, null, 2) + '\n');
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ref = (n: number) => new C.Ref(id(n), 1);
const time = '2026-11-11T00:00:00Z';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const human = new C.Actor('operator', C.ActorKind.Human);
const agent = new C.Actor('curator', C.ActorKind.Agent);
const host = new C.Actor('fixture-service', C.ActorKind.Service);
const unknown = new C.Actor('unattributed-fixture', C.ActorKind.Unknown);
const provenance = (actor: C.Actor, receipt: number) => new C.Provenance(actor, host, id(receipt), time);
const context = new C.ContextRecord(new C.OriginContext_ReportedNative(new C.CaptureContext('fixture-session', undefined, undefined, C.LineageStatus.Unknown, 'fixture-branch', id(21))), []);
const contribution = new C.ContextRecord(new C.OriginContext_ReportedNative(new C.CaptureContext('submission-session-B', undefined, undefined, C.LineageStatus.Unknown, 'submission-branch', id(23))), [new C.ReportedInheritance(C.InheritanceKind.Import, 'source-archive', 2n, 1n, 0n, [], [ref(40)], undefined)]);
const ingress = new C.RequestTrace(id(24), '/api/v1/ingest', C.RequestTransport.Bearer);
const metadata = new C.CaptureMetadata('fixture-entry', undefined, undefined, C.SourceRepresentation.PiTranscript, ['Synthetic browser fixture; not a native capture'], []);
const sourceText = 'Keep the audit trail. This is controlled test content, not a Human study.';
const source = C.Definition.fromPlain({ ref: ref(20), scope: 'a', applicability: new C.Applicability_Captured(ref(20)), content: C.Content_Source.fromPlain({ text: sourceText, context: [], rawDigest: digest(sourceText), eventId: id(20), sourceNamespace: 'fixture-collector', captureContext: context, metadata, origin: C.EventOrigin.UserMessage, observation: new C.Observation_None() }), standing: C.Standing.Active, basis: [], changeReason: undefined, provenance: provenance(unknown, 91) });
const goal = C.Definition.fromPlain({ ref: ref(1), scope: 'a', applicability: new C.Applicability_Unresolved('Fixture has not established semantic applicability', [], []), content: C.Content_Outcome.fromPlain({ text: 'Preserve the audit trail', acceptance: new C.Acceptance(['Retain evidence and unresolved intent'], undefined), force: C.Force.Required }), standing: C.Standing.Active, basis: [source.ref], changeReason: undefined, provenance: provenance(agent, 90) });
const contract = new C.Binding(ref(30), 'a', goal.ref, [], 'worker-fixture', provenance(agent, 90));
const selected = new C.BindingSelection(ref(31), 'a', contract.ref, true, 'Explicit synthetic contract selection', [goal.ref], provenance(agent, 90));
const records: C.GraphRecord[] = [new C.GraphRecord_Node(goal), new C.GraphRecord_Node(source), new C.GraphRecord_Contract(contract), new C.GraphRecord_Selection(selected), ...assessmentRecords('a', ref, provenance(agent, 90))];
const sourceEvent = C.CapturedEvent.fromPlain({ id: id(20), scope: 'a', sourceNamespace: 'fixture-collector', frontier: 1n, context, origin: C.EventOrigin.UserMessage, metadata, text: sourceText, observation: new C.Observation_None(), provenance: source.provenance });
const absentEvent = C.CapturedEvent.fromPlain({ id: id(22), scope: 'a', sourceNamespace: 'fixture-host', frontier: 2n, context, origin: C.EventOrigin.ToolOutput, metadata: new C.CaptureMetadata('absence-entry', undefined, undefined, C.SourceRepresentation.HostReceipt, ['Synthetic witness, not a physical measurement'], []), text: 'Reported absence', observation: new C.Observation_FileAbsent('report.txt', 2n), provenance: provenance(host, 92) });
const identity = new C.Identity(human, ['a', 'b'], [C.Capability.Read, C.Capability.Review]);
const versions = new C.VersionInfo('0.1.0', '0.1.0', ['0.1.0']);
const errors: string[] = [];
const receipts: string[] = [];
const themes: ThemeObservation[] = [];
let activePage: Page | null = null;
let authenticated = false;
let generation = 5n;
let saved: C.Presentation | undefined;
let droppedAcknowledgment = false;
let badScope = false;
const submissions: unknown[] = [];
const encode = <T>(codec: Codec<T>, value: T): unknown => codec.encode(C.BaboonCodecContext.Default, value);
const decode = <T>(codec: Codec<T>, value: unknown): T => codec.decode(C.BaboonCodecContext.Default, value);
const reply = <T>(route: Route, codec: Codec<T>, value: T, status: number) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(encode(codec, value)), headers: { 'Cache-Control': 'no-store' } });
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
const address = server.httpServer.address();
assert(address !== null && typeof address === 'object');
const url = `http://127.0.0.1:${address.port}/`;
const browser = await chromium.launch({ headless: true });
try {
  const browserContext = await browser.newContext({ colorScheme: 'dark', viewport: { width: 1280, height: 1000 } });
  const page = await browserContext.newPage();
  activePage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/*', async route => {
    const request = route.request();
    const operation = new URL(request.url()).pathname.split('/').at(-1);
    assert.equal(request.headers()['x-ontology-version'], '0.1.0');
    const body = request.postData();
    const data: unknown = body === null ? null : JSON.parse(body);
    if (operation === 'login') {
      assert.equal(typeof decode(C.LoginRequest.jsonCodec(), data).token, 'string');
      authenticated = true;
      return reply(route, C.LoginResult.jsonCodec(), new C.LoginResult(identity, versions), 200);
    }
    if (!authenticated) return reply(route, C.Failure.jsonCodec(), new C.Failure('unauthorized', 'Fixture authentication required'), 401);
    if (operation === 'whoami') return reply(route, C.Identity.jsonCodec(), identity, 200);
    assert.equal(request.headers()['x-ontology-actor'], human.id);
    if (operation === 'scopes') {
      const a = new C.ScopeSummary('a', generation, 2n, 2n, C.CurationState.Idle, undefined, generation);
      const b = new C.ScopeSummary('b', 0n, 0n, 0n, C.CurationState.Idle, undefined, 0n);
      return reply(route, C.ScopesResult.jsonCodec(), new C.ScopesResult([a, b]), 200);
    }
    if (operation === 'status') {
      const input = decode(C.ScopeRequest.jsonCodec(), data);
      return reply(route, C.CurationStatus.jsonCodec(), new C.CurationStatus(input.scope, input.scope === 'a' ? generation : 0n, input.scope === 'a' ? 2n : 0n, input.scope === 'a' ? 2n : 0n, C.CurationState.Idle, undefined), 200);
    }
    if (operation === 'read') {
      const input = decode(C.ReadRequest.jsonCodec(), data);
      let selected: C.GraphRecord[] = input.scope === 'a' ? records : [];
      if (input.targets.length > 0) {
        const wanted = new Set(input.targets.map(value => value.id));
        selected = selected.filter(value => wanted.has(value.value.ref.id));
        for (const [number, actor] of [[90, agent], [91, unknown], [92, host]] as const) {
          if (wanted.has(id(number))) {
            const content = JSON.stringify({ fixture: true, content: number === 90 ? goal.content.text : sourceText });
            const receiptIngress = number === 92 ? new C.RequestTrace(id(25), 'controlled-internal-call', C.RequestTransport.Internal) : ingress;
            const receiptContext = number === 90 ? new C.ContextRecord(new C.OriginContext_Unknown('No contribution session supplied'), []) : number === 92 ? new C.ContextRecord(new C.OriginContext_ServiceRequest(receiptIngress), []) : contribution;
            const value = new C.InputReceipt(ref(number), 'a', 1n, C.InputKind.Capture, actor, host, actor, 'controlled browser fixture', content, digest(content), time, receiptContext, receiptIngress);
            selected.push(new C.GraphRecord_Input(value));
          }
        }
      }
      return reply(route, C.ReadResult.jsonCodec(), new C.ReadResult(badScope && input.scope === 'b' ? 'a' : input.scope, input.scope === 'a' ? generation : 0n, selected, undefined), 200);
    }
    if (operation === 'find') {
      const input = decode(C.FindRequest.jsonCodec(), data);
      const items = input.scope === 'a' && goal.content.text.toLowerCase().includes(input.query.toLowerCase()) ? [new C.SearchHit(goal.ref, 'outcome', goal.content.text, C.Standing.Active, goal.applicability)] : [];
      return reply(route, C.FindResult.jsonCodec(), new C.FindResult(input.scope, generation, items, undefined), 200);
    }
    if (operation === 'sources') {
      const input = decode(C.SourceRequest.jsonCodec(), data);
      return reply(route, C.SourceResult.jsonCodec(), new C.SourceResult(input.scope, input.scope === 'a' ? [sourceEvent, absentEvent] : [], input.scope === 'a' ? 2n : 0n, undefined), 200);
    }
    if (operation === 'present') {
      const input = decode(C.PresentRequest.jsonCodec(), data);
      saved = new C.Presentation(id(40), input.scope, input.expectedGeneration, input.targets, records.filter(value => input.targets.some(target => target.id === value.value.ref.id)), [source.ref], time);
      return reply(route, C.Presentation.jsonCodec(), saved, 200);
    }
    if (operation === 'judge') {
      const input = decode(C.JudgmentRequest.jsonCodec(), data);
      assert(saved !== undefined);
      assert.equal(input.presentationId, saved.id);
      submissions.push(data);
      const judgment = new C.Judgment(id(50), input.scope, input.requestId, input.presentationId, input.kind, input.rationale, human, time);
      if (!droppedAcknowledgment) { droppedAcknowledgment = true; return route.abort('failed'); }
      assert.deepEqual(submissions[1], submissions[0]);
      return reply(route, C.Judgment.jsonCodec(), judgment, 200);
    }
    if (operation === 'judgments') return reply(route, C.JudgmentsResult.jsonCodec(), new C.JudgmentsResult([]), 200);
    if (operation === 'logout') { authenticated = false; return reply(route, C.Ack.jsonCodec(), new C.Ack(true), 200); }
    throw new Error(`Unexpected fixture operation ${operation}`);
  });
  let releaseScripts!: () => void;
  const scriptGate = new Promise<void>(resolve => { releaseScripts = resolve; });
  await page.route('**/assets/*.js', async route => { await scriptGate; await route.continue(); });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'dark');
  themes.push(await checkTheme(page, 'dark'));
  assert.equal(await page.locator('#root').evaluate(element => element.childElementCount), 0);
  await page.screenshot({ path: path.join(report, 'dark-before-react.png') });
  receipts.push('dark preference applied before React');
  releaseScripts();
  await page.getByRole('heading', { name: 'Connect your identity', exact: true }).waitFor();
  await page.getByLabel('Host-issued token', { exact: true }).fill(Buffer.alloc(32, 8).toString('base64url'));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('combobox', { name: 'Authorized scope', exact: true }).selectOption('a');
  const recordRegion = page.getByRole('region', { name: 'Ontology records', exact: true });
  await recordRegion.locator('article.record-card').filter({ has: page.getByRole('button', { name: `Inspect exact revision ${id(31)}@1`, exact: true }) }).getByRole('heading', { name: 'Selection event · selected', exact: true }).waitFor();
  await recordRegion.getByText('worker-fixture', { exact: true }).waitFor();
  await recordRegion.getByText('Declared assessment use', { exact: true }).waitFor();
  await recordRegion.getByText('Applicable', { exact: true }).waitFor();
  await recordRegion.getByText('Recorded gate evidence', { exact: true }).waitFor();
  await recordRegion.getByText('Selected-contract witnesses', { exact: true }).waitFor();
  receipts.push('assessment use remains qualified and gate evidence roles stay separate');
  await recordRegion.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Intent · Outcome', exact: true }) }).getByLabel('Include exact revision in review', { exact: true }).check();
  await page.getByRole('button', { name: 'Prepare exact presentation', exact: true }).click();
  await page.getByRole('heading', { name: 'Presented snapshot', exact: true }).waitFor();
  const rationale = page.getByRole('textbox', { name: 'Rationale', exact: true });
  await rationale.fill('Need the actual evidence before acceptance.');
  await rationale.focus();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'light');
  assert.equal(await rationale.inputValue(), 'Need the actual evidence before acceptance.');
  assert.equal(await rationale.evaluate(element => element === document.activeElement), true);
  themes.push(await checkTheme(page, 'light'));
  await page.screenshot({ path: path.join(report, 'light-review.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'dark');
  assert.equal(await rationale.inputValue(), 'Need the actual evidence before acceptance.');
  assert.equal(await rationale.evaluate(element => element === document.activeElement), true);
  themes.push(await checkTheme(page, 'dark'));
  await page.screenshot({ path: path.join(report, 'dark-review.png') });
  receipts.push('live theme changes preserve review text and focus');
  await page.setViewportSize({ width: 390, height: 844 });
  await rationale.scrollIntoViewIfNeeded();
  await checkNarrowLayout(page);
  assert.equal(await rationale.inputValue(), 'Need the actual evidence before acceptance.');
  await page.screenshot({ path: path.join(report, 'narrow-dark-review.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'light');
  await checkNarrowLayout(page);
  await page.screenshot({ path: path.join(report, 'narrow-light-review.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  receipts.push('narrow light and dark review retain the draft without horizontal overflow');
  assert.equal(await page.getByRole('combobox', { name: 'Authorized scope', exact: true }).isDisabled(), true);
  generation = 6n;
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.getByText('This review remains pinned to 5;', { exact: false }).waitFor();
  assert(saved !== undefined);
  assert.equal(saved.generation, 5n);
  await page.getByRole('radio', { name: 'Need evidence State what evidence or qualification is missing.', exact: true }).check();
  await page.getByRole('button', { name: 'Submit Human judgment', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same judgment', exact: true }).waitFor();
  assert.equal(await rationale.isDisabled(), true);
  await page.getByRole('button', { name: 'Retry same judgment', exact: true }).click();
  await page.getByRole('heading', { name: 'Judgment acknowledged by the server', exact: true }).waitFor();
  assert.equal(submissions.length, 2);
  receipts.push('uncertain judgment retry preserves request ID and complete payload');
  await page.getByRole('button', { name: 'Close acknowledged review…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Close this acknowledged review?', exact: true }).getByRole('button', { name: 'Close acknowledged review', exact: true }).click();
  await page.getByRole('button', { name: 'Load captured sources', exact: true }).click();
  await page.getByText('Reported absence', { exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('region', { name: 'Captured sources', exact: true }).locator('details').filter({ hasText: 'Reported absence' }).locator(':scope > summary').click();
  await page.getByText('Reported file absence', { exact: true }).waitFor();
  receipts.push('source representation, unknown lineage and typed absence remain inspectable');
  await recordRegion.getByText('fixture-session', { exact: true }).waitFor();
  await recordRegion.getByText('Reported native context — not independently observed', { exact: true }).waitFor();
  await recordRegion.getByRole('button', { name: `Inspect exact revision ${id(91)}@1`, exact: true }).click();
  const inspection = page.getByRole('dialog', { name: 'Inspect exact historical reference', exact: true });
  await inspection.getByText('submission-session-B', { exact: true }).waitFor();
  await inspection.getByText('Contribution context', { exact: true }).waitFor();
  await inspection.getByText('Actual server ingress', { exact: true }).waitFor();
  await inspection.getByText('/api/v1/ingest', { exact: true }).waitFor();
  await inspection.getByText('source-archive', { exact: true }).waitFor();
  assert.equal(await inspection.getByRole('button', { name: `Inspect exact revision ${id(40)}@1`, exact: true }).count(), 0);
  await inspection.getByRole('button', { name: 'Close', exact: true }).click();
  await recordRegion.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Intent · Outcome', exact: true }) }).getByRole('button', { name: `Inspect exact revision ${id(90)}@1`, exact: true }).click();
  await inspection.getByText('Context unknown', { exact: true }).waitFor();
  await inspection.getByText('No session, branch, epoch or lineage is inferred.', { exact: true }).waitFor();
  assert.equal(await inspection.getByText('Session identifier', { exact: true }).count(), 0);
  await inspection.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('region', { name: 'Captured sources', exact: true }).getByRole('button', { name: `Inspect exact revision ${id(92)}@1`, exact: true }).click();
  await inspection.getByText('Server-owned request context', { exact: true }).waitFor();
  assert.equal(await inspection.getByText('Session identifier', { exact: true }).count(), 0);
  await inspection.getByRole('button', { name: 'Close', exact: true }).click();
  receipts.push('source occurrence, contribution and server ingress stay separate; unknown context and cross-namespace cuts remain qualified');
  badScope = true;
  await page.getByRole('combobox', { name: 'Authorized scope', exact: true }).selectOption('b');
  await page.getByText('Record response scope mismatch.', { exact: true }).waitFor();
  receipts.push('cross-scope response rejected');
  const lightContext = await browser.newContext({ colorScheme: 'light', viewport: { width: 390, height: 844 } });
  await lightContext.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(globalThis, key, { get() { throw new DOMException('Storage unavailable in this fixture', 'SecurityError'); } });
  });
  const lightPage = await lightContext.newPage();
  lightPage.on('pageerror', error => errors.push(error.message));
  await lightPage.route('**/api/v1/*', route => reply(route, C.Failure.jsonCodec(), new C.Failure('unauthorized', 'Fixture login required'), 401));
  let releaseLightScripts!: () => void;
  const lightGate = new Promise<void>(resolve => { releaseLightScripts = resolve; });
  await lightPage.route('**/assets/*.js', async route => { await lightGate; await route.continue(); });
  await lightPage.goto(url, { waitUntil: 'commit' });
  await lightPage.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'light');
  assert.equal(await lightPage.locator('#root').evaluate(element => element.childElementCount), 0);
  themes.push(await checkTheme(lightPage, 'light'));
  await lightPage.screenshot({ path: path.join(report, 'light-before-react.png') });
  releaseLightScripts();
  await lightPage.getByRole('heading', { name: 'Connect your identity', exact: true }).waitFor();
  await checkNarrowLayout(lightPage);
  await lightPage.screenshot({ path: path.join(report, 'narrow-light-login.png') });
  await lightContext.close();
  receipts.push('initial light palette and login work with inaccessible storage');
  receipts.push('declared text and control palette contrasts meet their thresholds');
  assert.deepEqual(errors, []);
  assert.deepEqual(await inputIdentity(), sourceIdentity);
  await writeFile(path.join(report, 'summary.json'), JSON.stringify({ passed: receipts, browserErrors: errors, themes, node: process.version, chromium: browser.version(), inputIdentity: 'inputs.json', transport: 'owned scripted API fixture', builtAssets: true, realBackendIntegration: false, humanStudy: false }, null, 2) + '\n');
  console.log(JSON.stringify({ report, passed: receipts.length, realBackendIntegration: false }));
  await browserContext.close();
} catch (error) {
  await writeFile(path.join(report, 'failure.txt'), String(error instanceof Error ? error.stack : error) + '\n');
  await writeFile(path.join(report, 'failure-observations.json'), JSON.stringify({ receipts, errors, submissions, savedGeneration: saved === undefined ? null : saved.generation.toString() }, null, 2) + '\n');
  if (activePage !== null && !activePage.isClosed()) {
    await writeFile(path.join(report, 'failure.html'), await activePage.content());
    await activePage.screenshot({ path: path.join(report, 'failure.png'), fullPage: true });
  }
  throw error;
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
}
await main();
