// Specified Behavioral-Active Blackbox-Group; controller policy without browser/provider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyProbeInput, probeRunMetadata } from '../probe_policy_v3.mjs';
import { verifyCatalogV3, finalAnswerV3, uniformPromptV3 } from '../agent_protocol_v3.mjs';

const input = () => ({protocolPolicy:'evidence-navigation-v3', catalogVariant:'context',
  agentReasoningPolicy:'max', agentMaximumOutputTokens:65536, agentRevision:'pinned', agentModel:'model',
  mode:'lexical', project:'project', relatedPolicy:'deny', factFormat:'ordered-string-values-v1',
  tasks:[{id:'opaque',question:'Which port?'}],
  scheduleCell:{batchId:'private-batch-marker',arm:'private-arm-marker',repeat:1,mode:'lexical',taskId:'private-task-id',ordinal:4}});

test('required V3 probe policy, exact task projection and schedule admission precede browser launch', () => {
  verifyProbeInput(input());
  const mutations = [i => delete i.protocolPolicy, i => i.protocolPolicy='old', i => delete i.catalogVariant,
    i => i.catalogVariant='arbitrary', i => i.agentReasoningPolicy='high', i => i.agentMaximumOutputTokens=1,
    i => i.tasks[0].facts={values:['gold']}, i => i.tasks[0].relevant=['secret-source'],
    i => i.scheduleCell.mode='hybrid', i => i.scheduleCell.repeat=true, i => i.scheduleCell.extra=true,
    i => delete i.scheduleCell, i => i.tasks=[]];
  for (const mutate of mutations) {
    const bad=input(); mutate(bad); assert.throws(() => verifyProbeInput(bad));
  }
});
test('run metadata binds actual API/protocol/variant and exact schedule without exposing evaluation identity in prompt', () => {
  const i=input(), identity={instanceId:'instance',runId:'run'};
  const run=probeRunMetadata(i,i.tasks[0],identity,'1.9.0');
  assert.equal(run.apiVersion,'1.9.0'); assert.equal(run.protocolPolicy,i.protocolPolicy);
  assert.equal(run.catalogVariant,'context'); assert.deepEqual(run.scheduleCell,i.scheduleCell);
  assert.equal(run.taskId,'opaque'); assert.equal(run.prompt,uniformPromptV3(i.tasks[0],i.project,i.mode));
  for (const hidden of ['private-task-id',i.scheduleCell.arm,i.scheduleCell.batchId,'gold','rubric']) assert.ok(!run.prompt.includes(hidden),hidden);
  assert.throws(() => probeRunMetadata(i,i.tasks[0],identity,''));
});
test('probe shared V3 helpers retain exact 9/10 catalogs, conditional prompt, and null generation response', () => {
  const catalog=JSON.parse(readFileSync(new URL('./data/recorded-agent-catalog.json',import.meta.url),'utf8')).catalog;
  const i={...input(),agentModel:catalog.model,agentRevision:catalog.modelRevision};
  verifyProbeInput(i); verifyCatalogV3(catalog,i,'baseline');
  const context={...catalog,tools:[...catalog.tools,{name:'read_message_context'}]};
  verifyCatalogV3(context,i,'context'); assert.throws(() => verifyCatalogV3(context,i,'baseline'));
  const answer={taskId:'opaque',facts:{values:['v']},abstain:false,citations:[{sessionId:'s',messageId:'m',quote:'v',view:{revision:1,generationId:null}}]};
  assert.deepEqual(finalAnswerV3([{item:{Response:{partIndex:0,partCount:1,textPart:JSON.stringify(answer)}}}],'opaque'),answer);
  assert.ok(probeRunMetadata(i,i.tasks[0],{},'1.9.0').prompt.includes('If read_message_context is available'));
});
