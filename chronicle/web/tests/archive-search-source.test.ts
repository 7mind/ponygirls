// Specified: Behavioral-Active Blackbox / Atomic; browser composition is checked in search-serp.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArchiveMatchKind, ArchiveRow, ArchiveSearchEvidence, ArchiveSearchResult, ArchiveSourceMatch, ArchiveResult, ArchiveTextScope, Completion, ContentView, Metadata, SessionInfo, SourceIdentity, SourceFormat, Span } from '../src/api.ts';
import { sourceFailureAffectsView, validateArchiveSearchPage } from '../src/search-source.ts';
const headView = new ContentView(3, undefined), publishedView = new ContentView(1, 'generation');
function result(): ArchiveSearchResult {
  const metadata = new Metadata('Title', 'project', undefined, undefined, undefined, undefined, 'producer', undefined, undefined, undefined, []);
  const head = new SessionInfo(headView, 'session', 'reader', 3, 1, metadata, new SourceIdentity('collector', 'root', SourceFormat.Pi, 'source', undefined), Completion.Quiescent, false);
  const row = new ArchiveRow(head, publishedView, headView, undefined, 2, [], undefined, undefined);
  const literal = new ArchiveSourceMatch(headView, new Span('m1', 0, 3), ArchiveMatchKind.Literal, '猫', undefined);
  const semantic = new ArchiveSourceMatch(publishedView, new Span('m2', 0, 4), ArchiveMatchKind.Semantic, 'topic', 'Generated annotation');
  return new ArchiveSearchResult(new ArchiveResult([row], 1n, undefined, ArchiveTextScope.BoundedCandidateSets, 1000, true), [new ArchiveSearchEvidence(head.id, [literal, semantic])]);
}
test('BA: Archive search preserves i64 totals and Hybrid/complement counts larger than per-operand ANN bounds', () => {
  const valid = result();
  for (const total of [1001n, 9007199254740993n, 9223372036854775807n]) {
    const page = valid.with({ page: valid.page.with({ total }) });
    assert.equal(validateArchiveSearchPage(page, undefined), page);
  }
  const exact = valid.with({ page: valid.page.with({ textScope: ArchiveTextScope.ExactLexical, annChunkLimitPerOperand: undefined }) });
  assert.equal(validateArchiveSearchPage(exact, undefined), exact);
  for (const page of [valid.page.with({ total: -1n }), valid.page.with({ total: 0n }), valid.page.with({ total: 9223372036854775808n }), valid.page.with({ total: 1 as unknown as bigint }), valid.page.with({ annChunkLimitPerOperand: undefined }), valid.page.with({ annChunkLimitPerOperand: 0 }), valid.page.with({ textScope: ArchiveTextScope.ExactLexical })]) assert.throws(() => validateArchiveSearchPage(valid.with({ page }), undefined));
});
test('BA: Archive search rejects malformed ordering and empty, repeated or unproductive cursors', () => {
  const valid = result();
  for (const page of [valid.page.with({ relevanceOrdered: undefined as unknown as boolean }), valid.page.with({ nextCursor: '' }), valid.page.with({ nextCursor: 'current' }), valid.page.with({ rows: [], nextCursor: 'next' })]) assert.throws(() => validateArchiveSearchPage(valid.with({ page }), 'current'));
  assert.equal(validateArchiveSearchPage(valid.with({ page: valid.page.with({ nextCursor: 'next' }) }), 'current').page.nextCursor, 'next');
});
test('BA: page identity and evidence alignment are mandatory before displaying source', () => {
  const valid = result(), row = valid.page.rows[0]!, evidence = valid.evidence[0]!;
  for (const malformed of [valid.with({ evidence: [] }), valid.with({ evidence: [evidence.with({ sessionId: 'other' })] }), valid.with({ page: valid.page.with({ rows: [row, row], total: 2n }), evidence: [evidence, evidence] }), valid.with({ page: valid.page.with({ rows: Array.from({ length: 11 }, () => row), total: 11n }), evidence: Array.from({ length: 11 }, () => evidence) })]) assert.throws(() => validateArchiveSearchPage(malformed, undefined));
});
test('BA: mixed HEAD and published evidence keep separate pins and representative spans', () => {
  const valid = result(), row = valid.page.rows[0]!, evidence = valid.evidence[0]!, literal = evidence.matches[0]!, semantic = evidence.matches[1]!;
  assert.equal(validateArchiveSearchPage(valid, undefined), valid);
  for (const match of [literal.with({ view: publishedView }), literal.with({ summary: 'Fabricated annotation' }), semantic.with({ view: headView }), semantic.with({ view: new ContentView(2, 'other') }), literal.with({ operand: '' }), literal.with({ span: new Span('m1', -1, 3) }), semantic.with({ kind: 'Unknown' as ArchiveMatchKind })]) assert.throws(() => validateArchiveSearchPage(valid.with({ evidence: [evidence.with({ matches: [match] })] }), undefined));
  assert.throws(() => validateArchiveSearchPage(valid.with({ evidence: [evidence.with({ matches: [literal, semantic, literal] })] }), undefined));
  for (const changed of [row.with({ head: row.head.with({ view: publishedView }) }), row.with({ publishedView: new ContentView(4, 'future') }), row.with({ matchedView: new ContentView(2, 'other') }), row.with({ publishedView: headView })]) assert.throws(() => validateArchiveSearchPage(valid.with({ page: valid.page.with({ rows: [changed] }) }), undefined));
});
test('BA: source authority denial crosses pins, while availability and retirement failures remain view-local', () => {
  for (const code of ['forbidden', 'not-found', 'unauthorized', 'authorization-changed']) assert.equal(sourceFailureAffectsView(headView, publishedView, code), true);
  for (const code of ['indexed-view-retired', 'deadline', 'read-budget', null]) {
    assert.equal(sourceFailureAffectsView(headView, publishedView, code), false);
    assert.equal(sourceFailureAffectsView(headView, headView, code), true);
  }
});
test('BA: metadata-only and negative-only rows need no fabricated textual witnesses or publication', () => {
  const valid = result(), row = valid.page.rows[0]!;
  const unindexed = row.with({ head: row.head.with({ indexedRevision: undefined }), publishedView: undefined, matchedView: undefined });
  const page = valid.with({ page: valid.page.with({ rows: [unindexed], textScope: ArchiveTextScope.ExactLexical, annChunkLimitPerOperand: undefined, relevanceOrdered: false }), evidence: [valid.evidence[0]!.with({ matches: [] })] });
  assert.equal(validateArchiveSearchPage(page, undefined), page);
  const empty = new ArchiveSearchResult(page.page.with({ rows: [], total: 0n }), []);
  assert.equal(validateArchiveSearchPage(empty, undefined), empty);
});
