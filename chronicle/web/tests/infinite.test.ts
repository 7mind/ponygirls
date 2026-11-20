import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizedSurvivors, positionalPages, uniqueItems } from '../src/infinite.ts';
interface Item { id: string; value: number }
const id = (item: Item) => item.id;
const positions = (from: number, to: number) => Array.from({ length: to - from }, (_, index) => from + index);
/** A list of `total` positions (each item is its position) whose server returns at most `bound` items per read, as a byte bound does. */
function boundedServer(total: number, bound: number) {
  const reads: [number, number][] = [];
  return { reads, read: async (offset: number, limit: number) => { reads.push([offset, limit]); return { items: positions(offset, Math.min(offset + limit, offset + bound, total)), total }; } };
}
test('BA specified: a short page before the loaded ones reads on until it ends exactly where they begin; a short later page is kept as it is', async () => {
  const server = boundedServer(200, 7), load = positionalPages(server.read, 40, 120, 120);
  const first = await load(120, undefined);
  assert.deepEqual([first.items, first.next, first.previous], [positions(120, 127), 127, 80]);
  const earlier = await load(first.previous, first);
  assert.deepEqual([earlier.items, earlier.next, earlier.meta], [positions(80, 120), 120, { offset: 80, total: 200 }]);
  assert.deepEqual(server.reads, [[120, 40], [80, 40], [87, 33], [94, 26], [101, 19], [108, 12], [115, 5]]);
});
test('BA specified: the first page of a jump reads on from its page start until it holds the target position', async () => {
  const server = boundedServer(200, 7), load = positionalPages(server.read, 40, 160, 185);
  const page = await load(160, undefined);
  assert.deepEqual([page.items, page.next, page.meta], [positions(160, 188), 188, { offset: 160, total: 200 }]);
  assert.deepEqual(server.reads, [[160, 40], [167, 33], [174, 26], [181, 19]]);
});
test('BA specified: single-item reads reach a jump target and fill an earlier page, one read per missing item', async () => {
  const server = boundedServer(45, 1), load = positionalPages(server.read, 40, 40, 44);
  const page = await load(40, undefined);
  assert.deepEqual([page.items, page.next], [positions(40, 45), undefined]);
  const earlier = await load(page.previous, page);
  assert.deepEqual([earlier.items, earlier.next, earlier.previous], [positions(0, 40), 40, undefined]);
  assert.deepEqual(server.reads, [...positions(40, 45).map(offset => [offset, 80 - offset]), ...positions(0, 40).map(offset => [offset, 40 - offset])]);
});
test('BA specified: an empty read where items remain is an error, not another read; an empty list is an empty page', async () => {
  const reads: number[] = [];
  const load = positionalPages(async offset => { reads.push(offset); return { items: offset < 2 ? [offset] : [], total: 10 }; }, 40, 0, 5);
  await assert.rejects(load(0, undefined), { message: 'The server returned an empty page at position 3 of 10' });
  assert.deepEqual(reads, [0, 1, 2]);
  const empty = await positionalPages(async () => ({ items: [], total: 0 }), 40, 0, 0)(0, undefined);
  assert.deepEqual([empty.items, empty.next, empty.previous], [[], undefined, undefined]);
});
test('BA specified: page append deduplicates stable IDs without changing their first-seen order', () => {
  assert.deepEqual(uniqueItems([{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'a', value: 3 }, { id: 'c', value: 4 }], id), [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 4 }]);
});
test('BA specified: successful authorized membership shrink removes excluded IDs and updates common values without prepending arrivals', () => {
  const old = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }], fresh = [{ id: 'new', value: 9 }, { id: 'c', value: 30 }, { id: 'a', value: 10 }];
  assert.deepEqual(authorizedSurvivors(old, fresh, id), [{ id: 'a', value: 10 }, { id: 'c', value: 30 }]);
  assert.deepEqual(authorizedSurvivors(old, [], id), []);
});
