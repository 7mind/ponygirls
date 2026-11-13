/*
 * Static trusted test adapters. No repository discovery, imports, filesystem,
 * network, shell, or model-provided executable code.
 */

function pass() {
  return { outcome: 'pass', findings: [] };
}

function finding(outcome, code, message, evidenceIds) {
  return { outcome, findings: [{ code, message, evidenceIds }] };
}

/**
 * Intentionally narrow domain contract: only numeric count >= the explicit
 * minimum in the single user-evidence JSON snapshot. Name and all other
 * artifact properties are outside this checker's scope.
 */
export function domainCount(input) {
  if (
    input.evidence.length !== 1
    || input.evidence[0].role !== 'user'
  ) {
    return finding('inconclusive', 'COUNT_EVIDENCE', 'One user evidence snapshot is required.', []);
  }

  let rule;
  let artifact;
  try {
    rule = JSON.parse(input.evidence[0].text);
    artifact = JSON.parse(input.artifact.text);
  } catch {
    return finding('inconclusive', 'COUNT_JSON', 'This domain adapter requires JSON snapshots.', []);
  }

  if (
    typeof rule !== 'object'
    || rule === null
    || Array.isArray(rule)
    || Object.keys(rule).length !== 1
    || !Object.hasOwn(rule, 'minimum')
    || typeof rule.minimum !== 'number'
    || !Number.isFinite(rule.minimum)
  ) {
    return finding(
      'inconclusive',
      'COUNT_RULE',
      'Evidence must explicitly contain exactly one finite numeric minimum.',
      [input.evidence[0].id],
    );
  }

  if (
    typeof artifact !== 'object'
    || artifact === null
    || Array.isArray(artifact)
    || typeof artifact.count !== 'number'
    || !Number.isFinite(artifact.count)
    || artifact.count < rule.minimum
  ) {
    return finding(
      'fail',
      'COUNT_MINIMUM',
      'The selected count does not meet the explicitly selected minimum.',
      [input.evidence[0].id],
    );
  }
  return pass();
}

export function infinite() {
  for (;;) {
    // Deliberately synchronous: AbortSignal alone cannot stop this adapter.
  }
}

export function throwing() {
  throw new Error('An adapter exception must become a bounded error code.');
}

export function malformed() {
  return { outcome: 'pass', findings: [], unexpected: 'forged extra output' };
}

export function forgedOutcome() {
  return { outcome: 'cancelled', findings: [] };
}

export function badEvidenceReference() {
  return finding('pass', 'FORGED_REF', 'Not selected evidence.', ['not-selected']);
}

export function overflow() {
  return {
    outcome: 'pass',
    findings: Array.from({ length: 8 }, (_, index) => ({
      code: `LARGE_${index}`,
      message: 'x'.repeat(3000),
      evidenceIds: [],
    })),
  };
}

export async function delayedPass() {
  await new Promise(resolve => setTimeout(resolve, 250));
  return pass();
}

export function immutableAndEmptyEnvironment(input) {
  if (
    !Object.isFrozen(input)
    || !Object.isFrozen(input.artifact)
    || !Object.isFrozen(input.evidence)
    || input.evidence.some(item => !Object.isFrozen(item))
    || Object.keys(process.env).length !== 0
  ) {
    return finding('fail', 'BOUNDARY', 'Expected frozen input and an empty worker environment.', []);
  }
  return pass();
}

export function stdoutOverflow() {
  process.stdout.write('x'.repeat(65536));
  return new Promise(() => {});
}

export function exitWithoutResult() {
  process.exit(0);
}

export function inconclusive() {
  return finding('inconclusive', 'UNDECIDED', 'This adapter does not decide this case.', []);
}

export function blankCode() {
  return finding('fail', ' \t', 'A nonblank finding message.', []);
}

export function blankMessage() {
  return finding('fail', 'INVALID', ' \n', []);
}
