import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, type Page, type Route } from 'playwright-core';
import { preview } from 'vite';
import * as C from '../src/contracts.js';
import type { Codec } from '../src/client.js';

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const when = '2026-11-11T00:00:00Z';
const reply = <T>(route: Route, codec: Codec<T>, value: T, status: number) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(codec.encode(C.BaboonCodecContext.Default, value)) });

class Fixture {
  readonly actor = new C.Actor('original-operator', C.ActorKind.Human);
  readonly versions = new C.VersionInfo('0.1.0', '0.1.0', ['0.1.0']);
  readonly records: C.GraphRecord[] = [new C.GraphRecord_Node(new C.Definition(new C.Ref(id(1), 1), 'a', new C.Applicability_Unresolved('Fixture only', [], []), new C.Content_Outcome('Preserve evidence', new C.Acceptance(['Retain sources'], undefined), C.Force.Required), C.Standing.Active, [], undefined, new C.Provenance(new C.Actor('curator', C.ActorKind.Agent), new C.Actor('fixture', C.ActorKind.Service), id(2), when)))];
  authenticated = true;
  expireAfterCommit = false;
  failLogout = false;
  foreignHistory = false;
  blockScopes = false;
  releaseScopes: () => void = () => {};
  readonly submissions: C.JudgmentRequest[] = [];
  private committed: C.Judgment | null = null;
  private readonly scopeGate = new Promise<void>(resolve => { this.releaseScopes = resolve; });
  private identity(actor: C.Actor): C.Identity { return new C.Identity(actor, ['a'], [C.Capability.Read, C.Capability.Review]); }
  async install(page: Page): Promise<void> {
    await page.route('**/api/v1/*', async route => {
      const request = route.request();
      const name = new URL(request.url()).pathname.split('/').at(-1);
      const body = request.postData();
      const data: unknown = body === null ? null : JSON.parse(body);
      if (name === 'login') {
        const input = C.LoginRequest.jsonCodec().decode(C.BaboonCodecContext.Default, data);
        this.authenticated = true;
        const actor = input.token === 'same-actor' ? this.actor : new C.Actor('different-operator', C.ActorKind.Human);
        return reply(route, C.LoginResult.jsonCodec(), new C.LoginResult(this.identity(actor), this.versions), 200);
      }
      if (!this.authenticated) return reply(route, C.Failure.jsonCodec(), new C.Failure('unauthorized', 'Fixture session expired'), 401);
      if (name === 'limits') return reply(route, C.QueryLimitsResult.jsonCodec(), new C.QueryLimitsResult(100), 200);
      if (name === 'whoami') return reply(route, C.Identity.jsonCodec(), this.identity(this.actor), 200);
      if (name === 'scopes') {
        if (this.blockScopes) await this.scopeGate;
        if (page.isClosed()) return;
        return reply(route, C.ScopesResult.jsonCodec(), new C.ScopesResult([new C.ScopeSummary('a', 1n, 0n, 0n, C.CurationState.Idle, undefined, 1n, undefined, undefined)]), 200);
      }
      if (name === 'read') return reply(route, C.ReadResult.jsonCodec(), new C.ReadResult('a', 1n, this.records, undefined), 200);
      if (name === 'status') return reply(route, C.CurationStatus.jsonCodec(), new C.CurationStatus('a', 1n, 0n, 0n, C.CurationState.Idle, undefined, undefined, undefined), 200);
      if (name === 'present') {
        const payload = new C.PresentationPayload('a', 1n, [new C.Ref(id(1), 1)], this.records, [], new C.PresentationManifest([], []));
        const digest = createHash('sha256').update(JSON.stringify(C.PresentationPayload.jsonCodec().encode(C.BaboonCodecContext.Default, payload))).digest('hex');
        return reply(route, C.Presentation.jsonCodec(), new C.Presentation(id(3), this.actor, new C.Ref(id(13), 1), payload, digest, when, new C.RequestTrace(id(14), '/api/v1/present', C.RequestTransport.Cookie)), 200);
      }
      if (name === 'judge') {
        const input = C.JudgmentRequest.jsonCodec().decode(C.BaboonCodecContext.Default, data);
        this.submissions.push(input);
        if (this.committed !== null) {
          assert.deepEqual(input, this.submissions[0]);
          return reply(route, C.Judgment.jsonCodec(), this.committed, 200);
        }
        this.committed = new C.Judgment(id(4), input.scope, input.requestId, input.presentationId, input.action, input.rationale, this.actor, when, new C.Ref(id(15), 1), new C.Ref(id(13), 1), new C.Ref(id(16), 1));
        if (this.expireAfterCommit) { this.authenticated = false; return route.abort('failed'); }
        return reply(route, C.Judgment.jsonCodec(), this.committed, 200);
      }
      if (name === 'logout') {
        if (this.failLogout) return reply(route, C.Failure.jsonCodec(), new C.Failure('logout-unavailable', 'Fixture logout failure'), 503);
        this.authenticated = false;
        return reply(route, C.Ack.jsonCodec(), new C.Ack(true), 200);
      }
      if (name === 'judgments') return reply(route, C.JudgmentsResult.jsonCodec(), new C.JudgmentsResult(this.foreignHistory ? [new C.Judgment(id(5), 'b', id(6), id(7), new C.ReviewAction_Review(C.JudgmentKind.Accept), 'Foreign scope history must not appear here', this.actor, when, new C.Ref(id(17), 1), new C.Ref(id(18), 1), new C.Ref(id(19), 1))] : []), 200);
      throw new Error(`Unexpected fixture operation: ${name}`);
    });
  }
}

