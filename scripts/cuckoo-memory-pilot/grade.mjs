import { isDeepStrictEqual as same } from 'node:util';
import { getCase } from './cases.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function valid(value, schema) {
  if (Array.isArray(schema.type)) return schema.type.some(type => valid(value, { ...schema, type }));
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string';
  if (schema.type === 'number' || schema.type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isInteger(value)) && (schema.minimum === undefined || value >= schema.minimum);
  if (schema.type === 'array') {
    if (!Array.isArray(value) || !value.every(item => valid(item, schema.items))) return false;
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(canonical(item)))).size !== value.length) return false;
    if (schema.items.type === 'object') {
      const identity = ['id', 'component', 'order'].find(key => Object.hasOwn(schema.items.properties, key));
      if (identity !== undefined && new Set(value.map(item => item[identity])).size !== value.length) return false;
    }
    return true;
  }
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === schema.required.length && schema.required.every(key => Object.hasOwn(value, key) && valid(value[key], schema.properties[key]));
  throw new Error('Unsupported evaluator schema');
}

function hasDuplicateKeys(text) {
  let index = 0; let duplicate = false;
  const space = () => { while (index < text.length && /\s/.test(text[index])) index++; };
  function string() {
    const start = index++;
    while (index < text.length) { if (text[index] === '\\') index += 2; else if (text[index++] === '"') break; }
    return JSON.parse(text.slice(start, index));
  }
  function visit() {
    space();
    if (text[index] === '{') {
      index++; space(); const keys = new Set();
      if (text[index] === '}') { index++; return; }
      while (true) { const key = string(); if (keys.has(key)) duplicate = true; keys.add(key); space(); index++; visit(); space(); if (text[index++] === '}') return; space(); }
    }
    if (text[index] === '[') {
      index++; space(); if (text[index] === ']') { index++; return; }
      while (true) { visit(); space(); if (text[index++] === ']') return; }
    }
    if (text[index] === '"') { string(); return; }
    while (index < text.length && !/[\s,\]}]/.test(text[index])) index++;
  }
  visit(); return duplicate;
}
const rows = (value, key) => Array.isArray(value?.[key]) ? value[key] : [];
const any = (value, key, predicate) => rows(value, key).some(row => row !== null && typeof row === 'object' && predicate(row));

