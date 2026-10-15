import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const SDK = process.env.PI_SUBAGENTS_SDK_ROOT;
const agentDir = process.env.PI_SUBAGENTS_AGENT_DIR;
const mode = process.env.PI_CONTROLLER_PUBLIC_ORIGINAL_STREAM_FAULT;
assert.equal(typeof SDK, 'string', 'CONTROLLER_SETUP: pinned public package resolution root required');
assert.equal(typeof agentDir, 'string', 'CONTROLLER_SETUP: owned worker agentDir required');
assert.ok(['result-reject', 'end-without-result', 'end-native', 'iterator-create-throw'].includes(mode));
const resolvePublic = (name) => {
  const packageDir = join(SDK, 'node_modules', name);
  const metadata = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  assert.equal(metadata.name, name, 'CONTROLLER_SETUP: authoritative package identity required');
  assert.equal(metadata.version, '1.2.0', 'CONTROLLER_SETUP: pinned public package version required');
  const publicImport = metadata.exports['.'].import;
  assert.equal(publicImport, './dist/index.js', 'CONTROLLER_SETUP: actual public ESM root export required');
  return new URL(publicImport, pathToFileURL(packageDir + '/')).href;
};
const { Agent } = await import(resolvePublic('@earendil-works/pi-agent-core'));
const { createAssistantMessageEventStream } = await import(resolvePublic('@earendil-works/pi-ai'));
assert.equal(typeof createAssistantMessageEventStream, 'function');
const originalSubscribe = Agent.prototype.subscribe;
const initialized = new WeakSet();
Agent.prototype.subscribe = function (...args) {
  if (!initialized.has(this)) {
    initialized.add(this);
    assert.equal(typeof this.streamFunction, 'function', 'CONTROLLER_SETUP: actual original public SDK data field required');
    const original = this.streamFunction;
    let armed = true;
    this.streamFunction = function (model, context, options) {
      if (!armed) return Reflect.apply(original, this, [model, context, options]);
      armed = false;
      assert.equal(typeof model.provider, 'string');
      assert.equal(typeof model.id, 'string');
      assert.equal(typeof options.signal.addEventListener, 'function', 'CONTROLLER_SETUP: real original request abort signal required');
      const witness = { phase: 'actual-original-public-StreamFn-invocation', pid: process.pid, mode, model: { provider: model.provider, id: model.id, api: model.api }, iterationEnded: false, resultEntered: 0, resultSettled: false, abortObserved: false, iteratorFactoryThrew: false, publicPumpFailure: false };
      const checkpoint = () => writeFileSync(join(agentDir, 'controller-public-original-stream-fault-r8-parent-checkpoint.json'), JSON.stringify(witness));
      const originalStderrWrite = process.stderr.write;
      process.stderr.write = function (...writeArgs) {
        if (typeof writeArgs[0] === 'string' && writeArgs[0].includes('STREAM_PUMP_FAILED')) {
          witness.publicPumpFailure = true;
          checkpoint();
        }
        return Reflect.apply(originalStderrWrite, this, writeArgs);
      };
      const stream = createAssistantMessageEventStream();
      const originalResult = stream.result.bind(stream);
      const originalIterator = stream[Symbol.asyncIterator].bind(stream);
      const abortResult = mode === 'end-without-result' || mode === 'iterator-create-throw' ? new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          witness.abortObserved = true;
          checkpoint();
          reject(new Error('CONTROLLER_OWNED_EMPTY_ENDED_STREAM_ABORT_JOIN'));
        }, { once: true });
      }) : null;
      stream.result = function () {
        witness.resultEntered += 1;
        checkpoint();
        const result = mode === 'result-reject'
          ? Promise.reject(new Error('WORKER_ORIGINAL_FAULT_PUBLIC_RESULT_REJECTION'))
          : abortResult === null ? originalResult() : Promise.race([originalResult(), abortResult]);
        return result.then((message) => { witness.resultSettled = true; checkpoint(); return message; }, (error) => { witness.resultSettled = true; checkpoint(); throw error; });
      };
      stream[Symbol.asyncIterator] = mode === 'iterator-create-throw' ? function () {
        witness.iteratorFactoryThrew = true;
        checkpoint();
        throw new Error('CONTROLLER_R8_PUBLIC_ITERATOR_FACTORY_THROW');
      } : async function* () {
        const iterator = originalIterator();
        while (true) {
          const item = await iterator.next();
          if (item.done) { witness.iterationEnded = true; checkpoint(); return; }
          yield item.value;
        }
      };
      stream.end();
      checkpoint();
      return stream;
    };
  }
  return Reflect.apply(originalSubscribe, this, args);
};
