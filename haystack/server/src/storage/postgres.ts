// Haystack storage: PostgreSQL adapter. Same ItemRepository contract as the
// dummy — the abstract suite runs against both legs. One SQL transaction per
// commit: replay-check → row lock → replay-recheck → CAS → revision +
// current + links + replay record. Unique-violation fallbacks resolve
// simultaneous same-identity races without losing history or projections.
import { Pool, type PoolClient } from "pg";
import { decodeKey, encodeKey } from "../domain/qid.js";
import { parseRaw } from "../domain/json.js";
import {
  InvalidDocument,
  type HumanAttention,
  type ItemDocument,
  type ItemMetadata,
  type Principal,
  type RevisionMeta,
  type StoredItem,
} from "../domain/document.js";
import {
  ConflictFault,
  NotFoundFault,
  ReplayConflictFault,
  type CommitSuccess,
  type ItemRepository,
  type TerminalKind,
  type ValidatedPut,
} from "./repository.js";
import { corpusSegmentStrings, corpusWords } from "../query/text.js";
import { compileWhere } from "./postgresSearch.js";
import type { SearchableRepository, SearchPage, SearchRequest, SearchSummary } from "./search.js";

interface CommittedOutcome {
  kind: "committed";
  revision: number;
  metadata: ItemMetadata;
}

interface TerminalOutcome {
  kind: TerminalKind;
  detail: string;
  currentRevision: number | null;
}

type StoredOutcome = CommittedOutcome | TerminalOutcome;

