import { MAX_BATCH_EVENTS, MAX_PROPOSALS, exactObject, object, validateProposals, type Proposal } from './model.ts';

export const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['proposals'],
  properties: { proposals: { type: 'array', maxItems: MAX_PROPOSALS, items: {
    type: 'object', additionalProperties: false,
    required: ['episodeId', 'expectedRevision', 'title', 'kind', 'status', 'claims'],
    properties: {
      episodeId: { type: ['string', 'null'], maxLength: 100 },
      expectedRevision: { type: 'integer', minimum: 0 },
      title: { type: 'string', minLength: 1, maxLength: 300 },
      kind: { type: 'string', enum: ['experiment', 'investigation', 'deployment', 'blocker', 'discovery'] },
      status: { type: 'string', enum: ['ongoing', 'succeeded', 'failed', 'inconclusive', 'blocked', 'interrupted'] },
      claims: { type: 'array', minItems: 1, maxItems: 30, items: {
        type: 'object', additionalProperties: false, required: ['section', 'basis', 'text', 'evidence'],
        properties: {
          section: { type: 'string', enum: ['objective', 'procedure', 'observation', 'outcome', 'learning', 'decision'] },
          basis: { type: 'string', enum: ['observed', 'reported', 'hypothesis', 'decision'] },
          text: { type: 'string', minLength: 1, maxLength: 8000 },
          evidence: { type: 'array', minItems: 1, maxItems: MAX_BATCH_EVENTS, items: { type: 'string' } },
        },
      } },
    },
  } } },
};
export function constrainOutput(payload: unknown): unknown {
  const body = object(payload);
  const text = body.text === undefined ? {} : object(body.text);
  return { ...body, text: { ...text, format: { type: 'json_schema', name: 'historian_proposals_v2', strict: true, schema: OUTPUT_SCHEMA } } };
}
export function validateOutput(value: unknown, allowedEvidence: ReadonlySet<string>): Proposal[] {
  const envelope = exactObject(value, ['proposals']);
  return validateProposals(envelope.proposals, allowedEvidence);
}
