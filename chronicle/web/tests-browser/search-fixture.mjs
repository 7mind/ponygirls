import { Goal50Fixture, api } from './goal50-fixture.mjs';
export { api };
export class SearchFixture extends Goal50Fixture {
  relatedHits = [];
  archiveSearchCount = 23; archiveSearchScope = api.ArchiveTextScope.BoundedCandidateSets; archiveSearchRelevance = true; archiveSearchFailure = null; archiveSearchTransform = result => result;
  holdSearch = false; pendingSearch = []; holdContext = false; pendingContext = []; contextFailure = null; contextTransform = result => result; searchTransform = result => result; locatorWrongPin = false; conversationFailure = null; findFailure = null; holdFind = false; pendingFind = [];
  messagesAt(revision) {
    return super.messagesAt(revision).map(message => message.id === 'm65' ? message.with({ role: 'user', text: `Exact 猫🦄 matched source r${revision}. <script>literal()</script> ` + 'continued source '.repeat(1400) }) : message.id === 'm66' ? message.with({ role: 'assistant', text: `Separate assistant source r${revision}.` }) : message);
  }
  get hit() {
    return new api.SearchHit(this.session, [new api.Chunk(this.chunks[0].id, this.session.id, 'POISON joined chunk text is not source', 'GENERATED summary not source', ['match-tag'], [new api.Span('m65', 0, Buffer.byteLength('Exact 猫🦄 matched')), new api.Span('m66', 0, 9)], 0.9)], 0.9);
  }
  context(operation) {
    const messages = this.messagesAt(operation.view.revision), position = messages.findIndex(message => message.id === operation.anchor.messageId), anchor = operation.anchor;
    if (position < 0) throw new Error('Invalid fixture context anchor');
    const lengths = messages.map(message => Buffer.byteLength(message.text));
    function boundary(index, raw, before) { const bytes = Buffer.from(messages[index].text); let at = raw; while (at < bytes.length && (bytes[at] & 192) === 128) at += before ? 1 : -1; return at; }
    let left = operation.beforeBytes, right = operation.afterBytes;
    const start = boundary(position, Math.max(0, anchor.start - left), true), end = boundary(position, Math.min(lengths[position], anchor.end + right), false);
    left -= anchor.start - start; right -= end - anchor.end;
    const ranges = [{ position, start, end }];
    if (start === 0) for (let p = position - 1; p >= Math.max(0, position - 4) && left > 0; p--) {
      const s = boundary(p, Math.max(0, lengths[p] - left), true); if (s === lengths[p] && lengths[p] !== 0) break;
      ranges.unshift({ position: p, start: s, end: lengths[p] }); left -= lengths[p] - s; if (s > 0) break;
    }
    if (end === lengths[position]) for (let p = position + 1; p <= Math.min(messages.length - 1, position + 4) && right > 0; p++) {
      const e = boundary(p, Math.min(lengths[p], right), false); if (e === 0 && lengths[p] !== 0) break;
      ranges.push({ position: p, start: 0, end: e }); right -= e; if (e < lengths[p]) break;
    }
    const excerpts = ranges.map(range => new api.ContextExcerpt(new api.PassageSourceSpan(messages[range.position].id, range.position, range.start, range.end), messages[range.position].role, Buffer.from(messages[range.position].text).subarray(range.start, range.end).toString()));
    const first = excerpts[0].source, last = excerpts.at(-1).source;
    return new api.MessageContextResult(operation.sessionId, operation.view, new api.PassageSourceSpan(anchor.messageId, position, anchor.start, anchor.end), excerpts, first.start > 0 || first.messagePosition > 0 ? new api.Span(first.messageId, first.start, first.start) : undefined, last.end < lengths[last.messagePosition] || last.messagePosition < messages.length - 1 ? new api.Span(last.messageId, last.end, last.end) : undefined);
  }
  handle(operation, envelope, send, entry) {
    if (operation instanceof api.Operation_SearchSessionMessages) {
      const failure = this.findFailure;
      const reply = () => send(failure === null ? new api.Result_SessionMessageSearch(new api.SessionMessageSearchResult(operation.view, [], undefined)) : new api.Result_Error(new api.Failure(failure, 'Nested Find source unavailable')));
      if (this.holdFind) this.pendingFind.push(reply); else reply(); return true;
    }
    if (this.conversationFailure !== null && operation instanceof api.Operation_GetSession) { send(new api.Result_Error(new api.Failure(this.conversationFailure, 'Pinned conversation source access removed'))); return true; }
    if (operation instanceof api.Operation_Related) { send(new api.Result_Related(new api.RelatedResult(this.relatedHits))); return true; }
    if (operation instanceof api.Operation_ArchiveSearch) {
      if (this.archiveSearchFailure !== null) { send(new api.Result_Error(new api.Failure(this.archiveSearchFailure, 'Synthetic expression search unavailable'))); return true; }
      const offset = operation.query.cursor === undefined ? 0 : Number(operation.query.cursor);
      if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid synthetic Archive search cursor');
      const source = this.hit, rows = Array.from({ length: this.archiveSearchCount }, (_, index) => {
        const id = index === 0 ? this.session.id : `00000000-0000-4000-8000-${String(8000 + index).padStart(12, '0')}`;
        const head = source.session.with({ id, view: new api.ContentView(source.session.revision, undefined), metadata: this.metadata.with({ title: `Search conversation ${index + 1}` }) });
        return new api.ArchiveRow(head, source.session.view, source.session.view, undefined, this.messageCount, head.metadata.tags, undefined, undefined);
      }).slice(offset, offset + operation.query.limit);
      const chunk = source.chunks[0], evidence = rows.map(row => new api.ArchiveSearchEvidence(row.head.id, chunk.spans.slice(0, 2).map(span => new api.ArchiveSourceMatch(row.publishedView, span, api.ArchiveMatchKind.Semantic, 'source', chunk.summary))));
      const next = offset + rows.length < this.archiveSearchCount ? String(offset + rows.length) : undefined;
      const page = new api.ArchiveResult(rows, BigInt(this.archiveSearchCount), next, this.archiveSearchScope, this.archiveSearchScope === api.ArchiveTextScope.BoundedCandidateSets ? 1000 : undefined, this.archiveSearchRelevance);
      const result = this.archiveSearchTransform(new api.ArchiveSearchResult(page, evidence));
      const reply = () => send(new api.Result_ArchiveSearch(result)); if (this.holdSearch) this.pendingSearch.push(reply); else reply(); return true;
    }
    if (operation instanceof api.Operation_Search) {
      const bounded = operation.query.mode !== api.SearchMode.Lexical, total = bounded ? 12 : 23;
      const hits = Array.from({ length: total }, (_, index) => this.hit.with({ session: this.hit.session.with({ id: index === 0 ? this.session.id : `00000000-0000-4000-8000-${String(8000 + index).padStart(12, '0')}`, metadata: this.metadata.with({ title: `Search conversation ${index + 1}` }) }) }));
      const boundHits = hits.map(hit => hit.with({ chunks: hit.chunks.map(chunk => chunk.with({ sessionId: hit.session.id })) }));
      const result = this.searchTransform(new api.SearchResult(boundHits.slice(operation.query.offset, operation.query.offset + operation.query.limit), total, bounded ? api.SearchCountScope.CandidateWindow : api.SearchCountScope.ExactMatches, bounded ? 12 : undefined));
      const reply = () => send(new api.Result_Search(result)); if (this.holdSearch) this.pendingSearch.push(reply); else reply(); return true;
    }
    if (operation instanceof api.Operation_ReadMessageContext) {
      const result = this.contextTransform(this.context(operation)), failure = this.contextFailure;
      const reply = () => send(failure === null ? new api.Result_MessageContext(result) : new api.Result_Error(new api.Failure(failure, 'Synthetic source unavailable')));
      if (this.holdContext) this.pendingContext.push(reply); else reply(); return true;
    }
    if (this.locatorWrongPin && operation instanceof api.Operation_LocateMessage) { send(new api.Result_LocatedMessage(new api.MessageLocation(this.viewAt(2), 64, this.messageCount))); return true; }
    return super.handle(operation, envelope, send, entry);
  }
}
