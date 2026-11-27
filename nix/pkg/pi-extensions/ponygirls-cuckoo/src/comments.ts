import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { Checkpoint } from './report.ts';

/** One operator comment on a report node; never part of model context by itself. */
export const COMMENT_TYPE = 'cuckoo.comment';
/** The model-facing message that delivers comments; its details list the delivered ids. */
export const COMMENTS_TYPE = 'cuckoo.comments';
/** Hidden follow-up to a delivery made when the user closes the panel while nothing is running: asks the model to respond. */
export const COMMENT_RESPONSE_TYPE = 'cuckoo.comments.respond';
export const COMMENT_RESPONSE = 'The user closed the Cuckoo panel after writing the comments above and expects a response now. Reply to the comments and act on them within the current task and its existing constraints. This is not a Cuckoo inquiry: answer normally, not with a JSON report.';
export const MAX_COMMENT_CHARS = 8000;
export const MAX_DELIVERED_COMMENTS = 1000;
const QUOTE_CHARS = 400;
const NODE_KINDS = ['rule', 'objective', 'answer'] as const;

export type NodeKind = typeof NODE_KINDS[number];
/** A commentable report node: index into the checkpoint's rules, objectives or answers. */
export interface NodeRef { readonly kind: NodeKind; readonly index: number }
export interface CommentNode { readonly ref: NodeRef; readonly subject: string }
/** `subject` quotes the commented node, so a comment stays readable without its checkpoint. */
export interface CommentDraft { readonly requestId: string; readonly target: NodeRef; readonly subject: string; readonly text: string }
export interface SavedComment extends CommentDraft { readonly commentId: string; readonly createdAt: string }
/** A comment as displayed: saved comments carry their timestamp; one not yet persisted has null. */
export interface ShownComment { readonly requestId: string; readonly target: NodeRef; readonly text: string; readonly createdAt: string | null }
export interface CommentDelivery {
  readonly customType: typeof COMMENTS_TYPE;
  readonly content: string;
  readonly display: true;
  readonly details: { readonly version: 1; readonly commentIds: readonly string[] };
}

const CONTROLS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** One plain line quoting report text: model output may decode to terminal controls, which a quotation must not carry. */
function quote(text: string): string {
  const line = text.replace(/\s+/g, ' ').replace(CONTROLS, '').trim();
  return line.length <= QUOTE_CHARS ? line : `${line.slice(0, QUOTE_CHARS)}…`;
}

/** Commentable nodes in display order. Invalid reports have none. */
export function commentNodes(value: Checkpoint): CommentNode[] {
  if (value.report === null) return [];
  const rules = value.report.rules === null ? [] : value.report.rules;
  const answers = value.report.answers === null ? [] : value.report.answers;
  return [
    ...rules.map((item, index): CommentNode => ({ ref: { kind: 'rule', index }, subject: `Rule ${item.id === null ? '' : `${item.id} `}(${item.source}): ${quote(item.rule)} (scope: ${quote(item.scope)})` })),
    ...value.report.objectives.map((item, index): CommentNode => ({ ref: { kind: 'objective', index }, subject: `Objective ${item.id === null ? index + 1 : item.id}: ${quote(item.objective)}` })),
    ...answers.map((item, index): CommentNode => ({ ref: { kind: 'answer', index }, subject: `Standing question ${item.id}: ${quote(item.question)} Answer: ${quote(item.answer)}` })),
  ];
}

export function sameNode(left: NodeRef, right: NodeRef): boolean {
  return left.kind === right.kind && left.index === right.index;
}

export function commentsOn<T extends ShownComment>(comments: readonly T[], requestId: string, target: NodeRef): T[] {
  return comments.filter(item => item.requestId === requestId && sameNode(item.target, target));
}

/** Normalize operator input: plain text with newlines, no terminal controls. */
export function commentText(value: string): string {
  const text = value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(CONTROLS, '').trim();
  if (text.length === 0) throw new Error('A comment cannot be empty');
  if (text.length > MAX_COMMENT_CHARS) throw new Error(`A comment is limited to ${MAX_COMMENT_CHARS} characters`);
  return text;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid saved Cuckoo comment');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  if (Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid saved Cuckoo comment fields');
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) throw new Error('Invalid saved Cuckoo comment text');
  return value;
}
function nodeRef(value: unknown): NodeRef {
  const data = object(value); exact(data, ['kind', 'index']);
  const kind = NODE_KINDS.find(item => item === data.kind);
  if (kind === undefined || typeof data.index !== 'number' || !Number.isSafeInteger(data.index) || data.index < 0) throw new Error('Invalid saved Cuckoo comment target');
  return { kind, index: data.index };
}

