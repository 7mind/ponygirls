import { Goal50Fixture, api } from './goal50-fixture.mjs';
export { api };
export const FIND_LITERAL = ' 猫🦄 %_\\ AND literal ';
// Synthetic normalized messages assembled from fragments. This exercises UI
// locator navigation, not the backend SQL implementation or its fragment join.
export class HistoryFixture extends Goal50Fixture {
  locatorFailure = null; locatorPositionOverride = null; indexed = false; holdFind = false; pendingFind = []; findFailure = null; findTransform = result => result; sourceDenied = false;
  constructor() { super(); this.messageCount = 240; this.publishedRevision = 1; this.headRevision = 2; }
  get publishedFormat() { return this.indexed ? api.PassageFormat.ContextAwareProblems : undefined; }
  get authorizedRows() { if (this.indexed) return super.authorizedRows; return super.authorizedRows.map(row => row.with({ publishedView: undefined, publishedFormat: undefined })); }
  messagesAt(revision) {
    return Array.from({ length: this.messageCount }, (_, position) => {
      const fragments = position === 0 ? ['Can we preserve the original 猫🦄 source while the index catches up?'] : position === 1 ? ['Normalized literal \\u0000 token'] : position === 130 ? ['x'.repeat(21000) + ' 猫🦄 %_', '\\ AND literal tail'] : position >= 131 && position < 175 ? ['matching', FIND_LITERAL, 'tail'] : [`Normalized source r${revision} message ${position + 1}.`];
      return new api.Message(`m${position + 1}`, undefined, position % 2 === 0 ? 'user' : 'assistant', fragments.join(''), undefined, 5000 + position * 17);
    });
  }
  handle(operation, envelope, send, entry) {
    if (this.sourceDenied && (operation instanceof api.Operation_SearchSessionMessages || operation instanceof api.Operation_GetSession || operation instanceof api.Operation_GetMessages || operation instanceof api.Operation_LocateMessage)) { send(new api.Result_Error(new api.Failure('forbidden', 'Selected source access removed'))); return true; }
    if (operation instanceof api.Operation_LocateMessage && this.locatorFailure !== null) { send(new api.Result_Error(new api.Failure(this.locatorFailure, 'Synthetic locator timeout'))); return true; }
    if (operation instanceof api.Operation_LocateMessage && this.locatorPositionOverride !== null) { const result = new api.Result_LocatedMessage(new api.MessageLocation(operation.view, this.locatorPositionOverride, this.messageCount)), reply = () => send(result); if (this.holdLocators) this.pendingLocators.push(reply); else reply(); return true; }
    if (operation instanceof api.Operation_SearchSessionMessages) {
      const key = JSON.stringify([this.user.id, operation.sessionId, operation.view.toJSON(), operation.literal]);
      let offset = 0;
      if (operation.cursor !== undefined) { const cursor = JSON.parse(Buffer.from(operation.cursor, 'base64url').toString()); if (cursor[0] !== key) throw new Error('Synthetic find cursor scope mismatch'); offset = cursor[1]; }
      // Mirror the documented normalized NUL projection for this controlled UI
      // fixture; the client must still send the original scalar literal unchanged.
      const normalizedLiteral = operation.literal.replaceAll('\u0000', '\\u0000');
      const hits = this.messagesAt(operation.view.revision).flatMap((message, position) => message.text.toLowerCase().includes(normalizedLiteral.toLowerCase()) ? [new api.MessageSearchHit(message.id, position)] : []);
      const next = offset + operation.limit < hits.length ? Buffer.from(JSON.stringify([key, offset + operation.limit])).toString('base64url') : undefined;
      const result = this.findTransform(new api.SessionMessageSearchResult(operation.view, hits.slice(offset, offset + operation.limit), next));
      const reply = () => send(this.findFailure === null ? new api.Result_SessionMessageSearch(result) : new api.Result_Error(new api.Failure(this.findFailure, 'Synthetic find rejected')));
      if (this.holdFind) this.pendingFind.push(reply); else reply(); return true;
    }
    return super.handle(operation, envelope, send, entry);
  }
}
