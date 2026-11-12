import test from 'node:test';
import assert from 'node:assert/strict';
import { DEVELOPMENT_IDS, HELD_OUT_IDS, getCase } from './cases.mjs';
import { hash } from './memory.mjs';
const IDS = [...DEVELOPMENT_IDS, ...HELD_OUT_IDS];

test('public case partitions and stable identities are explicit', () => {
  assert.deepEqual(DEVELOPMENT_IDS, ['upgrade', 'stock']); assert.deepEqual(HELD_OUT_IDS, ['meeting', 'consent', 'payments', 'sensors']);
  assert.equal(new Set(IDS).size, IDS.length);
  const documents = IDS.flatMap(id => getCase(id).documents);
  assert.equal(new Set(documents.map(record => record.id)).size, documents.length);
  for (const id of ['missing', '__proto__', 'toString', null]) assert.throws(() => getCase(id), RangeError);
});

for (const id of IDS) {
  test(`${id}: full visible contract, source access and isolation from grader material`, () => {
    const task = getCase(id); const baseline = structuredClone(task);
    assert.equal(task.heldOut, HELD_OUT_IDS.includes(id));
    assert.equal(hash(task), hash(getCase(id)));
    assert.deepEqual(Object.keys(task).sort(), ['documents', 'finalPrompt', 'heldOut', 'id', 'initialPrompt', 'schema', 'topic', 'updatePrompt']);
    const contract = task.documents.find(record => record.id === `${id}-initial-contract`);
    assert.equal(contract.availableFrom, 0); assert.ok(contract.body.includes(JSON.stringify(task.schema)));
    for (const phrase of ['planning-only', 'property names must be unique', 'sources must cite every operative', 'historical uploads', 'provisional']) assert.ok(contract.body.includes(phrase), phrase);
    for (const prompt of [task.initialPrompt, task.updatePrompt]) assert.match(prompt, /provisional JSON artifact/);
    assert.match(task.finalPrompt, /saved reflections if useful/);
    for (const record of task.documents) {
      assert.deepEqual(Object.keys(record).sort(), ['availableFrom', 'body', 'caption', 'id']); assert.ok([0, 1].includes(record.availableFrom));
      assert.match(record.id, new RegExp(`^${id}-[a-z0-9-]+$`)); assert.equal(typeof record.body, 'string');
      assert.doesNotMatch(record.body, /expected answer|hidden checks|grading rubric/i);
    }
    const original = task.documents.filter(record => record.availableFrom === 0);
    const updated = task.documents.filter(record => record.availableFrom <= 1);
    assert.ok(original.length >= 2); assert.equal(updated.length, task.documents.length);
    for (const record of original) assert.ok(updated.some(other => other.id === record.id && other.body === record.body));
    const history = updated.filter(record => record.id.includes('-historical-')); assert.equal(history.length, 1); assert.match(history[0].body, /Historical/);
    task.documents[0].body = 'mutated'; task.schema.required.push('extra'); assert.deepEqual(getCase(id), baseline);
  });
}

test('citation contract forbids historical IDs even when offered as rejected evidence', () => {
  for (const id of IDS) assert.match(getCase(id).documents[0].body, /Do not include historical-upload IDs anywhere in sources, even to show that they were rejected/);
});

test('update instruction contains no case-specific correction or hidden answer', () => {
  const prompts = IDS.map(id => getCase(id).updatePrompt); assert.equal(new Set(prompts).size, 1);
  assert.doesNotMatch(prompts[0], /worker|router|stock|sensor|consent|payment|meeting|2\.1|Wed09/i);
});
