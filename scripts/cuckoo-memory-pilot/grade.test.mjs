import test from 'node:test';
import assert from 'node:assert/strict';
import { grade } from './grade.mjs';
import { DEVELOPMENT_IDS, HELD_OUT_IDS, getCase } from './cases.mjs';

const GOOD = {
  upgrade: { operations: [{ component: 'exporter', target: '1.2', image: 'copper', rollback: '0.9' }, { component: 'worker', target: '2.1', image: 'amber', rollback: '1.5' }], sources: ['upgrade-scope-amendment-r11', 'upgrade-inventory-correction-r11', 'upgrade-compatibility-correction-r11', 'upgrade-exporter-prerequisite-r11'] },
  stock: { preserve: ['rA'], cancel: ['B'], allocate: [{ order: 'D', warehouse: 'E', quantity: 3 }], defer: ['C'], free: { W: 1, E: 1 }, sources: ['stock-reservation-amendment-r2', 'stock-free-correction-r2', 'stock-demand-amendment-r2'] },
  meeting: { slot: 'Wed09', attendees: ['Q', 'R'], retire: ['M0'], sources: ['meeting-roster-amendment-r2', 'meeting-facilities-correction-r2', 'meeting-availability-amendment-r2'] },
  consent: { rows: [{ id: 'c', amount: 12, owner: '[redacted]' }, { id: 'd', amount: 7, owner: '[redacted]' }], total: 19, sources: ['consent-identity-correction-r2', 'consent-current-confirmation-r3', 'consent-row-amendment-r2'] },
  payments: { invoices: [{ id: 'I1', credited: 100, due: 0 }, { id: 'I2', credited: 45, due: 0 }, { id: 'I4', credited: 0, due: 20 }], totalCredited: 145, totalDue: 20, sources: ['payments-ledger-correction-r2', 'payments-export-primary-r2', 'payments-export-mirror-r2', 'payments-scope-amendment-r2'] },
  sensors: { alerts: [{ id: 's3', celsius: 29 }, { id: 's4', celsius: 32 }], meanCelsius: 30.5, sources: ['sensors-unit-correction-r2', 'sensors-region-correction-r2', 'sensors-policy-amendment-r2', 'sensors-addition-r2'] },
};
const MUTATIONS = {
  upgrade: [v => { v.operations[1].target = '2.0'; }, v => { v.operations[1].image = 'cobalt'; }, v => { v.operations[1].rollback = '1.4'; }, v => v.operations.reverse(), v => v.operations.shift(), v => { v.operations[0].component = 'ledger'; }, v => { v.operations[0].target = 1.2; }, v => v.operations.push({ component: 'router', target: '3.0', image: 'silver', rollback: '2.0' })],
  stock: [v => { v.preserve = ['A']; }, v => { v.preserve = []; }, v => { v.cancel = []; }, v => { v.allocate[0].quantity = 2; }, v => { v.allocate[0].warehouse = 'W'; }, v => { v.free.W = -3; }, v => { v.free.W = 8; }, v => { v.defer = []; }, v => v.allocate.push({ order: 'A', warehouse: 'W', quantity: 4 }), v => v.allocate.push({ order: 'B', warehouse: 'E', quantity: 3 }), v => v.allocate.push({ order: 'C', warehouse: 'W', quantity: 2 }), v => { v.allocate = [{ order: 'D', warehouse: 'W', quantity: 1 }, { order: 'D', warehouse: 'E', quantity: 2 }]; }],
  meeting: [v => { v.slot = 'Mon09'; }, v => { v.slot = 'Tue09'; }, v => { v.attendees = ['P', 'R']; }, v => v.attendees.reverse(), v => { v.retire = []; }, v => { v.attendees = ['Q']; }, v => { v.slot = 'Wed09 (earliest)'; }],
  consent: [v => v.rows.unshift({ id: 'a', amount: 5, owner: '[redacted]' }), v => v.rows.unshift({ id: 'b', amount: 8, owner: '[redacted]' }), v => v.rows.shift(), v => v.rows.pop(), v => { v.rows[0].owner = 'owner-c'; }, v => { v.rows[1].owner = 'redacted'; }, v => { v.total = 18; }, v => { v.total = '19'; }, v => v.rows.reverse(), v => { v.rows[0].amount = 13; }],
  payments: [v => { v.invoices[1].credited = 60; }, v => { v.invoices[1].credited = 90; }, v => { v.invoices[1].due = 15; }, v => v.invoices.pop(), v => { v.totalCredited = 160; }, v => { v.totalDue = 21; }, v => v.invoices.reverse(), v => v.invoices.splice(2, 0, { id: 'I3', credited: 0, due: 30 })],
  sensors: [v => v.alerts.unshift({ id: 's1', celsius: 32 }), v => v.alerts.unshift({ id: 's2', celsius: 31 }), v => v.alerts.shift(), v => v.alerts.pop(), v => { v.meanCelsius = null; }, v => { v.meanCelsius = 31.5; }, v => v.alerts.reverse(), v => { v.alerts[1].celsius = 0; }, v => { v.alerts = []; }],
};

