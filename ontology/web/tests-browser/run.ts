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
const source = C.Definition.fromPlain({ ref: ref(20), scope: 'a', applicability: new C.Applicability_Captured(ref(20)), content: C.Content_Source.fromPlain({ text: sourceText, context: [], rawDigest: digest(sourceText), descriptor: new C.SourceDescriptor_PrimaryCapture(id(20), 'fixture-collector', context, metadata, C.EventOrigin.UserMessage, new C.Observation_None(), undefined) }), standing: C.Standing.Active, basis: [], changeReason: undefined, provenance: provenance(unknown, 91) });
const goal = C.Definition.fromPlain({ ref: ref(1), scope: 'a', applicability: new C.Applicability_Unresolved('Fixture has not established semantic applicability', [], []), content: C.Content_Outcome.fromPlain({ text: 'Preserve the audit trail', acceptance: new C.Acceptance(['Retain evidence and unresolved intent'], undefined), force: C.Force.Required }), standing: C.Standing.Active, basis: [source.ref], changeReason: undefined, provenance: provenance(agent, 90) });
const contract = new C.Binding(ref(30), 'a', goal.ref, [], 'worker-fixture', provenance(agent, 90));
const selected = new C.BindingSelection(ref(31), 'a', contract.ref, true, 'Explicit synthetic contract selection', [goal.ref], provenance(agent, 90));
const question = new C.Definition(ref(70), 'a', new C.Applicability_Unresolved('Controlled choice fixture', [], []), new C.Content_Question('Choose an exact alternative', ['A', 'B'], undefined, C.Escalation.HumanRequired), C.Standing.Active, [source.ref], undefined, provenance(agent, 90));
const questionBinding = new C.Binding(ref(71), 'a', question.ref, [], 'alternative-work', provenance(agent, 90));
const questionSelection = new C.BindingSelection(ref(72), 'a', questionBinding.ref, true, 'Controlled question binding selection', [question.ref], provenance(agent, 90));
const plan = new C.Definition(ref(170), 'a', new C.Applicability_Unresolved('Controlled plan account', [], []), new C.Content_Decision('Context-qualified plan', ['Alternative plan'], 'Fixture choice account'), C.Standing.Active, [source.ref], undefined, provenance(agent, 90));
const planRequirement = new C.Relation(ref(171), 'a', new C.Applicability_Unresolved('Only the declared plan context', [], []), C.RelationKind.Requires, [plan.ref], [ref(142)], new C.RelationDetail_PlanRequirement('plan-A'), 'Plan-specific condition', C.Standing.Active, provenance(agent, 90));
const planBinding = new C.Binding(ref(172), 'a', plan.ref, [planRequirement.ref], 'plan-A', provenance(agent, 90));
const planSelection = new C.BindingSelection(ref(173), 'a', planBinding.ref, true, 'Explicit fixture plan context', [plan.ref], provenance(agent, 90));
const inputArtifact = new C.Definition(ref(180), 'a', new C.Applicability_Unresolved('Synthetic artifact fixture, not independently verified', [], []), new C.Content_Artifact('Synthetic input artifact', digest('input'), 'application/octet-stream', 'urn:fixture:input', 1n), C.Standing.Active, [], undefined, provenance(host, 96));
const outputArtifact = new C.Definition(ref(181), 'a', new C.Applicability_Unresolved('Synthetic artifact fixture, not independently verified', [], []), new C.Content_Artifact('Synthetic output artifact', digest('output'), 'application/octet-stream', 'urn:fixture:output', 1n), C.Standing.Active, [], undefined, provenance(host, 97));
const records: C.GraphRecord[] = [new C.GraphRecord_Node(plan), new C.GraphRecord_Edge(planRequirement), new C.GraphRecord_Contract(planBinding), new C.GraphRecord_Selection(planSelection), new C.GraphRecord_Node(inputArtifact), new C.GraphRecord_Node(outputArtifact), new C.GraphRecord_Contract(questionBinding), new C.GraphRecord_Selection(questionSelection), new C.GraphRecord_Node(question), new C.GraphRecord_Node(goal), new C.GraphRecord_Node(source), new C.GraphRecord_Contract(contract), new C.GraphRecord_Selection(selected), ...assessmentRecords('a', ref, provenance(agent, 90))];
const reservedPresentationBase = 1000;
assert(!records.some(record => record.value.ref.id === id(reservedPresentationBase)), 'Fixture presentation reservation must not collide with an existing graph record');
const sourceEvent = C.CapturedEvent.fromPlain({ id: id(20), scope: 'a', sourceNamespace: 'fixture-collector', frontier: 1n, context, origin: C.EventOrigin.UserMessage, metadata, text: sourceText, observation: new C.Observation_None(), reviewResponse: undefined, provenance: source.provenance });
const absentEvent = C.CapturedEvent.fromPlain({ id: id(22), scope: 'a', sourceNamespace: 'fixture-host', frontier: 2n, context, origin: C.EventOrigin.ToolOutput, metadata: new C.CaptureMetadata('absence-entry', undefined, undefined, C.SourceRepresentation.HostReceipt, ['Synthetic witness, not a physical measurement'], []), text: 'Reported absence', observation: new C.Observation_FileAbsent('report.txt', 2n), reviewResponse: undefined, provenance: provenance(host, 92) });
const identity = new C.Identity(human, ['a', 'b'], [C.Capability.Read, C.Capability.Review]);
const versions = new C.VersionInfo('0.1.0', '0.1.0', ['0.1.0']);
const errors: string[] = [];
const receipts: string[] = [];
const themes: ThemeObservation[] = [];
let activePage: Page | null = null;
const executionEvent = new C.CapturedEvent(id(26), 'a', 'fixture-host', 3n, context, C.EventOrigin.ToolOutput,
  new C.CaptureMetadata('execution-entry', undefined, undefined, C.SourceRepresentation.HostReceipt, ['Synthetic execution account, not a physical measurement'], []),
  'Synthetic execution account', new C.Observation_Execution('controlled run', 'fixture host instrument', undefined, [inputArtifact.ref], [outputArtifact.ref], undefined, false), undefined, provenance(host, 95));