async function selectScope(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'Authorized scope', exact: true }).selectOption('a');
  await page.getByRole('heading', { name: 'Current records', exact: true }).waitFor();
}

async function main(): Promise<void> {
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH) throw new Error('Use the pinned browser shell');
  const root = process.cwd();
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  const report = await mkdtemp(path.join(root, 'test-results', 'review-recovery-'));
  const server = await preview({ root, preview: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  const address = server.httpServer.address();
  assert(address !== null && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/`;
  const browser = await chromium.launch({ headless: true });
  const results: { name: string; passed: boolean; error: string | null }[] = [];
  const cases: { name: string; run: (page: Page, fixture: Fixture) => Promise<void> }[] = [
    { name: 'expired-session-keeps-uncertain-judgment', run: async (page, fixture) => {
      fixture.expireAfterCommit = true;
      await selectScope(page);
      await page.getByRole('region', { name: 'Ontology records', exact: true }).getByLabel('Include exact revision in review', { exact: true }).check();
      await page.getByRole('button', { name: 'Prepare exact presentation', exact: true }).click();
      const rationale = page.getByRole('textbox', { name: 'Rationale', exact: true });
      await rationale.fill('Preserve this request across reauthentication');
      await page.getByRole('radio', { name: 'Need evidence State what evidence or qualification is missing.', exact: true }).check();
      await page.getByRole('button', { name: 'Submit Human judgment', exact: true }).click();
      await page.getByRole('button', { name: 'Retry same judgment', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'unauthorized' }).waitFor();
      await page.getByRole('button', { name: 'Restore session', exact: true }).click();
      await page.getByLabel('Host-issued token', { exact: true }).fill('different-actor');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByText('The authenticated actor differs from the retained review identity. Restore the original actor; the pinned request has not been changed.', { exact: true }).waitFor();
      assert.equal(await rationale.inputValue(), 'Preserve this request across reauthentication');
      await page.getByLabel('Host-issued token', { exact: true }).fill('same-actor');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Restore original identity', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await rationale.inputValue(), 'Preserve this request across reauthentication');
      await page.getByRole('button', { name: 'Retry same judgment', exact: true }).click();
      await page.getByRole('heading', { name: 'Judgment acknowledged by the server', exact: true }).waitFor();
      assert.equal(fixture.submissions.length, 2);
      assert.deepEqual(fixture.submissions[1], fixture.submissions[0]);
    } },
    { name: 'failed-logout-settles-cancelled-scope-loader', run: async (page, fixture) => {
      await page.getByRole('combobox', { name: 'Authorized scope', exact: true }).waitFor();
      fixture.failLogout = true;
      fixture.blockScopes = true;
      const refresh = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/scopes'));
      await page.getByRole('button', { name: 'Refresh scope list', exact: true }).click();
      await refresh;
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'logout unavailable' }).waitFor();
      await page.getByRole('button', { name: 'Refresh scope list', exact: true }).click();
      fixture.blockScopes = false;
      fixture.releaseScopes();
      await selectScope(page);
    } },
    { name: 'foreign-judgment-history-rejected', run: async (page, fixture) => {
      fixture.foreignHistory = true;
      await selectScope(page);
      await page.getByRole('button', { name: 'Load / refresh judgments', exact: true }).click();
      await page.getByText('Judgment history scope mismatch.', { exact: true }).waitFor();
      assert.equal(await page.getByText('Foreign scope history must not appear here', { exact: true }).count(), 0);
    } },
  ];
  try {
    for (const scenario of cases) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const fixture = new Fixture();
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await fixture.install(page);
        await page.goto(url);
        await scenario.run(page, fixture);
        assert.deepEqual(errors, []);
        results.push({ name: scenario.name, passed: true, error: null });
      } catch (error) {
        results.push({ name: scenario.name, passed: false, error: String(error) });
        await writeFile(path.join(report, `${scenario.name}.html`), await page.content());
        await page.screenshot({ path: path.join(report, `${scenario.name}.png`) });
      } finally {
        fixture.releaseScopes();
        await context.close();
      }
    }
    await writeFile(path.join(report, 'summary.json'), JSON.stringify({ results, node: process.version, chromium: browser.version(), realBackendIntegration: false, humanStudy: false }, null, 2) + '\n');
    console.log(JSON.stringify({ report, results }));
    assert(results.every(result => result.passed), 'UI recovery/correlation controls failed');
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
  }
}
await main();
