import * as api from '../src/api.ts';
import { BaboonCodecContext } from '../../generated/typescript/BaboonSharedRuntime.ts';
const context = BaboonCodecContext.Default;
const ID = { session: '00000000-0000-4000-8000-000000000001', chunk: '00000000-0000-4000-8000-000000000002', token: '00000000-0000-4000-8000-000000000003', group: '00000000-0000-4000-8000-000000000004', invitation: '00000000-0000-4000-8000-000000000005', job: '00000000-0000-4000-8000-000000000006', otherGroup: '00000000-0000-4000-8000-000000000007' };
export class ChronicleFixture {
  user = new api.UserInfo('alice', 'alice', [api.Scope.Read, api.Scope.Raw]);
  version = new api.VersionInfo('1.2.0', '1.0.0', ['1.2.0', '1.0.0']);
  sockets = []; calls = []; requests = []; receipts = new Map(); tokens = [];
  groups = [new api.GroupInfo(ID.group, 'Systems workshop', 'alice', ['alice', 'bob']), new api.GroupInfo(ID.otherGroup, 'Research circle', 'bob', ['bob', 'alice'])];
  invitations = [new api.InviteInfo(ID.invitation, ID.otherGroup, 'alice', '2030-01-01T00:00:00Z')];
  jobs = [new api.JobInfo(ID.job, ID.session, 2, api.JobState.Failed, 3, 'Embedding provider unavailable; archived source is preserved.', 0, undefined)];
  annotationCount = 2; winnerBeyondFirstPage = false; resumedSource = false; headRevision = 2; publishedRevision = 1; messageViewOverride = undefined; chunksViewOverride = undefined; rawRevisionOverride = undefined;
  mode = 'normal'; signedIn = true; mintUncertain = false; dropLogout = false; rawDenied = true; searchCount = 0;
  metadata = new api.Metadata('Following the migration thread', 'chronicle', '/synthetic/project', 'https://example.invalid/synthetic.git', 'feature/archive', 'ab12cd34', 'pi', 'synthetic-model', '2026-10-23T09:30:00Z', undefined, ['architecture', 'source-fidelity']);
  source = new api.SourceIdentity('synthetic-collector', 'native', api.SourceFormat.Pi, 'synthetic-session', undefined);
  viewAt(revision) { return new api.ContentView(revision, `00000000-0000-4000-8000-${String(5000 + revision).padStart(12, '0')}`); }
  get view() { return this.viewAt(this.publishedRevision); }
  sessionAt(view) { return new api.SessionInfo(view, ID.session, 'alice', this.headRevision, this.publishedRevision, this.metadata, this.source, api.Completion.Quiescent, false); }
  get session() { return this.sessionAt(this.view); }
  messagesAt(revision) { const messages = [new api.Message('m1', undefined, 'user', 'Can we preserve the original 猫🦄 source while the index catches up?', '2026-10-23T09:30:00Z', 0), new api.Message('m2', 'm1', 'assistant', 'Keep immutable source revisions. Publish annotations atomically. A quiescent snapshot does not assert that the process has ended.\n\n<script>alert("untrusted transcript")</script>', '2026-10-23T09:31:00Z', 1), ...Array.from({length: 85}, (_, i) => new api.Message(`m${i + 3}`, 'm2', i % 2 ? 'tool' : 'assistant', `Synthetic source message ${i + 3}. Literal archived text, never executed.`, undefined, i + 2))];
    return this.resumedSource && revision === 2 ? messages.map(message => message.with({ text: message.id === 'm1' ? 'HEAD r2 changed the original message text completely.' : `Revision 2 changed message ${message.id}.` })) : messages;
  }
  get messages() { return this.messagesAt(this.headRevision); }
  chunksAt(view) {
    if (view.generationId === undefined) return [];
    const chunks = [new api.Chunk(ID.chunk, ID.session, this.messagesAt(view.revision)[0].text, 'Keep original source independent from publication.', ['source-fidelity'], [new api.Span('m1', 29, 36)], 0.93), new api.Chunk('00000000-0000-4000-8000-000000000008', ID.session, 'Late source page', 'A passage on a later bounded source page.', ['pagination'], [new api.Span('m65', 0, 9)], 0.8)];
    for (let index = chunks.length; index < this.annotationCount; index++) chunks.push(new api.Chunk(`00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}`, ID.session, this.messagesAt(view.revision)[64].text, index === 164 ? 'Winning passage beyond the first hundred.' : `Annotated passage ${index + 1}.`, ['pagination'], [new api.Span('m65', 0, 9)], index === 164 ? 0.99 : 0.5));
    return chunks;
  }
  get chunks() { return this.chunksAt(this.view); }
  get hit() { return new api.SearchHit(this.session, this.winnerBeyondFirstPage ? [this.chunks[164]] : this.chunks.slice(0, 2), .93); }
  async install(page) {
    await page.route('**/api/login', route => {
      const request = api.LoginRequest_JsonCodec.instance.decode(context, route.request().postDataJSON());
      if (!['alice', 'bob'].includes(request.login) || request.password !== 'synthetic-password') return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify(api.Failure_JsonCodec.instance.encode(context, new api.Failure('unauthorized', 'Invalid credentials'))) });
      this.user = new api.UserInfo(request.login, request.login, [api.Scope.Read, api.Scope.Raw]);
      this.signedIn = true; this.mode = 'normal';
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Set-Cookie': 'chronicle_session=synthetic; HttpOnly; SameSite=Strict; Path=/' }, body: JSON.stringify(api.LoginResponse_JsonCodec.instance.encode(context, new api.LoginResponse(this.user, this.version))) });
    });
    await page.routeWebSocket('**/api/ws', socket => {
      const entry = { socket, mode: this.mode, closed: false }; this.sockets.push(entry);
      socket.onClose(() => { entry.closed = true; });
      socket.onMessage(data => {
        const envelope = api.ClientEnvelope_JsonCodec.instance.decode(context, JSON.parse(String(data)));
        this.calls.push(envelope); this.requests.push({ userId: this.user.id, envelope }); const operation = envelope.operation;
        if (entry.mode === 'blackhole' || this.mode === 'outage') return;
        const send = result => socket.send(JSON.stringify(api.ServerEnvelope_JsonCodec.instance.encode(context, new api.ServerEnvelope(envelope.requestId, result))));
        if (this.mode === 'unauthorized' || !this.signedIn) { send(new api.Result_Error(new api.Failure('unauthorized', 'Your session expired. Sign in again.'))); return; }
        if (this.mode === 'version') { send(new api.Result_Error(new api.Failure('version-mismatch', 'Dashboard update required'))); return; }
        if (operation instanceof api.Operation_Hello) { send(new api.Result_Hello(this.version, this.user)); return; }
        if (operation instanceof api.Operation_Ping) { send(new api.Result_Pong(operation.nonce)); return; }
        if (operation instanceof api.Operation_Pong) return;
        if (operation instanceof api.Operation_Whoami) { send(new api.Result_Whoami(this.user)); return; }
        if (operation instanceof api.Operation_Search) {
          this.searchCount++;
          const lexical = operation.query.mode === api.SearchMode.Lexical;
          send(new api.Result_Search(new api.SearchResult([this.hit], 1, lexical ? api.SearchCountScope.ExactMatches : api.SearchCountScope.CandidateWindow, lexical ? undefined : operation.query.mode === api.SearchMode.Hybrid ? 2000 : 1000))); return;
        }
        if (operation instanceof api.Operation_Facets) { send(new api.Result_Facets(new api.FacetsResult([new api.Facet('chronicle', 1)], [new api.Facet('feature/archive', 1)], [new api.Facet('architecture', 1)]))); return; }
        if (operation instanceof api.Operation_GetSession) { const view = operation.view ?? this.view; send(new api.Result_Session(new api.SessionResult(this.sessionAt(view), this.chunksAt(view).slice(0, 100)))); return; }
        if (operation instanceof api.Operation_GetChunks) { const view = this.chunksViewOverride ?? operation.view ?? this.view, chunks = this.chunksAt(view); send(new api.Result_Chunks(new api.ChunksResult(chunks.slice(operation.offset, operation.offset + operation.limit), chunks.length, operation.offset, view))); return; }
        if (operation instanceof api.Operation_GetMessages) { const view = this.messageViewOverride ?? operation.view ?? this.view, messages = this.messagesAt(view.revision); send(new api.Result_Messages(new api.MessagesResult(messages.slice(operation.offset, operation.offset + operation.limit), messages.length, operation.offset, view))); return; }
        if (operation instanceof api.Operation_GetRaw) { const revision = this.rawRevisionOverride ?? operation.revision ?? this.headRevision; send(this.rawDenied ? new api.Result_Error(new api.Failure('forbidden', 'Raw permission denied for this source')) : new api.Result_Raw(new api.RawResult([new api.RawFile('synthetic.jsonl', '0'.repeat(64), this.resumedSource ? JSON.stringify({ revision }) : '{"synthetic":true}')], revision))); return; }
        if (operation instanceof api.Operation_Related) { send(new api.Result_Related(new api.RelatedResult([]))); return; }
        if (operation instanceof api.Operation_ListTokens) { send(new api.Result_Tokens(new api.TokensResult(this.tokens.map(info => new api.ListedToken(info, api.TokenSource.Issued))))); return; }
        if (operation instanceof api.Operation_ListGroups) { send(new api.Result_Groups(new api.GroupsResult(this.groups, this.invitations))); return; }
        if (operation instanceof api.Operation_IngestStatus) { send(new api.Result_Status(new api.StatusResult(this.jobs, this.jobs.length))); return; }
        if (operation instanceof api.Operation_Receipt) { const receipt = this.receipts.get(operation.mutationId); send(receipt ? receipt instanceof api.Result_Token ? receipt : new api.Result_Mutation(receipt) : new api.Result_Error(new api.Failure('not-found', 'Receipt not found'))); return; }
        let entityId;
        if (operation instanceof api.Operation_MintToken) {
          entityId = ID.token; const token = new api.TokenInfo(entityId, operation.name, operation.scopes, '2026-10-24T00:00:00Z', false); this.tokens = [token];
          this.receipts.set(envelope.requestId, new api.Result_Token(new api.TokenResult(token, undefined)));
          if (this.mintUncertain) return;
          send(new api.Result_Token(new api.TokenResult(token, 'synthetic-secret-shown-once'))); return;
        }
        if (operation instanceof api.Operation_RevokeToken) this.tokens = this.tokens.map(token => token.id === operation.tokenId ? token.with({ revoked: true }) : token);
        if (operation instanceof api.Operation_CreateGroup) { entityId = ID.group; this.groups = [...this.groups, new api.GroupInfo('00000000-0000-4000-8000-000000000009', operation.name, 'alice', ['alice'])]; }
        if (operation instanceof api.Operation_Invite) this.invitations = [...this.invitations, new api.InviteInfo('00000000-0000-4000-8000-000000000010', operation.groupId, operation.targetId, '2030-01-01T00:00:00Z')];
        if (operation instanceof api.Operation_AcceptInvite) this.invitations = this.invitations.filter(invitation => invitation.id !== operation.invitationId);
        if (operation instanceof api.Operation_RemoveMember) this.groups = this.groups.map(group => group.id === operation.groupId ? group.with({ members: group.members.filter(member => member !== operation.userId) }) : group);
        if (operation instanceof api.Operation_LeaveGroup || operation instanceof api.Operation_DeleteGroup) this.groups = this.groups.filter(group => group.id !== operation.groupId);
        if (operation instanceof api.Operation_RetryJob) this.jobs = this.jobs.map(job => job.id === operation.jobId ? job.with({ state: api.JobState.Queued }) : job);
        if (operation instanceof api.Operation_Logout) this.mode = 'unauthorized';
        const receipt = new api.MutationReceipt(envelope.requestId, operation.$type.split('#').at(-1), entityId); this.receipts.set(envelope.requestId, receipt); if (operation instanceof api.Operation_Logout && this.dropLogout) return; send(new api.Result_Mutation(receipt));
      });
    });
  }
  blackholeActive() { const active = this.sockets.filter(s => !s.closed).at(-1); if (!active) throw new Error('No socket'); active.mode = 'blackhole'; }
  restart() { for (const entry of this.sockets.filter(s => !s.closed)) entry.socket.close({ code: 1012, reason: 'Synthetic server restart' }); }
}
export { api };
