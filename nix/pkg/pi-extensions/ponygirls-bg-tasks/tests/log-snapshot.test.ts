import assert from "node:assert/strict";
import test from "node:test";
import { LogSnapshot, VIEW_WINDOW_BYTES } from "../src/log-snapshot.ts";

test("oversized UTF-8 records use the same display rows in both directions", async () => {
  const text = Array.from({length: 56000}, (_, i) => `${i}界`).join("");
  const file = Buffer.from(text);
  const pager = new LogSnapshot(file.length, false, async (a, b) => {
    assert.ok(a >= 0 && b > a && b <= file.length && b - a <= VIEW_WINDOW_BYTES);
    return file.subarray(a, b);
  });
  const width = 250, height = 13;
  await pager.move(width, height, 0);
  const backwards = [...pager.visible];
  while (!backwards[0]!.startsWith("0界")) {
    await pager.move(width, height, -height);
    const page = pager.visible;
    const overlap = page.indexOf(backwards[0]!);
    assert.ok(page.length && overlap !== 0, "backward paging must advance before BOF");
    backwards.unshift(...(overlap < 0 ? page : page.slice(0, overlap)));
    assert.ok(backwards.length < file.length / 10);
  }
  assert.equal(backwards.join(""), text);
  for (let top = 0; top + height < backwards.length;) {
    top = Math.min(top + height, backwards.length - height);
    await pager.move(width, height, height);
    assert.deepEqual(pager.visible, backwards.slice(top, top + height));
  }
});

test("reflow anchors the passage at the top within a wrapped record", async () => {
  const text = Array.from({length: 600}, (_, i) => `${i}`.padStart(9, "0") + ":").join("");
  const file = Buffer.from(text);
  const pager = new LogSnapshot(file.length, false, async (a, b) => file.subarray(a, b));
  await pager.move(100, 10, -10);
  await pager.move(100, 10, -10);
  assert.equal(pager.visible[0], text.slice(3000, 3100));
  await pager.move(51, 10, 0);
  const wrappedStart = Math.floor(3000 / 51) * 51;
  assert.equal(pager.visible[0], text.slice(wrappedStart, wrappedStart + 51));
});
