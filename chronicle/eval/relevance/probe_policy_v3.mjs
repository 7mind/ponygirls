import assert from 'node:assert/strict';
import { verifyAgentBindings } from './live_protocol.mjs';
import { PROTOCOL_V3, MAX_OUTPUT_TOKENS_V3, expectedToolsV3, uniformPromptV3 } from './agent_protocol_v3.mjs';

export function verifyProbeInput(input) {
  verifyAgentBindings(input);
  assert.equal(input.protocolPolicy, PROTOCOL_V3, 'explicit current protocol policy required');
  expectedToolsV3(input.catalogVariant);
  assert.equal(input.agentReasoningPolicy, 'max');
  assert.equal(input.agentMaximumOutputTokens, MAX_OUTPUT_TOKENS_V3);
  assert.equal(input.relatedPolicy, 'deny');
  assert.equal(input.factFormat, 'ordered-string-values-v1');
  assert.ok(Array.isArray(input.tasks) && input.tasks.length === 1, 'exactly one scheduled opaque task required');
  uniformPromptV3(input.tasks[0], input.project, input.mode);
  const cell = input.scheduleCell;
  assert.ok(cell !== null && typeof cell === 'object');
  assert.deepEqual(Object.keys(cell).sort(), ['arm', 'batchId', 'mode', 'ordinal', 'repeat', 'taskId']);
  for (const key of ['arm', 'batchId', 'taskId']) assert.ok(typeof cell[key] === 'string' && cell[key].length > 0);
  assert.ok(Number.isInteger(cell.repeat) && cell.repeat > 0);
  assert.ok(Number.isInteger(cell.ordinal) && cell.ordinal >= 0);
  assert.equal(cell.mode, input.mode);
}

export function probeRunMetadata(input, task, identity, apiVersion) {
  verifyProbeInput(input);
  assert.deepEqual(task, input.tasks[0]);
  assert.ok(typeof apiVersion === 'string' && apiVersion.length > 0, 'loaded API version required');
  return { ...identity, taskId: task.id, prompt: uniformPromptV3(task, input.project, input.mode),
    apiVersion, protocolPolicy: input.protocolPolicy, catalogVariant: input.catalogVariant,
    scheduleCell: input.scheduleCell,
    controlAuthority: 'browser session; model receives read-only tool catalog only' };
}
