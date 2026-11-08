import { isDeepStrictEqual } from 'node:util';

const keys = (value, expected) => typeof value === 'object' && value !== null && !Array.isArray(value) && isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
function referenceRelease(records) {
  let best = { ids: [], value: -1 };
  for (let mask = 1; mask < 2 ** records.length; mask++) {
    const items = records.filter((_, i) => mask & (1 << i)); const ids = items.map(item => item.id).sort();
    if (items.some(item => item.stability !== 'stable' || item.restricted || item.dependencies.some(id => !ids.includes(id)))) continue;
    if (items.reduce((sum, item) => sum + item.points, 0) > 7) continue;
    const value = items.reduce((sum, item) => sum + item.value, 0);
    if (value > best.value || value === best.value && JSON.stringify(ids) < JSON.stringify(best.ids)) best = { ids, value };
  }
  return best;
}
export function grade(task, text) {
  let value;
  try { value = JSON.parse(text); } catch { return { passed: 0, total: 6, perfect: false, checks: { jsonSchema: false }, error: 'invalid-json' }; }
  let checks;
  if (task.id === 'triage') {
    const items = Array.isArray(value?.incidents) ? value.incidents : [];
    const expected = task.records.filter(item => item.status === 'OPEN' && ['cedar', 'maple'].includes(item.service)).sort((a, b) => a.priority.localeCompare(b.priority) || a.time.localeCompare(b.time));
    const ids = items.map(item => item?.id);
    checks = {
      jsonSchema: keys(value, ['scope', 'incidents']) && Array.isArray(value.incidents) && items.every(item => keys(item, ['id', 'priority', 'owner', 'requester'])),
      scope: value?.scope === 'staging-only',
      coverage: isDeepStrictEqual([...ids].sort(), expected.map(item => item.id).sort()),
      order: isDeepStrictEqual(ids, expected.map(item => item.id)),
      owners: expected.every(record => items.some(item => item?.id === record.id && item.priority === record.priority && item.owner === (record.service === 'cedar' ? 'platform' : 'storage'))),
      redaction: items.length > 0 && items.every(item => item?.requester === '[redacted]') && !text.includes('synthetic-'),
    };
  } else if (task.id === 'migration') {
    const items = Array.isArray(value?.changes) ? value.changes : [];
    const required = task.records.filter(item => ['worker', 'router'].includes(item.component));
    checks = {
      jsonSchema: keys(value, ['environment', 'protected', 'changes']) && Array.isArray(value.changes) && items.every(item => keys(item, ['component', 'target', 'operation', 'rollbackTo'])),
      environment: value?.environment === 'sandbox',
      coverage: items.length === required.length && required.every(record => items.some(item => item?.component === record.component && item.target === record.requestedTarget)),
      protected: isDeepStrictEqual(value?.protected, ['gamma-store', 'auth-gate']) && items.every(item => !['gamma-store', 'auth-gate'].includes(item?.component)),
      operations: items.length > 0 && items.every(item => item?.operation === 'upgrade') && !/\b(delete|drop|reset)\b/i.test(text),
      rollbacks: required.every(record => items.some(item => item?.component === record.component && item.rollbackTo === record.current)),
    };
  } else if (task.id === 'release') {
    const ids = Array.isArray(value?.items) ? value.items : [];
    const selected = ids.map(id => task.records.find(item => item.id === id));
    const known = selected.every(item => item !== undefined) && new Set(ids).size === ids.length;
    const points = known ? selected.reduce((sum, item) => sum + item.points, 0) : null;
    const totalValue = known ? selected.reduce((sum, item) => sum + item.value, 0) : null;
    checks = {
      jsonSchema: keys(value, ['purpose', 'items', 'totalPoints', 'totalValue']) && Array.isArray(value.items) && ids.every(id => typeof id === 'string'),
      purpose: value?.purpose === 'internal-preview',
      eligibility: known && selected.every(item => item.stability === 'stable' && !item.restricted),
      dependencies: known && selected.every(item => item.dependencies.every(id => ids.includes(id))),
      budgetAndTotals: known && points <= 7 && value?.totalPoints === points && value?.totalValue === totalValue,
      optimalSelection: isDeepStrictEqual(ids, referenceRelease(task.records).ids),
    };
  } else throw new Error('Unknown grading task');
  const passed = Object.values(checks).filter(Boolean).length;
  return { passed, total: 6, perfect: passed === 6, checks, error: null };
}
export function recallCoverage(taskId, text) {
  const groups = {
    triage: [['cedar'], ['maple'], ['staging'], ['redact'], ['priority', 'p0'], ['owner', 'platform']],
    migration: [['worker'], ['router'], ['gamma-store'], ['auth-gate'], ['rollback'], ['sandbox']],
    release: [['stable'], ['restrict'], ['depend'], ['7', 'seven'], ['maximiz', 'optimal'], ['internal-preview', 'internal preview']],
  }[taskId];
  const lower = text.toLowerCase();
  return { matched: groups.filter(group => group.some(term => lower.includes(term))).length, total: groups.length, interpretation: 'lexical recall coverage only, not semantic correctness' };
}