const SPECS = {
  upgrade: {
    requiredSources: ['upgrade-scope-amendment-r11', 'upgrade-inventory-correction-r11', 'upgrade-compatibility-correction-r11', 'upgrade-exporter-prerequisite-r11'],
    checks: [
      ['scope-and-order', v => same(v.operations.map(row => row.component), ['exporter', 'worker'])],
      ['targets', v => same(v.operations.map(row => row.target), ['1.2', '2.1'])],
      ['images', v => same(v.operations.map(row => row.image), ['copper', 'amber'])],
      ['actual-prechange-rollbacks', v => same(v.operations.map(row => row.rollback), ['0.9', '1.5'])],
    ],
    stale: [['cancelled-router', v => any(v, 'operations', r => r.component === 'router')], ['obsolete-worker-target', v => any(v, 'operations', r => r.component === 'worker' && r.target === '2.0')], ['obsolete-worker-image', v => any(v, 'operations', r => r.component === 'worker' && r.image === 'cobalt')], ['obsolete-worker-rollback', v => any(v, 'operations', r => r.component === 'worker' && r.rollback === '1.4')]],
  },
  stock: {
    requiredSources: ['stock-reservation-amendment-r2', 'stock-free-correction-r2', 'stock-demand-amendment-r2'],
    checks: [
      ['preserved-reservations-and-cancellations', v => same(v.preserve, ['rA']) && same(v.cancel, ['B'])],
      ['whole-order-allocations', v => same(v.allocate, [{ order: 'D', warehouse: 'E', quantity: 3 }])],
      ['deferrals', v => same(v.defer, ['C'])], ['reservation-exclusive-free-stock', v => same(v.free, { W: 1, E: 1 })],
    ],
    stale: [['cancelled-order-B-allocated', v => any(v, 'allocate', r => r.order === 'B')], ['reserved-order-A-reallocated', v => any(v, 'allocate', r => r.order === 'A')], ['formerly-feasible-order-C-allocated', v => any(v, 'allocate', r => r.order === 'C')], ['obsolete-W-free-count', v => v?.free?.W === 8]],
  },
  meeting: {
    requiredSources: ['meeting-roster-amendment-r2', 'meeting-facilities-correction-r2', 'meeting-availability-amendment-r2'],
    checks: [['earliest-feasible-slot', v => v.slot === 'Wed09'], ['current-required-attendees', v => same(v.attendees, ['Q', 'R'])], ['superseded-bookings', v => same(v.retire, ['M0'])]],
    stale: [['obsolete-Mon09-slot', v => v?.slot === 'Mon09'], ['other-meeting-Tue09-slot', v => v?.slot === 'Tue09'], ['replaced-attendee-P', v => rows(v, 'attendees').includes('P')]],
  },
  consent: {
    requiredSources: ['consent-identity-correction-r2', 'consent-current-confirmation-r3', 'consent-row-amendment-r2'],
    checks: [['eligible-rows-and-order', v => same(v.rows.map(r => r.id), ['c', 'd'])], ['unchanged-amounts', v => same(v.rows.map(r => r.amount), [12, 7])], ['literal-owner-redaction', v => same(v.rows.map(r => r.owner), ['[redacted]', '[redacted]'])], ['published-total', v => v.total === 19]],
    stale: [['withdrawn-row-a', v => any(v, 'rows', r => r.id === 'a')], ['withdrawn-row-b', v => any(v, 'rows', r => r.id === 'b')], ['unredacted-synthetic-owner', v => any(v, 'rows', r => ['owner-a', 'owner-b', 'owner-c', 'owner-d'].includes(r.owner))]],
  },
  payments: {
    requiredSources: ['payments-ledger-correction-r2', 'payments-export-primary-r2', 'payments-export-mirror-r2', 'payments-scope-amendment-r2'],
    checks: [['active-invoice-scope-and-order', v => same(v.invoices.map(r => r.id), ['I1', 'I2', 'I4'])], ['nonvoid-deduplicated-credits', v => same(v.invoices.map(r => r.credited), [100, 45, 0])], ['current-balances', v => same(v.invoices.map(r => r.due), [0, 0, 20])], ['report-totals', v => v.totalCredited === 145 && v.totalDue === 20]],
    stale: [['removed-invoice-I3', v => any(v, 'invoices', r => r.id === 'I3')], ['void-P2-credit', v => any(v, 'invoices', r => r.id === 'I2' && r.credited === 60)], ['original-total-credit', v => v?.totalCredited === 160]],
  },
  sensors: {
    requiredSources: ['sensors-unit-correction-r2', 'sensors-region-correction-r2', 'sensors-policy-amendment-r2', 'sensors-addition-r2'],
    checks: [['current-northern-alerts-and-order', v => same(v.alerts.map(r => r.id), ['s3', 's4'])], ['per-reading-Celsius-values', v => same(v.alerts.map(r => r.celsius), [29, 32])], ['alert-mean', v => v.meanCelsius === 30.5]],
    stale: [['obsolete-s1-alert', v => any(v, 'alerts', r => r.id === 's1')], ['obsolete-s1-Celsius-label', v => any(v, 'alerts', r => r.id === 's1' && r.celsius === 32)], ['southern-s2-alert', v => any(v, 'alerts', r => r.id === 's2')]],
  },
};

export function grade(caseId, text) {
  if (!Object.hasOwn(SPECS, caseId)) throw new RangeError(`Unknown case: ${String(caseId)}`);
  const spec = SPECS[caseId]; const task = getCase(caseId);
  let parsed = false; let value;
  if (typeof text === 'string') { try { value = JSON.parse(text); parsed = !hasDuplicateKeys(text); } catch { parsed = false; } }
  const schema = parsed && valid(value, task.schema);
  const allowedSources = new Set(task.documents.filter(record => !record.id.includes('-historical-')).map(record => record.id));
  const checks = [{ name: 'schema', pass: schema }, ...spec.checks.map(([name, check]) => ({ name, pass: schema && check(value) })),
    { name: 'sources', pass: schema && value.sources.every(id => allowedSources.has(id)) && spec.requiredSources.every(id => value.sources.includes(id)) }];
  return { parsed, checks, perfect: checks.every(check => check.pass), staleChecks: spec.stale.map(([name, check]) => ({ name, reused: parsed && check(value) })) };
}
