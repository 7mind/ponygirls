import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import * as C from '../src/contracts.js';
import { WireValidation } from '../src/wire-validation.js';
import { parseJson } from '../src/json.js';
import { wirePlan } from '../../generated/typescript/GeneratedWirePlan.js';
import type { Codec } from '../src/client.js';

const [configPath, report] = process.argv.slice(2);
assert(process.argv.length === 4 && configPath !== undefined && report !== undefined && isAbsolute(configPath) && isAbsolute(report));
assert(process.env.PLAYWRIGHT_BROWSERS_PATH, 'use the pinned browser environment; downloads are forbidden');
const raw = parseJson(await readFile(configPath, 'utf8'));
assert(raw !== null && typeof raw === 'object');
const config = raw as Record<string, unknown>;
for (const key of ['origin', 'scope', 'humanToken', 'agentToken', 'seedId', 'originalText', 'revisedText']) assert.equal(typeof config[key], 'string');
const origin = config.origin as string;
assert(/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin), 'controlled loopback origin required');
const scope = config.scope as string;
const seed = new C.Ref(config.seedId as string, 1);
const originalText = config.originalText as string;
const revisedText = config.revisedText as string;
const validation = new WireValidation(wirePlan);
function decode<T>(codec: Codec<T>, value: unknown): T { return codec.decode(C.BaboonCodecContext.Default, validation.normalize(codec, value)); }
function encode<T>(codec: Codec<T>, value: T): unknown { return validation.normalize(codec, codec.encode(C.BaboonCodecContext.Default, value)); }
async function agentPost<I, O>(operation: string, value: I, input: Codec<I>, output: Codec<O>): Promise<O> {
  const response = await fetch(origin + '/api/v1/' + operation, { method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', 'X-Ontology-Version': '0.1.0', Authorization: 'Bearer ' + config.agentToken, Origin: origin },
    body: JSON.stringify(encode(input, value)) });
  const text = await response.text(); assert(Buffer.byteLength(text) <= 4 * 1024 * 1024);
  const json = parseJson(text);
  const code = json !== null && typeof json === 'object' && 'code' in json && typeof json.code === 'string' ? json.code : 'unknown';
  assert.equal(response.status, 200, 'controlled bearer operation failed: ' + code);
  return decode(output, json);
}
async function converged(generation: bigint, frontier: bigint): Promise<void> {
  const deadline = performance.now() + 15000;
  for (;;) {
    const status = await agentPost('status', new C.ScopeRequest(scope), C.ScopeRequest.jsonCodec(), C.CurationStatus.jsonCodec());
    if (status.generation === generation && status.frontier === frontier && status.coveredFrontier === frontier) return;
    assert(performance.now() < deadline, 'real backend convergence deadline exceeded');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const browser = await chromium.launch({ headless: true });
let observations: unknown;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await context.newPage();
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(15000);
  const pageErrors: string[] = [];
  const unexpectedResponses: { path: string; status: number }[] = [];
  const requestOrigins = new Set<string>();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => requestOrigins.add(new URL(request.url()).origin));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/') && response.status() >= 400 && !(path === '/api/v1/whoami' && response.status() === 401)) unexpectedResponses.push({ path, status: response.status() });
  });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Connect your identity' }).waitFor();
  await page.getByLabel('Host-issued token').fill(config.humanToken as string);
  const loginResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/login');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  assert.equal((await loginResponse).status(), 200);
  const initialBrowseResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/read');
  await page.getByLabel('Authorized scope').selectOption(scope);
  const initialBrowse = await initialBrowseResponse;
  await writeFile(join(report, 'initial-browse-result.json'), JSON.stringify({ status: initialBrowse.status(), body: parseJson(await initialBrowse.text()) }, null, 2) + '\n');
  assert.equal(initialBrowse.status(), 200, 'browsing must support the configured positive page limit');
  const cookie = (await context.cookies()).find(value => value.name === 'ontology-dev');
  assert(cookie !== undefined && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/' && !cookie.secure);
  const records = page.getByRole('region', { name: 'Ontology records' });
  const card = records.locator('article.record-card').filter({ has: page.getByRole('heading', { name: 'Evidence · Statement', exact: true }) })
    .filter({ has: page.getByRole('button', { name: `Inspect exact revision ${seed.id}@1`, exact: true }) });
  let browsePages = 1;
  for (; browsePages <= 16; browsePages++) {
    await records.locator('.page-caption').filter({ hasText: `page ${browsePages} · current` }).waitFor();
    if (await card.count() === 1) break;
    await records.getByRole('button', { name: 'Next page', exact: true }).click();
  }
  assert(browsePages <= 16, 'controlled seed was absent from bounded current pages');
  await card.waitFor(); assert.equal(await card.count(), 1);
  await card.getByRole('checkbox', { name: 'Include exact revision in review' }).check();
  const presentedResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/present');
  await page.getByRole('button', { name: 'Prepare exact presentation' }).click();
  const presented = await presentedResponse; assert.equal(presented.status(), 200);
  const presentation = decode(C.Presentation.jsonCodec(), parseJson(await presented.text()));
  assert.equal(presentation.owner.id, 'fixture-human'); assert.equal(presentation.payload.generation, 2n);
  assert.deepEqual(presentation.payload.targets.map(ref => [ref.id, ref.revision]), [[seed.id, 1]]);
  const panel = page.locator('aside.review-panel');
  await panel.getByRole('heading', { name: 'Presented snapshot' }).waitFor();
  await panel.getByText(presentation.id, { exact: true }).waitFor();
  await panel.getByText(presentation.payloadDigest, { exact: true }).waitFor();
  await panel.locator('summary').filter({ hasText: seed.id + '@1' }).first().click();
  await panel.getByText(originalText, { exact: true }).waitFor();
  const rationale = 'Controlled browser request for evidence about this exact original snapshot.';
  await page.getByRole('textbox', { name: 'Rationale', exact: true }).fill(rationale);
  await page.screenshot({ path: join(report, 'browser-presentation.png') });
  const changed = await agentPost('apply', new C.ApplyRequest(scope, randomUUID(), 2n, [new C.Operation_Revise('revised', seed,
    new C.ApplicabilityInput_Unresolved('Controlled browser fixture', [], []), new C.ContentInput_Statement(revisedText, C.Modality.Assertion),
    C.Standing.Active, [new C.Target_Exact(seed)], 'Controlled revision while original review remains open')], undefined), C.ApplyRequest.jsonCodec(), C.ApplyResult.jsonCodec());
  assert.equal(changed.generation, 3n);
  await converged(4n, 2n);
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await panel.getByText(/This review remains pinned to 2;/).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Rationale', exact: true }).inputValue(), rationale);
  await panel.getByText(presentation.id, { exact: true }).waitFor();
  await panel.getByText(presentation.payloadDigest, { exact: true }).waitFor();
  await panel.getByText(originalText, { exact: true }).waitFor();
  assert(await page.getByLabel('Authorized scope').isDisabled());
  await page.getByText('Inspect an exact ID and revision', { exact: true }).click();
  await page.getByLabel('Reference UUID', { exact: true }).fill(seed.id);
  await page.getByLabel('Revision', { exact: true }).fill('2');
  const inspectionResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/read' && response.request().postData()?.includes(seed.id) === true);
  await page.getByRole('button', { name: 'Inspect history', exact: true }).click();
  const inspection = await inspectionResponse;
  const inspectionJson = parseJson(await inspection.text());
  await writeFile(join(report, 'inspection-result.json'), JSON.stringify({ status: inspection.status(), body: inspectionJson }, null, 2) + '\n');
  assert.equal(inspection.status(), 200, 'exact historical inspection must be accepted');
  const inspector = page.getByRole('dialog', { name: 'Inspect exact historical reference' });
  await inspector.getByText(originalText, { exact: true }).waitFor();
  const nextInspection = page.waitForResponse(response => response.url() === origin + '/api/v1/read' && response.request().postData()?.includes(seed.id) === true);
  await inspector.getByRole('button', { name: 'Next inspection page', exact: true }).click();
  assert.equal((await nextInspection).status(), 200);
  await inspector.getByText(revisedText, { exact: true }).waitFor();
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Rationale', exact: true }).inputValue(), rationale);
  await page.screenshot({ path: join(report, 'browser-pinned-after-drift.png') });
  await page.getByRole('radio', { name: /^Need evidence/ }).check();
  const judgmentResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/judge');
  await page.getByRole('button', { name: 'Submit Human judgment', exact: true }).click();
  const judged = await judgmentResponse; assert.equal(judged.status(), 200);
  const headers = await judged.request().allHeaders();
  assert.equal(headers['x-ontology-actor'], 'fixture-human'); assert.equal(headers['x-ontology-version'], '0.1.0');
  assert.equal(headers.authorization, undefined);
  const request = decode(C.JudgmentRequest.jsonCodec(), parseJson(judged.request().postData()!));
  const judgment = decode(C.Judgment.jsonCodec(), parseJson(await judged.text()));
  assert.equal(judgment.presentationId, presentation.id); assert.equal(judgment.requestId, request.requestId);
  assert.equal(judgment.rationale, rationale); assert.equal(judgment.actor.id, 'fixture-human'); assert.equal(judgment.actor.kind, C.ActorKind.Human);
  assert.equal(judgment.presentationSource.id, presentation.reservedSourceRef.id);
  assert(judgment.action instanceof C.ReviewAction_Review && judgment.action.kind === C.JudgmentKind.NeedEvidence);
  await page.getByRole('heading', { name: 'Judgment acknowledged by the server' }).waitFor();
  await converged(6n, 3n);
  await page.getByRole('button', { name: 'Load / refresh judgments', exact: true }).click();
  const judgments = page.getByRole('region', { name: 'Recorded Human judgments' });
  await judgments.getByText(judgment.id, { exact: true }).waitFor();
  await judgments.getByText(presentation.id, { exact: true }).waitFor();
  await judgments.getByText(rationale, { exact: true }).waitFor();
  await page.screenshot({ path: join(report, 'browser-recorded-judgment.png') });
  await page.getByRole('button', { name: 'Close acknowledged review…', exact: true }).click();
  await page.getByRole('dialog', { name: 'Close this acknowledged review?' }).getByRole('button', { name: 'Close acknowledged review', exact: true }).click();
  await page.getByLabel('Literal definition text', { exact: true }).fill(revisedText);
  await page.getByRole('combobox', { name: /^Definition kind/ }).selectOption(C.DefinitionKind.Statement);
  const searchResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/find');
  await page.getByRole('button', { name: 'Find definitions', exact: true }).click();
  const search = await searchResponse; assert.equal(search.status(), 200);
  const searchResult = decode(C.FindResult.jsonCodec(), parseJson(await search.text()));
  assert.deepEqual(searchResult.items.map(hit => [hit.ref.id, hit.ref.revision]), [[seed.id, 2]]);
  assert.equal(JSON.parse(search.request().postData()!).limit, 1);
  await records.getByText(revisedText, { exact: true }).waitFor();
  const probeCookie = () => fetch(origin + '/api/v1/whoami', { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000),
    headers: { Cookie: cookie.name + '=' + cookie.value, 'X-Ontology-Version': '0.1.0', 'X-Ontology-Actor': 'fixture-human', Origin: origin } });
  const beforeLogout = await probeCookie(); assert.equal(beforeLogout.status, 200);
  assert.equal(decode(C.Identity.jsonCodec(), parseJson(await beforeLogout.text())).actor.id, 'fixture-human');
  const logoutResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/logout');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  const logout = await logoutResponse; assert.equal(logout.status(), 200);
  assert.equal(decode(C.Ack.jsonCodec(), parseJson(await logout.text())).ok, true);
  const revoked = await probeCookie(); assert.equal(revoked.status, 401, 'logout must revoke the old server session, not merely clear browser state');
  await revoked.arrayBuffer();
  const restoredResponse = page.waitForResponse(response => response.url() === origin + '/api/v1/whoami');
  await page.reload(); assert.equal((await restoredResponse).status(), 401);
  await page.getByRole('heading', { name: 'Connect your identity' }).waitFor();
  assert.deepEqual(pageErrors, []); assert.deepEqual(unexpectedResponses, []); assert.deepEqual([...requestOrigins], [origin]);
  observations = { presentation: encode(C.Presentation.jsonCodec(), presentation), judgment: encode(C.Judgment.jsonCodec(), judgment),
    request: encode(C.JudgmentRequest.jsonCodec(), request), chromium: browser.version(), node: process.version,
    browsePages, scenarios: ['small-limit-browse-and-search', 'real-cookie-login', 'pinned-review-after-drift', 'exact-history-preserves-draft', 'real-judgment-and-history', 'real-signout'],
    realBackendIntegration: true, humanStudy: false, semanticQuality: false };
  await context.close();
} finally { await browser.close(); }
await writeFile(join(report, 'browser-observations.json'), JSON.stringify(observations, null, 2) + '\n');
