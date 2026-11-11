import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as C from '../.cache/fixtures/web/src/contracts.js';
import { actionKey, actionLabel, selectionLabel } from '../.cache/fixtures/web/src/actions.js';

const target = new C.Ref('00000000-0000-4000-8000-000000000001', 1);
const definition = new C.Ref('00000000-0000-4000-8000-000000000002', 3);

test('action identity distinguishes review, choice, adoption and every alternative coordinate', () => {
  const variants = [
    new C.ReviewAction_Review(C.JudgmentKind.Accept),
    new C.ReviewAction_Adopt(target),
    new C.ReviewAction_Choose(new C.PresentedSelection_Whole(target)),
    new C.ReviewAction_Choose(new C.PresentedSelection_Alternative(target, definition, 0, 'B')),
    new C.ReviewAction_Choose(new C.PresentedSelection_Alternative(target, definition, 1, 'B')),
    new C.ReviewAction_Choose(new C.PresentedSelection_Alternative(target, definition, 1, 'A')),
    new C.ReviewAction_Choose(new C.PresentedSelection_Alternative(target, new C.Ref(definition.id, 4), 1, 'B')),
    new C.ReviewAction_Choose(new C.PresentedSelection_Alternative(new C.Ref(target.id, 2), definition, 1, 'B')),
  ];
  assert.equal(new Set(variants.map(actionKey)).size, variants.length);
  for (const action of variants) {
    const decoded = C.ReviewAction.jsonCodec().decode(C.BaboonCodecContext.Default, JSON.parse(actionKey(action)));
    assert.equal(actionKey(decoded), actionKey(action));
  }
});

test('alternatives for the same definition distinguish their presented targets visibly', () => {
  const sourceTarget = new C.PresentedSelection_Alternative(target, definition, 1, 'B');
  const bindingTarget = new C.PresentedSelection_Alternative(new C.Ref('00000000-0000-4000-8000-000000000003', 1), definition, 1, 'B');
  assert.notEqual(selectionLabel(sourceTarget), selectionLabel(bindingTarget));
  assert.notEqual(actionLabel(new C.ReviewAction_Choose(sourceTarget)), actionLabel(new C.ReviewAction_Choose(bindingTarget)));
});

test('action descriptions preserve exact alternative identity without promoting generic acceptance', () => {
  assert.equal(actionLabel(new C.ReviewAction_Review(C.JudgmentKind.Accept)), 'Accept');
  const selected = new C.PresentedSelection_Alternative(target, definition, 1, 'B');
  assert.equal(selectionLabel(selected), `Alternative 2: B · definition ${definition.id}@3 · target ${target.id}@1`);
  assert.equal(actionLabel(new C.ReviewAction_Choose(selected)), `Choose · ${selectionLabel(selected)}`);
  assert.equal(actionLabel(new C.ReviewAction_Adopt(target)), `Adopt · ${target.id}@1`);
});
