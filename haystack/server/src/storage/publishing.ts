import type { SearchableRepository, SearchRequest } from "./search.js";
import type { ItemRepository, ValidatedPut } from "./repository.js";

export interface ChangePublisher {
  changed(key: string, revision: number): void;
}

export class PublishingRepository implements SearchableRepository {
  constructor(private readonly inner: SearchableRepository, private readonly changes: ChangePublisher) {}

  async commit(put: ValidatedPut) {
    const result = await this.inner.commit(put);
    if (!result.replayed) this.changes.changed(put.qualifiedKey, result.revision);
    return result;
  }

  getCurrent(project: string, item: string) { return this.inner.getCurrent(project, item); }
  getRevision(project: string, item: string, revision: number) { return this.inner.getRevision(project, item, revision); }
  listRevisions(project: string, item: string) { return this.inner.listRevisions(project, item); }
  recordTerminal(record: Parameters<ItemRepository["recordTerminal"]>[0]) { return this.inner.recordTerminal(record); }
  search(request: SearchRequest) { return this.inner.search(request); }
  observedValues(field: "type" | "status" | "importance" | "tags") { return this.inner.observedValues(field); }
  suggestIds(fragment: string, limit: number) { return this.inner.suggestIds(fragment, limit); }
}
