export const DEVELOPMENT_IDS = Object.freeze(['upgrade', 'stock']);
export const HELD_OUT_IDS = Object.freeze(['meeting', 'consent', 'payments', 'sensors']);
const string = { type: 'string' };
const number = { type: 'number' };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const array = items => ({ type: 'array', uniqueItems: true, items });
const sources = array(string);
const document = (id, availableFrom, caption, body) => ({ id, availableFrom, caption, body });

function defineCase(id, heldOut, topic, schema, rules, documents) {
  const contract = [
    `Target: ${topic}. All work is planning-only using synthetic fixtures; never perform external actions.`,
    'Use fixture_list and fixture_read to inspect evidence. Reconcile by stated target, scope and revision, not upload time. A correction changes only the facts it identifies. A late historical upload does not supersede a current correction.',
    'For each provisional, revised-provisional and final deliverable, output exactly one JSON object matching this schema, with no extra fields, prose, Markdown fences or comments. Provisional drafts are not final approval.',
    'Object key order is irrelevant, but property names must be unique, including escaped aliases. Arrays must have unique entries and record arrays unique identifying IDs. Follow the specified array order; sources may be in any order. Numbers must be finite.',
    'sources must cite every operative revision/amendment document establishing or reconciling changed decisions. Additional relevant original documents and this contract may be cited. Do not cite historical uploads as current authority. Do not include historical-upload IDs anywhere in sources, even to show that they were rejected. Use exact record IDs.',
    rules, 'Exact output schema:', JSON.stringify(schema),
  ].join('\n');
  return { id, heldOut, topic, schema,
    initialPrompt: `Begin the ongoing objective for ${topic}. Inspect fixture_list and fixture_read, including the initial contract. Return a provisional JSON artifact matching that contract. Final review will occur later; this draft is not final approval.`,
    updatePrompt: 'New revisions and amendments are available. Inspect fixture_list and fixture_read, reconcile the evidence, and return a revised provisional JSON artifact matching the initial contract. Final review will occur later; all work remains planning-only.',
    finalPrompt: `Resume final review of ${topic}. Reconcile its effective source evidence and return only the final JSON required by its initial contract. Use saved reflections if useful. This is a plan/report, not authorization for external actions.`,
    documents: [document(`${id}-initial-contract`, 0, `Initial contract for ${topic}`, contract), ...documents] };
}

