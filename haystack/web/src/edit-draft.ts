// The record editor's draft (spec §3.2 Edit): initial state from a revision, what changed since (named in the leave
// dialog), what blocks saving (named next to the field and in the summary) and the document that is sent.
import { buildDocumentJson, parseTagsInput, type Item } from "./api.ts";
import { changedFields, editingOf, serializeRows, type FieldsEditing } from "./fields-edit.ts";
import { parseRaw } from "./lossless-json.ts";
import type { WriteOperation } from "./pending-write.ts";

export interface LinkRow { id: number; relation: string; target: string }
/**
 * The fields being edited. `text` is the exact JSON that is sent: the revision's own text until a typed edit
 * replaces it by the rows' serialization, or the raw editor's text. `editing` is the typed model of `text`
 * (null while `text` is not valid JSON) and carries rows whose values may not be valid yet.
 */
export interface FieldsDraft { view: "typed" | "raw"; text: string; editing: FieldsEditing | null }
export interface Draft {
  title: string;
  description: string;
  type: string;
  status: string;
  importance: string;
  needsReview: boolean;
  tags: string[];
  /** Text typed into the tag box and not yet turned into a tag; saved as tags too. */
  tagInput: string;
  links: LinkRow[];
  fields: FieldsDraft;
}
/** Something that blocks saving: `anchor` is the id of the control that holds it, `where` names it in the summary. */
export interface Problem { anchor: string; where: string; message: string }

export const RAW_FIELDS_ANCHOR = "edit-fields-json";
export const fieldAnchor = (rowId: number): string => `edit-field-${rowId}`;
export const fieldNameAnchor = (rowId: number): string => `edit-field-${rowId}-name`;
export const linkAnchor = (linkId: number): string => `edit-link-${linkId}`;
export const LINK_TARGET_MISSING = "Enter the key of the target record, for example ponygirls:fact-0033.";
const LINK_RELATION_MISSING = "Choose how this record relates to the target.";
const ATTENTION = { required: "required", cleared: "cleared" } as const;

export function draftOf(item: Item, nextId: () => number): Draft {
  const document = item.document;
  const editing = editingOf(document.fieldsJson, nextId);
  return {
    title: document.title, description: document.description, type: document.type, status: document.status, importance: document.importance,
    needsReview: document.humanAttention === ATTENTION.required, tags: [...document.tags], tagInput: "",
    links: document.links.map(([relation, target]) => ({ id: nextId(), relation, target })),
    fields: { view: editing === null || editing.shape === "raw-only" ? "raw" : "typed", text: document.fieldsJson, editing },
  };
}

/** `tags` and the tags written in `text` (comma separated), without repeats. */
export function addTag(tags: readonly string[], text: string): string[] {
  const result = [...tags];
  for (const tag of parseTagsInput(text)) if (!result.includes(tag)) result.push(tag);
  return result;
}

const tagsOf = (draft: Draft): string[] => addTag(draft.tags, draft.tagInput);
const isBlank = (link: LinkRow): boolean => link.relation.trim() === "" && link.target.trim() === "";
const linksOf = (draft: Draft): Array<[string, string]> => draft.links.filter((link) => !isBlank(link)).map((link) => [link.relation.trim(), link.target.trim()]);

function fieldsText(fields: FieldsDraft): string | null {
  if (fields.view === "raw" || fields.editing === null || fields.editing.shape !== "rows") return fields.text;
  const serialized = serializeRows(fields.editing.rows);
  return serialized.ok ? serialized.raw : null;
}

/** Names of the parts of `draft` that differ from `base`, in page order. */
export function changedParts(base: Draft, draft: Draft): string[] {
  const parts: string[] = [];
  const check = (name: string, changed: boolean) => { if (changed) parts.push(name); };
  check("title", base.title !== draft.title);
  check("description", base.description !== draft.description);
  check("type", base.type !== draft.type);
  check("status", base.status !== draft.status);
  check("importance", base.importance !== draft.importance);
  check("needs review", base.needsReview !== draft.needsReview);
  check("tags", JSON.stringify(tagsOf(base)) !== JSON.stringify(tagsOf(draft)));
  check("links", JSON.stringify(linksOf(base)) !== JSON.stringify(linksOf(draft)));
  const text = fieldsText(draft.fields);
  const fields = text === null ? ["fields"] : changedFields(base.fields.text, text);
  return [...parts, ...fields.map((name) => name === "fields" ? "fields" : `field ${name}`)];
}

/** What blocks saving `draft`, in page order. */
export function problemsOf(draft: Draft): Problem[] {
  const problems: Problem[] = [];
  const fields = draft.fields;
  if (fields.view === "raw") {
    try { parseRaw(fields.text); } catch (error) { problems.push({ anchor: RAW_FIELDS_ANCHOR, where: "Fields JSON", message: `Invalid JSON: ${(error as Error).message.replace(/^unparseable JSON: /, "")}` }); }
  } else if (fields.editing !== null && fields.editing.shape === "rows") {
    const rows = fields.editing.rows;
    const serialized = serializeRows(rows);
    if (!serialized.ok) for (const problem of serialized.problems) {
      const row = rows.find((candidate) => candidate.id === problem.rowId)!;
      problems.push({ anchor: problem.target === "name" ? fieldNameAnchor(row.id) : fieldAnchor(row.id), where: `Field ${row.name === "" ? '""' : row.name}`, message: problem.message });
    }
  }
  draft.links.forEach((link, index) => {
    if (isBlank(link)) return;
    const where = `Links, row ${index + 1}`;
    if (link.target.trim() === "") problems.push({ anchor: linkAnchor(link.id), where, message: LINK_TARGET_MISSING });
    else if (link.relation.trim() === "") problems.push({ anchor: linkAnchor(link.id), where, message: LINK_RELATION_MISSING });
  });
  return problems;
}

/** The document to send. Throws while `draft` has problems: callers check `problemsOf` first. */
export function documentJsonOf(draft: Draft): string {
  if (problemsOf(draft).length > 0) throw new Error("The draft has problems that block saving");
  return buildDocumentJson({
    title: draft.title, description: draft.description, fieldsRaw: draft.fields.text, type: draft.type, status: draft.status,
    importance: draft.importance, attention: draft.needsReview ? ATTENTION.required : ATTENTION.cleared, links: linksOf(draft), tags: tagsOf(draft),
  });
}

/**
 * Whether a live announcement means the record changed under the draft: any change after a resynchronization, or a newer
 * revision of this record - except the one an unconfirmed write of this draft would create, which is that write arriving.
 */
export function isRemoteChange(change: { key: string | null; revision: number | null }, record: { key: string; revision: number },
  pending: Pick<WriteOperation, "key" | "expectedRevision"> | undefined): boolean {
  if (change.key === null) return true;
  if (change.key !== record.key || change.revision === null || change.revision <= record.revision) return false;
  return pending === undefined || pending.key !== record.key || change.revision !== pending.expectedRevision + 1;
}