// Behavioral-Active / Blackbox-Atomic: independent examples and destructive mutations, not live-model quality.
for (const id of [...DEVELOPMENT_IDS, ...HELD_OUT_IDS]) {
  test(`${id}: exact current artifact passes; object/source ordering is not material`, () => {
    const result = grade(id, JSON.stringify(GOOD[id]));
    assert.equal(result.perfect, true); assert.ok(result.checks.every(check => check.pass)); assert.ok(result.staleChecks.every(check => !check.reused));
    const reordered = Object.fromEntries(Object.entries(structuredClone(GOOD[id])).reverse()); reordered.sources.reverse();
    assert.equal(grade(id, JSON.stringify(reordered)).perfect, true);
  });
  test(`${id}: stale, partial, out-of-scope and incorrect-value artifacts fail`, () => {
    for (const mutate of MUTATIONS[id]) { const value = structuredClone(GOOD[id]); mutate(value); assert.equal(grade(id, JSON.stringify(value)).perfect, false, JSON.stringify(value)); }
    assert.ok(MUTATIONS[id].some(mutate => { const value = structuredClone(GOOD[id]); mutate(value); return grade(id, JSON.stringify(value)).staleChecks.some(check => check.reused); }));
  });
  test(`${id}: source provenance requires current records and permits relevant originals`, () => {
    const task = getCase(id);
    for (const required of GOOD[id].sources) {
      assert.ok(task.documents.some(record => record.id === required && record.availableFrom === 1));
      const value = structuredClone(GOOD[id]); value.sources = value.sources.filter(source => source !== required);
      assert.equal(grade(id, JSON.stringify(value)).checks.find(check => check.name === 'sources').pass, false);
    }
    const extra = structuredClone(GOOD[id]); extra.sources.push(...task.documents.filter(record => record.availableFrom === 0).map(record => record.id));
    assert.equal(grade(id, JSON.stringify(extra)).perfect, true);
    for (const source of ['unknown', 'other-case-initial-contract', GOOD[id].sources[0], task.documents.find(record => record.id.includes('-historical-')).id]) {
      const value = structuredClone(GOOD[id]); value.sources.push(source); assert.equal(grade(id, JSON.stringify(value)).perfect, false);
    }
  });
  test(`${id}: malformed, ambiguous, wrong-typed and extra fields fail without exceptions`, () => {
    for (const text of ['', '{', '{} trailing', 'prefix {}', '{"x":NaN}', '{"x":1,}', '```json\n{}\n```', '{}\n{}', '{"x":1,"x":2}', '{"x":{"a":1,"\\u0061":2}}', undefined, null, 42, {}]) {
      const result = grade(id, text); assert.equal(result.parsed, false, String(text)); assert.equal(result.perfect, false);
    }
    for (const text of ['null', 'true', '42', '"text"', '[]', '{}']) assert.equal(grade(id, text).perfect, false);
    for (const key of Object.keys(GOOD[id])) for (const replacement of [null, true, 'wrong', [], {}, 1e300]) {
      const value = structuredClone(GOOD[id]); value[key] = replacement; assert.equal(grade(id, JSON.stringify(value)).perfect, false);
    }
    const extra = { ...GOOD[id], extra: true }; assert.equal(grade(id, JSON.stringify(extra)).perfect, false);
    const missing = structuredClone(GOOD[id]); delete missing[Object.keys(missing)[0]]; assert.equal(grade(id, JSON.stringify(missing)).perfect, false);
  });
}

test('unknown case IDs are errors rather than successful empty grades', () => {
  for (const id of ['missing', '__proto__', 'toString', null]) assert.throws(() => grade(id, '{}'), RangeError);
});