const pendingAttempt = new C.CurationAttemptSummary(id(500), 5n, 3n, 2n, C.CurationAttemptState.Running, 'a'.repeat(64), 1, C.CurationAuditStage.DispatchPossible, undefined, true, time, '2026-11-11T00:02:00Z', undefined);
let authenticated = false;
let generation = 5n;
let saved: C.Presentation | undefined;
let droppedAcknowledgment = false;
let mismatchedChoice = false;
let preparedCount = 0;
const committed = new Map<string, { input: unknown; judgment: C.Judgment }>();
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
      const a = new C.ScopeSummary('a', generation, 3n, 2n, C.CurationState.Running, undefined, generation, 4n, pendingAttempt);
      const b = new C.ScopeSummary('b', 0n, 0n, 0n, C.CurationState.Idle, undefined, 0n, undefined, undefined);
      return reply(route, C.ScopesResult.jsonCodec(), new C.ScopesResult([a, b]), 200);
    }
    if (operation === 'status') {
      const input = decode(C.ScopeRequest.jsonCodec(), data);
      return reply(route, C.CurationStatus.jsonCodec(), new C.CurationStatus(input.scope, input.scope === 'a' ? generation : 0n, input.scope === 'a' ? 3n : 0n, input.scope === 'a' ? 2n : 0n, input.scope === 'a' ? C.CurationState.Running : C.CurationState.Idle, undefined, input.scope === 'a' ? 4n : undefined, input.scope === 'a' ? pendingAttempt : undefined), 200);
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
      return reply(route, C.SourceResult.jsonCodec(), new C.SourceResult(input.scope, input.scope === 'a' ? [sourceEvent, absentEvent, executionEvent] : [], input.scope === 'a' ? 3n : 0n, undefined), 200);
    }
    if (operation === 'present') {
      const input = decode(C.PresentRequest.jsonCodec(), data);
      const reserved = ref(reservedPresentationBase + preparedCount);
      assert(!records.some(record => record.value.ref.id === reserved.id), 'Fixture reservation must remain unpublished');
      const choices: C.PresentedSelection[] = [];
      const adoptionTargets: C.Ref[] = [];
      for (const target of input.targets) {
        if (target.id === question.ref.id) question.content instanceof C.Content_Question && question.content.alternatives.forEach((label, index) => choices.push(new C.PresentedSelection_Alternative(reserved, question.ref, index, label)));
        if (target.id === questionBinding.ref.id) question.content instanceof C.Content_Question && question.content.alternatives.forEach((label, index) => choices.push(new C.PresentedSelection_Alternative(questionBinding.ref, question.ref, index, label)));
        if ([source.ref.id, contract.ref.id, questionBinding.ref.id].includes(target.id)) { choices.push(new C.PresentedSelection_Whole(target)); adoptionTargets.push(target); }
      }
      const payload = new C.PresentationPayload(input.scope, input.expectedGeneration, input.targets, records.filter(value => input.targets.some(target => target.id === value.value.ref.id) || [goal.ref.id, source.ref.id].includes(value.value.ref.id)), [source.ref], new C.PresentationManifest(choices, adoptionTargets));
      saved = new C.Presentation(id(40 + preparedCount), human, reserved, payload, digest(JSON.stringify(encode(C.PresentationPayload.jsonCodec(), payload))), time, new C.RequestTrace(id(240 + preparedCount), '/api/v1/present', C.RequestTransport.Cookie));
      preparedCount += 1;
      return reply(route, C.Presentation.jsonCodec(), saved, 200);
    }
    if (operation === 'judge') {
      const input = decode(C.JudgmentRequest.jsonCodec(), data);
      assert(saved !== undefined);
      assert.equal(input.presentationId, saved.id);
      submissions.push(data);
      let retained = committed.get(input.requestId);
      if (retained === undefined) {
        const number = committed.size;
        retained = { input: data, judgment: new C.Judgment(id(50 + number), input.scope, input.requestId, input.presentationId, input.action, input.rationale, human, time, ref(350 + number), saved.reservedSourceRef, ref(450 + number)) };
        committed.set(input.requestId, retained);
      } else assert.deepEqual(data, retained.input);
      const judgment = retained.judgment;
      if (!droppedAcknowledgment) { droppedAcknowledgment = true; return route.abort('failed'); }
      if (input.action instanceof C.ReviewAction_Choose && input.action.selection instanceof C.PresentedSelection_Alternative && !mismatchedChoice) {
        mismatchedChoice = true;
        const selected = input.action.selection;
        const wrong = new C.ReviewAction_Choose(new C.PresentedSelection_Alternative(selected.target, selected.definition, selected.index, 'Wrong acknowledgement label'));
        return reply(route, C.Judgment.jsonCodec(), new C.Judgment(judgment.id, judgment.scope, judgment.requestId, judgment.presentationId, wrong, judgment.rationale, judgment.actor, judgment.recordedAt, judgment.source, judgment.presentationSource, judgment.input), 200);
      }
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
  const planEdge = recordRegion.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Relation · Requires', exact: true }) }).filter({ hasText: 'Plan-specific condition' });
  await planEdge.getByText('Plan requirement work context', { exact: true }).waitFor();
  await planEdge.getByText('plan-A', { exact: true }).waitFor();
  await planEdge.getByText('Selection is not readiness or permission.', { exact: false }).waitFor();
  receipts.push('plan requirement work context and selection qualifications are explicit');
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
  const statusRegion = page.getByRole('region', { name: 'Scope status · a', exact: true });
  const field = (label: string) => statusRegion.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) }).locator('dd');
  assert.equal(await field('Graph generation').textContent(), '6');
  assert.equal(await field('Attempt base generation').textContent(), '5');
  assert.equal(await field('Attempt target frontier').textContent(), '3');
  assert.equal(await field('Last curation publication generation').textContent(), '4');
  assert.equal(await field('Latest audit stage').textContent(), 'DispatchPossible');
  assert.equal(await field('Attempt admission deadline').textContent(), '2026-11-11T00:02:00Z');
  await statusRegion.getByText('It does not prove provider receipt, model use or the absence of unrecorded activity.', { exact: false }).waitFor();
  receipts.push('current head, pinned attempt, last publication and dispatch qualifications remain distinct');
  assert(saved !== undefined);
  assert.equal(saved.payload.generation, 5n);
  await page.getByRole('radio', { name: 'Need evidence State what evidence or qualification is missing.', exact: true }).check();
  await page.getByRole('button', { name: 'Submit Human judgment', exact: true }).click();
  await page.getByRole('button', { name: 'Retry same judgment', exact: true }).waitFor();
  assert.equal(await rationale.isDisabled(), true);
  await page.getByRole('button', { name: 'Retry same judgment', exact: true }).click();
  await page.getByRole('heading', { name: 'Judgment acknowledged by the server', exact: true }).waitFor();
  assert.equal(submissions.length, 2);
  receipts.push('uncertain judgment retry preserves request ID and complete payload');
  const closeReview = async (): Promise<void> => {
    await page.getByRole('button', { name: 'Close acknowledged review…', exact: true }).click();
    await page.getByRole('dialog', { name: 'Close this acknowledged review?', exact: true }).getByRole('button', { name: 'Close acknowledged review', exact: true }).click();
  };
  await closeReview();
  await recordRegion.getByRole('button', { name: 'First page / refresh', exact: true }).click();
  await recordRegion.getByText('6', { exact: true }).waitFor();
  await recordRegion.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Question', exact: true }) }).getByLabel('Include exact revision in review', { exact: true }).check();
  await recordRegion.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Binding · context', exact: true }) }).filter({ has: page.getByRole('button', { name: `Inspect exact revision ${id(71)}@1`, exact: true }) }).getByLabel('Include exact revision in review', { exact: true }).check();
  await page.getByRole('button', { name: 'Prepare exact presentation', exact: true }).click();
  await page.getByRole('radio', { name: /^Choose Alternative 2: B .*target 00000000-0000-4000-8000-000000000047@1 / }).waitFor();
  const alternative = page.getByRole('radio', { name: new RegExp(`^Choose Alternative 2: B .*target ${saved.reservedSourceRef.id}@1 `) });
  await alternative.waitFor();
  assert.equal(await page.locator('input[type="radio"]:checked').count(), 0);
  await rationale.fill('Select B from this exact presented question, not from later revisions.');
  await alternative.check();
  await page.setViewportSize({ width: 390, height: 844 });
  await alternative.scrollIntoViewIfNeeded();
  await checkNarrowLayout(page);
  await page.screenshot({ path: path.join(report, 'narrow-light-choice.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForFunction(() => getComputedStyle(document.documentElement).colorScheme === 'dark');
  assert.equal(await alternative.isChecked(), true);
  assert.equal(await rationale.inputValue(), 'Select B from this exact presented question, not from later revisions.');
  await checkNarrowLayout(page);
  await page.screenshot({ path: path.join(report, 'narrow-dark-choice.png') });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.getByRole('button', { name: 'Submit Human judgment', exact: true }).click();
  await page.getByText('The judgment acknowledgement did not match this request and authenticated Human.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Retry same judgment', exact: true }).click();
  await page.getByRole('heading', { name: 'Judgment acknowledged by the server', exact: true }).waitFor();
  assert.equal(submissions.length, 4);
  assert.deepEqual(submissions[2], submissions[3]);
  const chosen = decode(C.JudgmentRequest.jsonCodec(), submissions[3]);
  assert(chosen.action instanceof C.ReviewAction_Choose && chosen.action.selection instanceof C.PresentedSelection_Alternative);
  assert.equal(chosen.action.selection.label, 'B');
  assert.equal(chosen.action.selection.index, 1);
  assert.equal(chosen.action.selection.definition.id, question.ref.id);
  assert.equal(chosen.action.selection.target.id, saved.reservedSourceRef.id);
  receipts.push('explicit alternative selection is not preselected; full-action acknowledgement mismatch retains the exact retry payload');
  await closeReview();
  const bindingCard = recordRegion.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Binding · context', exact: true }) }).filter({ has: page.getByRole('button', { name: `Inspect exact revision ${id(30)}@1`, exact: true }) });
  await bindingCard.getByLabel('Include exact revision in review', { exact: true }).check();
  await page.getByRole('button', { name: 'Prepare exact presentation', exact: true }).click();
  await page.getByRole('radio', { name: new RegExp(`^Adopt presented target ${id(30)}@1 `) }).check();
  await rationale.fill('Adopt this exact displayed binding only; no execution permission is supplied.');
  await page.getByRole('button', { name: 'Submit Human judgment', exact: true }).click();
  await page.getByRole('heading', { name: 'Judgment acknowledged by the server', exact: true }).waitFor();
  const adopted = decode(C.JudgmentRequest.jsonCodec(), submissions[4]);
  assert(adopted.action instanceof C.ReviewAction_Adopt);
  assert.equal(adopted.action.target.id, contract.ref.id);
  receipts.push('explicit adoption remains distinct from generic Accept and exact alternative choice');
  await closeReview();
  await page.getByRole('button', { name: 'Load captured sources', exact: true }).click();
  await page.getByText('Reported absence', { exact: true }).waitFor({ state: 'attached' });
  await page.getByRole('region', { name: 'Captured sources', exact: true }).locator('details').filter({ hasText: 'Reported absence' }).locator(':scope > summary').click();
  await page.getByText('Reported file absence', { exact: true }).waitFor();
  receipts.push('source representation, unknown lineage and typed absence remain inspectable');
  await page.getByText(/ToolOutput · frontier 3/).click();
  const execution = page.getByRole('region', { name: 'Captured sources', exact: true }).locator('details.record-card').filter({ hasText: 'Synthetic execution account' });
  const inputs = execution.locator('.ref-group').filter({ has: page.getByRole('heading', { name: 'Execution input artifacts', exact: true }) });
  const outputs = execution.locator('.ref-group').filter({ has: page.getByRole('heading', { name: 'Execution output artifacts', exact: true }) });
  await inputs.getByRole('button', { name: `Inspect exact revision ${id(180)}@1`, exact: true }).waitFor();
  await outputs.getByRole('button', { name: `Inspect exact revision ${id(181)}@1`, exact: true }).waitFor();
  await execution.getByText('No (reported)', { exact: true }).waitFor();
  await execution.locator('dl > div').filter({ has: page.getByText('Exit code', { exact: true }) }).getByText('Not recorded', { exact: true }).waitFor();
  await outputs.getByRole('button', { name: `Inspect exact revision ${id(181)}@1`, exact: true }).click();
  const outputInspection = page.getByRole('dialog', { name: 'Inspect exact historical reference', exact: true });
  await outputInspection.getByText('Synthetic output artifact', { exact: true }).waitFor();
  await outputInspection.getByRole('button', { name: 'Close', exact: true }).click();
  receipts.push('execution inputs and outputs remain separate with incomplete and unknown-exit qualifications');
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
  await writeFile(path.join(report, 'failure-observations.json'), JSON.stringify({ receipts, errors, submissions, savedGeneration: saved === undefined ? null : saved.payload.generation.toString() }, null, 2) + '\n');
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