function outcomeToFault(outcome: StoredOutcome): Error {
  if (outcome.kind === "committed") throw new Error("unreachable: committed is not a fault");
  if (outcome.kind === "conflict") return new ConflictFault(outcome.currentRevision);
  if (outcome.kind === "not-found") return new NotFoundFault();
  const err = new InvalidDocument(outcome.detail);
  return err;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class PgItemRepository implements SearchableRepository {
  private readonly pool: Pool;
  private closed = false;

  constructor(connectionString: string, poolMax = 8) {
    this.pool = new Pool({ connectionString, max: poolMax });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  async getCurrent(project: string, item: string): Promise<StoredItem | null> {
    const res = await this.pool.query(
      `SELECT revision, document_text, created_at, created_by, modified_at, modified_by
       FROM items WHERE project_id = $1 AND item_id = $2`,
      [project, item],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    return {
      project,
      item,
      revision: row.revision as number,
      document: validatedDocument(row.document_text as string),
      documentCanonical: row.document_text as string,
      metadata: {
        createdAt: iso(row.created_at),
        createdBy: row.created_by as string,
        modifiedAt: iso(row.modified_at),
        modifiedBy: row.modified_by as string,
      },
    };
  }

  async getRevision(project: string, item: string, revision: number): Promise<StoredItem | null> {
    const current = await this.getCurrent(project, item);
    if (current && current.revision === revision) return current;
    const res = await this.pool.query(
      `SELECT document_text, modified_at, modified_by
       FROM item_revisions WHERE project_id = $1 AND item_id = $2 AND revision = $3`,
      [project, item, revision],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    const created = await this.creationOf(project, item);
    return {
      project,
      item,
      revision,
      document: validatedDocument(row.document_text as string),
      documentCanonical: row.document_text as string,
      metadata: {
        createdAt: created?.createdAt ?? (iso(row.modified_at) as string),
        createdBy: created?.createdBy ?? "",
        modifiedAt: iso(row.modified_at),
        modifiedBy: row.modified_by as string,
      },
    };
  }

  private async creationOf(project: string, item: string): Promise<{ createdAt: string; createdBy: string } | null> {
    const res = await this.pool.query(
      `SELECT created_at, created_by FROM items WHERE project_id = $1 AND item_id = $2`,
      [project, item],
    );
    if (res.rows.length === 0) return null;
    return { createdAt: iso(res.rows[0]!.created_at), createdBy: res.rows[0]!.created_by as string };
  }

  async listRevisions(project: string, item: string): Promise<RevisionMeta[]> {
    const res = await this.pool.query(
      `SELECT revision, modified_at, modified_by, token_id
       FROM item_revisions WHERE project_id = $1 AND item_id = $2 ORDER BY revision DESC`,
      [project, item],
    );
    return res.rows.map((row) => ({
      revision: row.revision as number,
      modifiedAt: iso(row.modified_at),
      modifiedBy: row.modified_by as string,
      tokenId: row.token_id as string,
    }));
  }

  async commit(put: ValidatedPut): Promise<CommitSuccess> {
    const client = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query("BEGIN");
      // Pre-lock replay check (fast path for plain retries).
      const early = await this.lookupReplay(client, put.principal, put.requestId);
      if (early && early.digest === put.digest) {
        await client.query("ROLLBACK");
        return replayResult(early.outcome, true);
      }
      if (early) {
        await client.query("ROLLBACK");
        throw new ReplayConflictFault();
      }

      let current: { revision: number; createdAt: string; createdBy: string } | null = null;
      if (put.expectedRevision === 0) {
        // Create path: ON CONFLICT DO NOTHING elects one winner without
        // aborting losers' transactions (a bare failing INSERT would poison
        // the txn with 25P02). DO NOTHING waits out the conflicting inserter,
        // so a lost insert implies a committed winner row.
        const won = await this.insertCurrent(client, put, 1, put.now, put.now, put.principal.userId);
        if (!won) {
          const winner = await this.selectCurrentForUpdate(client, put.key.project, put.key.item);
          const recheck = await this.lookupReplay(client, put.principal, put.requestId);
          if (recheck) {
            if (recheck.digest !== put.digest) {
              await client.query("ROLLBACK");
              throw new ReplayConflictFault();
            }
            await client.query("ROLLBACK");
            return replayResult(recheck.outcome, true);
          }
          return await this.finishTerminal(client, put, {
            kind: "conflict",
            detail: "item already exists",
            currentRevision: winner?.revision ?? null,
          });
        }
        await this.insertRevision(client, put, 1);
        await this.writeLinks(client, put);
        await this.writeProjection(client, put);
        const metadata: ItemMetadata = {
          createdAt: put.now,
          createdBy: put.principal.userId,
          modifiedAt: put.now,
          modifiedBy: put.principal.userId,
        };
        return await this.finishCommit(client, put, { kind: "committed", revision: 1, metadata });
      }

      const row = await this.selectCurrentForUpdate(client, put.key.project, put.key.item);
      if (!row) {
        return await this.finishTerminal(client, put, {
          kind: "not-found",
          detail: "item does not exist",
          currentRevision: null,
        });
      }
      current = row;
      // Recheck replay after acquiring ownership (a same-identity concurrent
      // may have committed while we waited on the row lock).
      const recheck = await this.lookupReplay(client, put.principal, put.requestId);
      if (recheck) {
        if (recheck.digest !== put.digest) {
          await client.query("ROLLBACK");
          throw new ReplayConflictFault();
        }
        await client.query("ROLLBACK");
        return replayResult(recheck.outcome, true);
      }
      if (current.revision !== put.expectedRevision) {
        return await this.finishTerminal(client, put, {
          kind: "conflict",
          detail: `expected ${put.expectedRevision}, current is ${current.revision}`,
          currentRevision: current.revision,
        });
      }
      const revision = current.revision + 1;
      await client.query(
        `UPDATE items SET revision = $3, document = $4::jsonb, document_text = $5,
         modified_at = $6, modified_by = $7
         WHERE project_id = $1 AND item_id = $2`,
        [put.key.project, put.key.item, revision, put.documentCanonical, put.documentCanonical, put.now, put.principal.userId],
      );
      await this.insertRevision(client, put, revision);
      await this.writeLinks(client, put);
      await this.writeProjection(client, put);
      const metadata: ItemMetadata = {
        createdAt: current.createdAt,
        createdBy: current.createdBy,
        modifiedAt: put.now,
        modifiedBy: put.principal.userId,
      };
      return await this.finishCommit(client, put, { kind: "committed", revision, metadata });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
      }
      throw err;
    } finally {
      client.release(releaseError);
    }
  }

  async recordTerminal(record: {
    principal: Principal;
    requestId: string;
    digest: string;
    kind: TerminalKind;
    detail: string;
    currentRevision?: number | null;
    now: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const seen = await this.lookupReplay(client, record.principal, record.requestId);
      if (seen) {
        if (seen.digest !== record.digest) {
          await client.query("ROLLBACK");
          throw new ReplayConflictFault();
        }
        await client.query("ROLLBACK");
        return;
      }
      const outcome: StoredOutcome =
        record.kind === "invalid-document"
          ? { kind: "invalid-document", detail: record.detail, currentRevision: null }
          : { kind: record.kind, detail: record.detail, currentRevision: record.currentRevision ?? null };
      await this.ensureReplay(client, record.principal, record.requestId, record.digest, outcome);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async lookupReplay(
    client: PoolClient,
    principal: Principal,
    requestId: string,
  ): Promise<{ digest: string; outcome: StoredOutcome } | null> {
    const res = await client.query(
      `SELECT digest, outcome::text AS outcome FROM write_requests
       WHERE principal_user = $1 AND token_id = $2 AND request_id = $3`,
      [principal.userId, principal.tokenId, requestId],
    );
    if (res.rows.length === 0) return null;
    return {
      digest: res.rows[0]!.digest as string,
      outcome: JSON.parse(res.rows[0]!.outcome as string) as StoredOutcome,
    };
  }

  /** Ensure our replay row exists; adopt the winner's outcome on conflict.
   *  Never throws 23505: concurrent same-identity inserts resolve by re-read.
   *  Returns the authoritative outcome plus whether it was already present. */
  private async ensureReplay(
    client: PoolClient,
    principal: Principal,
    requestId: string,
    digest: string,
    outcome: StoredOutcome,
  ): Promise<{ outcome: StoredOutcome; replayed: boolean }> {
    const res = await client.query(
      `INSERT INTO write_requests (principal_user, token_id, request_id, digest, outcome)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [principal.userId, principal.tokenId, requestId, digest, JSON.stringify(outcome)],
    );
    if ((res.rowCount ?? 0) === 1) return { outcome, replayed: false };
    const seen = await this.lookupReplay(client, principal, requestId);
    if (!seen) throw new Error("replay record lost after conflict");
    if (seen.digest !== digest) throw new ReplayConflictFault();
    return { outcome: seen.outcome, replayed: true };
  }

  private async selectCurrentForUpdate(
    client: PoolClient,
    project: string,
    item: string,
  ): Promise<{ revision: number; createdAt: string; createdBy: string } | null> {
    const res = await client.query(
      `SELECT revision, created_at, created_by FROM items
       WHERE project_id = $1 AND item_id = $2 FOR UPDATE`,
      [project, item],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0]!;
    return { revision: row.revision as number, createdAt: iso(row.created_at), createdBy: row.created_by as string };
  }

  /** Returns true when this transaction won the insert. Never throws 23505. */
  private async insertCurrent(
    client: PoolClient,
    put: ValidatedPut,
    revision: number,
    createdAt: string,
    modifiedAt: string,
    modifiedBy: string,
  ): Promise<boolean> {
    const res = await client.query(
      `INSERT INTO items (project_id, item_id, revision, document, document_text,
        created_at, created_by, modified_at, modified_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING RETURNING 1`,
      [
        put.key.project,
        put.key.item,
        revision,
        put.documentCanonical,
        put.documentCanonical,
        createdAt,
        put.principal.userId,
        modifiedAt,
        modifiedBy,
      ],
    );
    return (res.rowCount ?? 0) === 1;
  }

  private async insertRevision(client: PoolClient, put: ValidatedPut, revision: number): Promise<void> {
    await client.query(
      `INSERT INTO item_revisions (project_id, item_id, revision, document, document_text,
        modified_at, modified_by, token_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        put.key.project,
        put.key.item,
        revision,
        put.documentCanonical,
        put.documentCanonical,
        put.now,
        put.principal.userId,
        put.principal.tokenId,
      ],
    );
  }

  private async writeLinks(client: PoolClient, put: ValidatedPut): Promise<void> {
    await client.query(`DELETE FROM item_links WHERE source_project_id = $1 AND source_item_id = $2`, [
      put.key.project,
      put.key.item,
    ]);
    let position = 0;
    for (const [linkType, target] of put.document.links) {
      let decoded;
      try {
        decoded = decodeKey(target);
      } catch {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new InvalidDocument(`link target is not a qualified id: ${target}`);
      }
      await client.query(
        `INSERT INTO item_links (source_project_id, source_item_id, position,
          link_type, target_project_id, target_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [put.key.project, put.key.item, position, linkType, decoded.project, decoded.item],
      );
      position += 1;
    }
  }

  /** Text-search projection from the same normalized implementation the
   *  dummy uses (query/text.ts) — both legs agree by construction. */
  private async writeProjection(client: PoolClient, put: ValidatedPut): Promise<void> {
    const doc = put.document;
    const tags = [...(doc.tags ?? [])];
    const words = corpusWords(doc.title, doc.description, doc.fields, tags);
    const segments = corpusSegmentStrings(doc.title, doc.description, doc.fields, tags);
    await client.query(
      `INSERT INTO item_search (project_id, item_id, words, segments)
       VALUES ($1, $2, $3::text[], $4::text[])
       ON CONFLICT (project_id, item_id) DO UPDATE
       SET words = EXCLUDED.words, segments = EXCLUDED.segments`,
      [put.key.project, put.key.item, words, segments],
    );
  }

  async search(request: SearchRequest): Promise<SearchPage> {
    const where = compileWhere(request.ast);
    const params: unknown[] = [...where.params];
    const conditions = [where.sql];
    if (request.scope !== undefined) {
      params.push(request.scope);
      conditions.push(`(i.project_id = $${params.length})`);
    }
    if (request.after !== undefined) {
      params.push(request.after.project, request.after.item);
      const n = params.length;
      conditions.push(`((i.project_id, i.item_id) > ($${n - 1}, $${n}))`);
    }
    params.push(request.limit);
    const lim = params.length;
    const res = await this.pool.query(
      `SELECT i.project_id, i.item_id, i.revision,
        i.document ->> 'title' AS title, i.document ->> 'type' AS type,
        i.document ->> 'status' AS status, i.document ->> 'importance' AS importance,
        i.document ->> 'human-attention' AS human_attention,
        COALESCE(i.document -> 'tags', '[]'::jsonb) AS tags,
        i.modified_at, i.modified_by
       FROM items i LEFT JOIN item_search s
         ON s.project_id = i.project_id AND s.item_id = i.item_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY i.project_id, i.item_id
       LIMIT $${lim}`,
      params,
    );
    const items: SearchSummary[] = res.rows.map((row) => ({
      project: row.project_id as string,
      item: row.item_id as string,
      revision: row.revision as number,
      title: row.title as string,
      type: row.type as string,
      status: row.status as string,
      importance: row.importance as string,
      humanAttention: row.human_attention as HumanAttention,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      modifiedAt: iso(row.modified_at),
      modifiedBy: row.modified_by as string,
    }));
    // `next` only when the limit stopped the scan (a full page may hide more
    // rows); otherwise the page is complete. Matches the dummy leg.
    if (items.length < request.limit) return { items };
    const last = items[items.length - 1]!;
    return { items, next: { project: last.project, item: last.item } };
  }

  async observedValues(field: "type" | "status" | "importance" | "tags"): Promise<string[]> {
    if (field === "tags") {
      const res = await this.pool.query(
        `SELECT DISTINCT t AS value FROM items i,
         LATERAL jsonb_array_elements_text(COALESCE(i.document -> 'tags', '[]'::jsonb)) AS t
         ORDER BY value LIMIT 100`,
      );
      return res.rows.map((row) => row.value as string);
    }
    if (field !== "type" && field !== "status" && field !== "importance") {
      throw new Error(`not an observable field: ${field}`);
    }
    const res = await this.pool.query(
      `SELECT DISTINCT i.document ->> $1 AS value FROM items i ORDER BY value LIMIT 100`,
      [field],
    );
    return res.rows.map((row) => row.value as string);
  }

  async suggestIds(fragment: string, limit: number): Promise<string[]> {
    // LIKE metacharacters in the fragment are data, never wildcards.
    const escaped = fragment.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${escaped}%`;
    // Substring match on the qualified id (same semantics as the dummy leg:
    // fragments may span the project:item boundary).
    const res = await this.pool.query(
      `SELECT i.project_id, i.item_id FROM items i
       WHERE (i.project_id || ':' || i.item_id) LIKE $1 ESCAPE '\\'
       ORDER BY i.project_id, i.item_id LIMIT $2`,
      [pattern, limit],
    );
    // Canonical encoded output (see dummy leg): raw interpolation would
    // mint malformed ids for components containing ':' or '%'.
    return res.rows.map((row) =>
      encodeKey({ project: row.project_id as string, item: row.item_id as string }),
    );
  }

  private async finishCommit(client: PoolClient, put: ValidatedPut, outcome: CommittedOutcome): Promise<CommitSuccess> {
    const ensured = await this.ensureReplay(client, put.principal, put.requestId, put.digest, outcome);
    await client.query("COMMIT");
    if (ensured.outcome.kind !== "committed") throw outcomeToFault(ensured.outcome);
    return {
      revision: ensured.outcome.revision,
      metadata: ensured.outcome.metadata,
      replayed: ensured.replayed,
    };
  }

  private async finishTerminal(client: PoolClient, put: ValidatedPut, outcome: TerminalOutcome): Promise<CommitSuccess> {
    const ensured = await this.ensureReplay(client, put.principal, put.requestId, put.digest, outcome);
    await client.query("COMMIT");
    // A simultaneous same-identity commit may have won with an identical
    // digest: adopt its success rather than our terminal outcome.
    if (ensured.outcome.kind === "committed") {
      return { revision: ensured.outcome.revision, metadata: ensured.outcome.metadata, replayed: true };
    }
    throw outcomeToFault(ensured.outcome);
  }
}

function replayResult(outcome: StoredOutcome, replayed: boolean): CommitSuccess {
  if (outcome.kind !== "committed") throw outcomeToFault(outcome);
  return { revision: outcome.revision, metadata: outcome.metadata, replayed };
}

// Stored documents were validated at write; re-parse losslessly so numbers
// never pass through JSON.parse (node-pg parses jsonb with JSON.parse,
// which is why reads use the document_text column). Pre-tags rows omit
// `tags` (and possibly `links`): normalize to [] so readers see one shape.
function validatedDocument(text: string): ItemDocument {
  const doc = parseRaw(text) as unknown as ItemDocument & { tags?: unknown; links?: unknown };
  return {
    ...doc,
    links: Array.isArray(doc.links) ? (doc.links as ItemDocument["links"]) : [],
    tags: Array.isArray(doc.tags) ? (doc.tags as string[]) : [],
  };
}