/** The persisted form of one comment; validates what the panel staged. */
export function commentRecord(draft: CommentDraft, commentId: string, createdAt: string): SavedComment & { readonly version: 1 } {
  return { version: 1, commentId: text(commentId, 128), requestId: text(draft.requestId, 256), target: nodeRef(draft.target),
    subject: text(draft.subject.replace(CONTROLS, ''), MAX_COMMENT_CHARS), text: commentText(draft.text), createdAt: text(createdAt, 64) };
}

export function savedComments(entries: readonly SessionEntry[]): SavedComment[] {
  return entries.flatMap(entry => {
    if (entry.type !== 'custom' || entry.customType !== COMMENT_TYPE) return [];
    const data = object(entry.data); exact(data, ['version', 'commentId', 'requestId', 'target', 'subject', 'text', 'createdAt']);
    if (data.version !== 1) throw new Error('Invalid saved Cuckoo comment version');
    return [{ commentId: text(data.commentId, 128), requestId: text(data.requestId, 256), target: nodeRef(data.target),
      subject: text(data.subject, MAX_COMMENT_CHARS), text: text(data.text, MAX_COMMENT_CHARS), createdAt: text(data.createdAt, 64) }];
  });
}

function deliveredIds(branch: readonly SessionEntry[]): Set<string> {
  const delivered = new Set<string>();
  for (const entry of branch) {
    if (entry.type !== 'custom_message' || entry.customType !== COMMENTS_TYPE) continue;
    const details = object(entry.details); exact(details, ['version', 'commentIds']);
    if (details.version !== 1 || !Array.isArray(details.commentIds) || details.commentIds.length > MAX_DELIVERED_COMMENTS) throw new Error('Invalid Cuckoo comment delivery');
    for (const id of details.commentIds) delivered.add(text(id, 128));
  }
  return delivered;
}

/** Comments saved on this branch that no delivery message on this branch has carried to the model. */
export function undeliveredComments(branch: readonly SessionEntry[]): SavedComment[] {
  const delivered = deliveredIds(branch);
  return savedComments(branch).filter(item => !delivered.has(item.commentId)).slice(0, MAX_DELIVERED_COMMENTS);
}

const DELIVERY_OPENING = 'The user reviewed saved Cuckoo checkpoint self-reports of this session and commented on the items quoted below. ' +
  'The comments are user feedback: take them into account in your ongoing work and in later checkpoints. ' +
  'This message is not a Cuckoo inquiry and does not ask for a report by itself. ' +
  'Each comment quotes the item it refers to; for the whole checkpoint, list rounds with cuckoo_recall and read the one with the request ID given below.';
const OTHER_BRANCH = ' (saved on another branch of this session; cuckoo_recall reads it only with scope "session")';

/** `branchRequestIds` names the checkpoints on the receiving branch; comments on others are labelled, since history shows every branch. */
export function commentDelivery(comments: readonly SavedComment[], branchRequestIds: ReadonlySet<string>): CommentDelivery {
  if (comments.length === 0 || comments.length > MAX_DELIVERED_COMMENTS) throw new Error('A Cuckoo comment delivery needs 1 to 1000 comments');
  const groups = new Map<string, SavedComment[]>();
  for (const item of comments) groups.set(item.requestId, [...(groups.get(item.requestId) ?? []), item]);
  const body = [...groups].map(([requestId, items]) => `Checkpoint ${requestId}${branchRequestIds.has(requestId) ? '' : OTHER_BRANCH}\n` + items.map((item, index) =>
    `${index + 1}. On ${item.subject}\n   User comment: ${item.text.replace(/\n/g, '\n   ')}`).join('\n')).join('\n\n');
  return { customType: COMMENTS_TYPE, content: `${DELIVERY_OPENING}\n\n${body}`, display: true,
    details: { version: 1, commentIds: comments.map(item => item.commentId) } };
}