const CASES = {
  upgrade: defineCase('upgrade', false, 'release plan U-current',
    object({ operations: array(object({ component: string, target: string, image: string, rollback: string })), sources }),
    'Plan only currently authorized upgrades; ledger is never in scope. operations is prerequisite execution order, each component once. Versions are strings. Rollback is the actual prechange inventory version, not an obsolete snapshot. Omit cancelled operations.', [
      document('upgrade-inventory-r10', 0, 'Original prechange inventory r10', 'U-current inventory r10: worker 1.4, router 2.0, exporter 0.9. These are observed prechange versions, not upgrade targets.'),
      document('upgrade-scope-r10', 0, 'Original authorized release scope', 'U-current scope r10: upgrade worker to 2.0 and router to 3.0; never ledger. No exporter upgrade is authorized by r10.'),
      document('upgrade-compatibility-r10', 0, 'Original compatibility table', 'U-current compatibility r10: worker 2.0 uses cobalt; router 3.0 uses silver.'),
      document('upgrade-scope-amendment-r11', 1, 'Release scope amendment', 'U-current scope r11 supersedes r10: cancel router, add exporter 1.2. Worker remains authorized subject to current compatibility. Ledger remains forbidden.'),
      document('upgrade-inventory-correction-r11', 1, 'Worker prechange inventory correction', 'U-current inventory r11: worker is actually 1.5 before this release, not 1.4. Other r10 inventory values are unchanged.'),
      document('upgrade-compatibility-correction-r11', 1, 'Worker compatibility correction', 'U-current compatibility r11: worker 2.0/cobalt is invalid. Approved replacement is worker 2.1/amber. This replaces the old worker target/image, not its scope authorization.'),
      document('upgrade-exporter-prerequisite-r11', 1, 'Exporter compatibility and prerequisite', 'U-current prerequisite r11: exporter 1.2 uses copper and must be upgraded before worker.'),
      document('upgrade-historical-cobalt-r10', 1, 'Late historical compatibility upload', 'Historical U-current r10 result: worker 2.0/cobalt passed then. This late upload preserves r10 evidence; it is not r11 approval and does not supersede the correction.'),
    ]),
  stock: defineCase('stock', false, 'allocation plan S-current',
    object({ preserve: array(string), cancel: array(string), allocate: array(object({ order: string, warehouse: string, quantity: { type: 'integer', minimum: 1 } })), defer: array(string), free: object({ W: number, E: number }), sources }),
    'Preserve valid existing reservations, which already fulfill their order quantities. FREE stock excludes reserved units; do not subtract preserved reservations again or allocate their orders again. preserve contains reservation IDs; cancel contains cancelled order IDs. No splitting or partial fulfillment. Allocate each feasible remaining order; defer active unreserved orders that cannot fit in a compatible warehouse. Resolve competition by ascending order ID, preferring W then E when both fit. preserve/cancel/allocate/defer are sorted by reservation/order ID. free is remaining FREE stock after new allocations.', [
      document('stock-orders-r1', 0, 'Original demands and compatibility', 'S-current demand r1: A needs 4, B needs 3, C needs 2. Initially all are compatible with W and E.'),
      document('stock-inventory-r1', 0, 'Original free stock', 'S-current stock r1: FREE W=8, E=4. No existing reservation was recorded in this snapshot.'),
      document('stock-reservation-amendment-r2', 1, 'Existing reservation discovered', 'S-current r2: valid existing reservation rA fulfills all 4 units of A at W. Preserve it; it is not a new allocation.'),
      document('stock-free-correction-r2', 1, 'Reservation-exclusive stock correction', 'S-current stock r2 replaces r1 FREE counts: W=1, E=4. These already exclude all reservations, including rA. Do not subtract rA again.'),
      document('stock-demand-amendment-r2', 1, 'Demand and compatibility amendment', 'S-current r2: cancel B, add D needing 3 units. C is W-only; D is E-only. A remains covered by rA. Whole-order/no-splitting rules remain.'),
      document('stock-historical-inventory-r1', 1, 'Late historical warehouse upload', 'Historical S-current r1: W had 8 FREE units. This late upload is the old snapshot, not a correction to r2.'),
    ]),
  meeting: defineCase('meeting', true, 'meeting plan M-current',
    object({ slot: string, attendees: array(string), retire: array(string), sources }),
    'Choose the earliest feasible slot in order Mon09, Tue09, Wed09. It must satisfy accessibility and every currently required attendee. attendees lists exactly those attendees sorted by ID. retire lists superseded tentative bookings sorted by ID. Tentative bookings cannot override requirements. Acceptance for another meeting is not availability for this one.', [
      document('meeting-request-r1', 0, 'Original request and tentative booking', 'M-current request r1: required P and R, candidates Mon09/Tue09/Wed09 in that order. Tentative M0 is at Mon09. Initially P/R could attend all three, and all facilities were believed accessible.'),
      document('meeting-roster-amendment-r2', 1, 'Required attendee amendment', 'M-current roster r2 replaces P with Q. R remains required. P is no longer required.'),
      document('meeting-facilities-correction-r2', 1, 'Accessibility correction', 'M-current facilities r2: Mon09 is inaccessible; Tue09 and Wed09 are accessible.'),
      document('meeting-availability-amendment-r2', 1, 'Current attendee calendars', 'M-current availability r2: Q cannot attend Mon09 or Tue09 and can attend Wed09. R can attend all three.'),
      document('meeting-historical-acceptance-r1', 1, 'Late historical invitation response', 'Historical M-other r1: Q accepted Tue09 for M-other. This late-uploaded response is not availability or acceptance for M-current.'),
    ]),
  consent: defineCase('consent', true, 'publication report C-current',
    object({ rows: array(object({ id: string, amount: number, owner: string })), total: number, sources }),
    'Include every in-scope row whose underlying person currently consents, sorted by row ID, with unchanged amounts. Identity aliases share that person\'s consent decision. Current revisions govern, not upload time. Every published owner, including additions, must be literal [redacted]. total sums published amounts. Do not publish identity-link details.', [
      document('consent-register-r1', 0, 'Original synthetic register', 'C-current register r1: a amount 5 owner-a, b amount 8 owner-b, c amount 12 owner-c; all initially consent. Owners are synthetic identifiers, not output labels.'),
      document('consent-identity-correction-r2', 1, 'Alias and withdrawal correction', 'C-current identity/consent r2: owner-a and owner-b are aliases of person-ab. That person has withdrawn consent for this publication; apply it to every linked row.'),
      document('consent-current-confirmation-r3', 1, 'Current consent confirmation', 'C-current consent r3: owner-c currently consents to publishing c. This supersedes older owner-c withdrawals.'),
      document('consent-row-amendment-r2', 1, 'Additional independently consenting row', 'C-current register amendment r2: add d amount 7 owner-d, a different person unrelated to person-ab who currently consents. The owner redaction rule applies.'),
      document('consent-historical-withdrawal-r1', 1, 'Late historical consent upload', 'Historical C-current consent r1: owner-c withdrew at that older revision. Uploaded after r3 for archival completeness; it does not supersede r3.'),
    ]),
  payments: defineCase('payments', true, 'reconciliation report P-current',
    object({ invoices: array(object({ id: string, credited: number, due: number })), totalCredited: number, totalDue: number, sources }),
    'Report exactly active invoices sorted by ID. credited sums distinct nonvoid settled events assigned to the invoice; event IDs are globally unique across exports. Reconcile both current export documents and cite both when they repeat an event. due=current invoice amount minus credited; totals sum reported fields. Remove deleted invoices, include unpaid additions. Do not initiate payment, refund or collection.', [
      document('payments-ledger-r1', 0, 'Original invoices and events', 'P-current ledger r1: active I1 amount 100, I2 amount 60, I3 amount 30. Settled events P1 amount 100 to I1 and P2 amount 60 to I2. No other r1 events.'),
      document('payments-ledger-correction-r2', 1, 'Invoice and event correction', 'P-current ledger r2: P2 is void, contributes no credit. I2 amount is corrected from 60 to 45. P1 and I1 unchanged.'),
      document('payments-export-primary-r2', 1, 'Current primary settlement export', 'P-current primary export r2: settled event P3, amount 45, invoice I2.'),
      document('payments-export-mirror-r2', 1, 'Current mirror settlement export', 'P-current mirror export r2: settled event P3, amount 45, invoice I2. The same global event ID as the primary export, not another payment.'),
      document('payments-scope-amendment-r2', 1, 'Active invoice amendment', 'P-current scope r2: remove I3 from the report. Add active I4 amount 20, unpaid with no payment events.'),
      document('payments-historical-settlement-r1', 1, 'Late historical settlement export', 'Historical P-current ledger r1: P2 amount 60 to I2 was then settled. This late archive does not reverse the r2 void.'),
    ]),
  sensors: defineCase('sensors', true, 'northern alert report N-current',
    object({ alerts: array(object({ id: string, celsius: number })), meanCelsius: { type: ['number', 'null'] }, sources }),
    'Include exactly current northern readings at or above the current Celsius threshold. Unit corrections are per identified reading; Celsius=(Fahrenheit-32)*5/9. Do not convert readings already Celsius. alerts sorted by sensor ID, each once. meanCelsius is the mean of included readings, or null for none.', [
      document('sensors-readings-r1', 0, 'Original northern readings', 'N-current readings r1: s1 north 32 C, s2 north 31 C, s3 north 29 C.'),
      document('sensors-policy-r1', 0, 'Original alert policy', 'N-current policy r1: include northern readings at or above 30 C.'),
      document('sensors-unit-correction-r2', 1, 'Unit correction for one reading', 'N-current unit r2: ONLY s1 was mislabeled; it is 32 F, not 32 C. Other readings retain their units.'),
      document('sensors-region-correction-r2', 1, 'Region correction', 'N-current region r2: s2 is south, not north; its reading remains 31 C. Other regions unchanged.'),
      document('sensors-policy-amendment-r2', 1, 'Current alert policy', 'N-current policy r2 replaces threshold 30 C with 28 C. Continue using at or above.'),
      document('sensors-addition-r2', 1, 'Additional northern reading', 'N-current readings r2: add s4 in the north, reading 32 C, already Celsius.'),
      document('sensors-historical-reading-r1', 1, 'Late historical unit label', 'Historical N-current readings r1 listed s1 as 32 C. This late upload preserves the obsolete label and does not supersede the r2 Fahrenheit correction.'),
    ]),
};

export function getCase(id) {
  if (!Object.hasOwn(CASES, id)) throw new RangeError(`Unknown case: ${String(id)}`);
  return structuredClone(CASES[id]);
}
