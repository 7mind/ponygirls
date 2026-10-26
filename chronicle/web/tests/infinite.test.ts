import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedSurvivors, uniqueItems } from '../src/infinite.ts';
interface Item { id: string; value: number }
const id = (item: Item) => item.id;
test('BA specified: page append deduplicates stable IDs without changing their first-seen order', () => {
  assert.deepEqual(uniqueItems([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'a', value: 3 }, { id: 'c', value: 4 }], id), [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 4 }]);
});
test('BA specified: successful authorized membership shrink removes excluded IDs and updates common values without prepending arrivals', () => {
  const old = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }], fresh = [{ id: 'new', value: 9 }, { id: 'c', value: 30 }, { id: 'a', value: 10 }];
  assert.deepEqual(authorizedSurvivors(old, fresh, id), [{ id: 'a', value: 10 }, { id: 'c', value: 30 }]);
  assert.deepEqual(authorizedSurvivors(old, [], id), []);
});
