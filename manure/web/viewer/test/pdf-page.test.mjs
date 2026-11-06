import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Behavioral / Active / Whitebox / Atomic; regression: a stalled PDF GetPage
// must be covered by the page-operation deadline, not just canvas rendering.
// Extract the actual production closure, injecting only its browser dependencies.
const source = await readFile(new URL('../src/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function render(number) {');
const end = source.indexOf('\n  await render(1);', start);
assert.ok(start > 0 && end > start);
function harness(getPage) {
  const timers = new Map(); let serial = 0; let destroyed = 0;
  const errors = [];
  const context = {
    doc: {numPages:2, getPage, destroy:() => { destroyed++; return Promise.resolve(); }},
    busy:false, pageNumber:1, previous:{}, next:{}, canvas:{getContext:() => ({})}, label:{},
    fail:error => errors.push(error.message),
    setTimeout:(callback, ms) => { const id = ++serial; timers.set(id,{callback,ms}); return id; },
    clearTimeout:id => timers.delete(id),
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start,end)}\nglobalThis.renderPage = render;`, context);
  return {context,timers,errors,get destroyed() {return destroyed;}};
}
function expire(h) {
  assert.equal(h.timers.size,1,'GetPage must immediately have a deadline timer');
  const timer = [...h.timers.values()][0];
  assert.equal(timer.ms,15000);
  timer.callback();
}
async function settled(pending) {
  let timer;
  try { await Promise.race([pending, new Promise((_,reject) => {timer = setTimeout(() => reject(new Error('Page deadline failed to settle navigation')),100);})]); }
  finally {clearTimeout(timer);}
}
test('production page navigation has a deadline while GetPage never resolves', async () => {
  const h = harness(() => new Promise(() => {}));
  const pending = h.context.renderPage(1);
  expire(h);
  await settled(pending);
  assert.equal(h.destroyed,1,'timeout must destroy the document/worker');
  assert.match(h.errors.join(' '), /15 second.*deadline/i);
  assert.equal(h.context.busy,false,'navigation must leave the busy state');
  assert.equal(h.timers.size,0);
});
test('late GetPage reply is cleaned without starting a render', async () => {
  let reply; let cleaned = 0; let rendered = 0;
  const h = harness(() => new Promise(resolve => {reply = resolve;}));
  const pending = h.context.renderPage(1);
  expire(h); await settled(pending);
  reply({cleanup:() => cleaned++, render:() => rendered++});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cleaned,1); assert.equal(rendered,0);
  assert.equal(h.context.label.textContent,undefined);
});
test('stalled canvas render is cancelled and page cleaned on the same deadline', async () => {
  let cleaned = 0; let cancelled = 0;
  const h = harness(async () => ({
    getViewport:() => ({width:100,height:100}), cleanup:() => cleaned++,
    render:() => ({promise:new Promise(() => {}), cancel:() => cancelled++}),
  }));
  const pending = h.context.renderPage(1);
  await new Promise(resolve => setImmediate(resolve));
  expire(h); await settled(pending);
  assert.equal(cancelled,1); assert.equal(cleaned,1); assert.equal(h.destroyed,1);
  assert.equal(h.errors.length,1);
});
test('successful page render clears deadline and preserves live document', async () => {
  let cleaned = 0;
  const h = harness(async () => ({
    getViewport:() => ({width:100,height:100}), cleanup:() => cleaned++,
    render:() => ({promise:Promise.resolve()}),
  }));
  await settled(h.context.renderPage(2));
  assert.equal(cleaned,1); assert.equal(h.destroyed,0); assert.equal(h.timers.size,0);
  assert.equal(h.context.label.textContent,'Page 2 of 2');
  assert.equal(h.errors.length,0); assert.equal(h.context.busy,false);
});
