// Specified contracts. Behavioral-Active Blackbox / Atomic; UI composition is checked in search-serp.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentView, ContextExcerpt, MessageContextResult, PassageSourceSpan, Span } from '../src/api.ts';
import { CONTEXT_BYTES, snippetAnchor, validateContext, contextParts } from '../src/search-source.ts';
const view = new ContentView(1, 'generation'), anchor = new Span('m1', 0, 3);
function result(): MessageContextResult { return new MessageContextResult('session', view, new PassageSourceSpan('m1', 0, 0, 3), [new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 3), 'user', '猫')], undefined, new Span('m1', 3, 3)); }
test('BA: retain complete bounded match anchors, preview historical oversized spans without fabricating source', () => {
  assert.deepEqual(snippetAnchor(anchor).toJSON(), anchor.toJSON());
  assert.deepEqual(snippetAnchor(new Span('m1', 4, 4 + CONTEXT_BYTES)).toJSON(), new Span('m1', 4, 4 + CONTEXT_BYTES).toJSON());
  assert.deepEqual(snippetAnchor(new Span('m1', 4, 5 + CONTEXT_BYTES)).toJSON(), new Span('m1', 4, 4).toJSON());
  assert.throws(() => snippetAnchor(new Span('m1', -1, 3)), /Invalid/);
});
test('BA: source pin/session/anchor, roles, UTF-8 ranges and byte budgets must validate before literal display', () => {
  const valid = result(); assert.equal(validateContext(valid, 'session', view, anchor, 0, 0), valid);
  for (const malformed of [valid.with({ sessionId: 'other' }), valid.with({ view: new ContentView(2, 'generation') }), valid.with({ view: new ContentView(1, 'other') }), valid.with({ anchor: new PassageSourceSpan('m2', 0, 0, 3) }), valid.with({ excerpts: [] }), valid.with({ excerpts: [valid.excerpts[0]!.with({ role: '' })] }), valid.with({ excerpts: [valid.excerpts[0]!.with({ text: 'wrong' })] }), valid.with({ excerpts: [valid.excerpts[0]!.with({ source: new PassageSourceSpan('m1', 0, 1, 4) })] }), valid.with({ next: new Span('m1', 4, 4) })]) assert.throws(() => validateContext(malformed, 'session', view, anchor, 0, 0));
  const expanded = valid.with({ excerpts: [new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 4), 'user', '猫x')], next: new Span('m1', 4, 4) });
  assert.throws(() => validateContext(expanded, 'session', view, anchor, 0, 0), /budget/);
  assert.equal(validateContext(expanded, 'session', view, anchor, 0, 4), expanded);
});

test('BA: same-view continuations are bounded, ordered and cannot repeat their anchor', () => {
  const nextAnchor = new Span('m1', 3, 3);
  const page = new MessageContextResult('session', view, new PassageSourceSpan('m1', 0, 3, 3), [new ContextExcerpt(new PassageSourceSpan('m1', 0, 3, 4), 'user', 'x'), new ContextExcerpt(new PassageSourceSpan('m2', 1, 0, 3), 'assistant', '猫')], new Span('m1', 3, 3), new Span('m2', 3, 3));
  assert.equal(validateContext(page, 'session', view, nextAnchor, 0, 4), page);
  assert.throws(() => validateContext(page.with({ excerpts: [...page.excerpts].reverse() }), 'session', view, nextAnchor, 0, 4), /ordering/);
  const stalled = page.with({ excerpts: [new ContextExcerpt(new PassageSourceSpan('m1', 0, 3, 3), 'user', '')], next: nextAnchor });
  assert.throws(() => validateContext(stalled, 'session', view, nextAnchor, 0, 4), /advance/);
});

test('BA regression: context scalar and anchor endpoints are checked before source display, including zero-width previews', () => {
  const excerpt = new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 4), 'user', '猫x');
  const page = result().with({ excerpts: [excerpt], next: undefined });
  for (const invalid of [new Span('m1', 1, 2), new Span('m1', 0, 1), new Span('m1', 1, 1)]) {
    const reply = page.with({ anchor: new PassageSourceSpan('m1', 0, invalid.start, invalid.end) });
    assert.throws(() => validateContext(reply, 'session', view, invalid, 0, 512), /UTF-8 boundary/);
  }
  const scalar = page.with({ excerpts: [excerpt.with({ text: '\ud800x' })] });
  assert.throws(() => validateContext(scalar, 'session', view, anchor, 0, 512), /non-scalar/);
  assert.equal(validateContext(page, 'session', view, anchor, 0, 512), page);
});
test('BA regression: matched context parts validate every visible historical partial-preview boundary before render', () => {
  const excerpt = new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 4), 'user', '猫x');
  assert.throws(() => contextParts(excerpt, new Span('m1', 1, 2050)), /UTF-8 boundary/);
  assert.throws(() => contextParts(excerpt, new Span('m1', 0, 1)), /UTF-8 boundary/);
  assert.deepEqual(contextParts(excerpt, new Span('m1', 0, 2049)), [{ text: '猫x', highlighted: true }]);
  assert.deepEqual(contextParts(excerpt, new Span('m1', 0, 3)), [{ text: '猫', highlighted: true }, { text: 'x', highlighted: false }]);
  assert.deepEqual(contextParts(excerpt, new Span('other', 1, 2)), [{ text: '猫x', highlighted: false }]);
});
test('BA regression: valid BOM-leading excerpts retain exact source and anchor bytes', () => {
  const bomAnchor = new Span('m1', 0, 4), excerpt = new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 4), 'user', '\uFEFFx');
  const page = result().with({ anchor: excerpt.source, excerpts: [excerpt], next: undefined });
  assert.equal(validateContext(page, 'session', view, bomAnchor, 0, 0), page);
  assert.deepEqual(contextParts(excerpt, bomAnchor), [{ text: '\uFEFFx', highlighted: true }]);
});
test('BA regression: BOM does not conceal non-scalars or invalid source byte endpoints', () => {
  const bomAnchor = new Span('m1', 0, 7);
  for (const text of ['\uFEFF\ud800x', '\uFEFF\udc00x']) {
    const excerpt = new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 7), 'user', text), page = result().with({ anchor: excerpt.source, excerpts: [excerpt], next: undefined });
    assert.throws(() => validateContext(page, 'session', view, bomAnchor, 0, 0), /non-scalar/);
  }
  const excerpt = new ContextExcerpt(new PassageSourceSpan('m1', 0, 0, 4), 'user', '\uFEFFx');
  for (const invalid of [new Span('m1', 1, 3), new Span('m1', 0, 2), new Span('m1', 1, 1)]) {
    const page = result().with({ anchor: new PassageSourceSpan('m1', 0, invalid.start, invalid.end), excerpts: [excerpt], next: undefined });
    assert.throws(() => validateContext(page, 'session', view, invalid, 0, 512), /UTF-8 boundary/);
  }
});
