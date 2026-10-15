import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const SDK = process.env.PI_SUBAGENTS_SDK_ROOT;
const agentDir = process.env.PI_SUBAGENTS_AGENT_DIR;
assert.equal(typeof SDK, 'string');
assert.equal(typeof agentDir, 'string');
assert.equal(process.env.PI_CONTROLLER_PUBLIC_ORIGINAL_STREAM_FAULT, 'iterator-next-sync-throw');
const resolvePublic = (name) => {
  const packageDir = join(SDK, 'node_modules', name);
  const metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(metadata.name, name);
  assert.equal(metadata.version, '1.2.0');
  assert.equal(metadata.exports['.'].import, './dist/index.js');
  return new URL(metadata.exports['.'].import, pathToFileURL(packageDir + '/')).href;
};
const { Agent } = await import(resolvePublic('@earendil-works/pi-agent-core'));
const { createAssistantMessageEventStream } = await import(resolvePublic('@earendil-works/pi-ai'));
const subscribe = Agent.prototype.subscribe;
const initialized = new WeakSet();
Agent.prototype.subscribe = function (...args) {
  if (!initialized.has(this)) {
    initialized.add(this);
    const original = this.streamFunction;
    assert.equal(typeof original, 'function');
    let armed = true;
    this.streamFunction = function (model, context, options) {
      if (!armed) return Reflect.apply(original, this, [model, context, options]);
      armed = false;
      assert.equal(typeof options.signal.addEventListener, 'function');
      const witness = { phase: 'actual-original-public-StreamFn-invocation', pid: process.pid, mode: 'iterator-next-sync-throw', model: { provider: model.provider, id: model.id, api: model.api }, iterationEnded: false, resultEntered: 0, resultSettled: false, abortObserved: false, iteratorFactoryThrew: false, iteratorNextThrew: false, publicPumpFailure: false };
      const checkpoint = () => writeFileSync(join(agentDir, 'controller-public-original-stream-fault-r8-parent-checkpoint.json'), JSON.stringify(witness));
      const stderrWrite = process.stderr.write;
      process.stderr.write = function (...writeArgs) {
        if (typeof writeArgs[0] === 'string' && writeArgs[0].includes('STREAM_PUMP_FAILED')) {
          witness.publicPumpFailure = true;
          checkpoint();
        }
        return Reflect.apply(stderrWrite, this, writeArgs);
      };
      const stream = createAssistantMessageEventStream();
      const rawResult = stream.result.bind(stream);
      const abortResult = new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        witness.abortObserved = true;
        checkpoint();
        reject(new Error('CONTROLLER_R10_NEXT_SYNC_OWNED_ABORT_JOIN'));
      }, { once: true }));
      stream.result = function () {
        witness.resultEntered += 1;
        checkpoint();
        return Promise.race([rawResult(), abortResult]).then((message) => { witness.resultSettled = true; checkpoint(); return message; }, (error) => { witness.resultSettled = true; checkpoint(); throw error; });
      };
      stream[Symbol.asyncIterator] = function () {
        return { next() {
          witness.iteratorNextThrew = true;
          checkpoint();
          throw new Error('CONTROLLER_R10_ORIGINAL_ITERATOR_NEXT_SYNCHRONOUS_THROW');
        } };
      };
      stream.end();
      checkpoint();
      return stream;
    };
  }
  return Reflect.apply(subscribe, this, args);
};
