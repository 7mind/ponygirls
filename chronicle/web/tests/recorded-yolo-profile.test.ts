import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordedYoloProfile } from '../src/recorded-yolo-profile.ts';
import { addExpressionFilter, addMetadataFilter } from '../src/expression.ts';

interface ProfileCase { rootId: string; profile: string | null }
const cases = JSON.parse(readFileSync(new URL('../../tests/recorded-yolo-profile-cases.json', import.meta.url), 'utf8')) as ProfileCase[];
test('BA: recorded yolo profile preserves only exact validated root claims, including case and whole-string boundaries', () => {
  for (const { rootId, profile } of cases) assert.equal(recordedYoloProfile(rootId), profile ?? undefined, JSON.stringify(rootId));
});
test('BA: recorded yolo profile composes as a separate literal metadata field', () => {
  assert.equal(addMetadataFilter('profile:index-policy OR agent:main', 'yolo-profile', 'Foo'), '(profile:index-policy OR agent:main) AND yolo-profile:"Foo"');
  assert.equal(addExpressionFilter('mode:lexical project:x', 'yolo-profile', 'foo'), 'mode:lexical (project:x) AND yolo-profile:"foo"');
});
