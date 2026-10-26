import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SearchMode, SearchMode_parse, SearchCountScope, SearchFilter, SearchQuery, Operation_Whoami, Operation_Search, Operation_Facets, Operation_Logout, Result_Whoami, Result_Search, Result_Facets, type UserInfo, type SessionInfo, type SearchHit } from './api.ts';
import type { ChronicleConnection } from './client.ts';
import { login, read } from './client.ts';
import { useConnection, useResource } from './hooks.ts';
import { ConnectionHealth } from './ConnectionHealth.tsx';
import { Conversation } from './Conversation.tsx';
import { Access } from './Access.tsx';
import { Activity } from './Activity.tsx';
import { useMutations } from './mutations.ts';
import { MutationNotice } from './MutationNotice.tsx';
import type { ManagerStats } from './transport/types.ts';
interface ArchiveState { submitted: SearchDraft | null; offset: number; selection: string | null; selectionKey: number }
export interface SearchDraft { query: string; mode: SearchMode; project: string; branch: string; after: string; before: string; tags: string }
function emptyArchive(): ArchiveState { return { submitted: null, offset: 0, selection: null, selectionKey: 0 }; }
function emptyDraft(): SearchDraft { return { query: '', mode: SearchMode.Hybrid, project: '', branch: '', after: '', before: '', tags: '' }; }
function filter(draft: SearchDraft): SearchFilter {
  return new SearchFilter(draft.project.trim() || undefined, draft.branch.trim() || undefined,
    draft.after ? new Date(draft.after).toISOString() : undefined, draft.before ? new Date(draft.before).toISOString() : undefined,
    draft.tags.split(',').map(s => s.trim()).filter(Boolean));
}
export function ErrorNotice({ children }: { children: React.ReactNode }) { return <div className="notice error" role="alert">{children}</div>; }
export function Blank({ title, children }: { title: string; children: React.ReactNode }) { return <div className="blank"><span className="blank-icon" aria-hidden="true">⌁</span><h2>{title}</h2><p>{children}</p></div>; }
export function Tags({ tags }: { tags: readonly string[] }) { return <span className="tags">{tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}</span>; }
export function formatDate(value: string | undefined): string { if (!value) return 'date unavailable'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
export function SessionMeta({ session }: { session: SessionInfo }) { return <span className="meta"><span>{session.source.format}</span><span>{session.metadata.project ?? 'No project'}</span><span>{formatDate(session.metadata.startedAt)}</span></span>; }
function LoginPanel({ connection, stats }: { connection: ChronicleConnection; stats: ManagerStats }) {
  const [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setPending(true); setError(null);
    const password = String(values.get('password')); form.reset();
    try { await login(window.fetch.bind(window), String(values.get('login')), password); connection.retry(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed'); }
    finally { setPending(false); }
  }
  return <main className="login-layout"><div className="login-story"><span className="eyebrow">SESSION ARCHIVE</span><h1>Archive</h1><p>Search archived agent sessions and read their source messages.</p><div className="story-rule"/></div>
    <section className="login-card"><span className="eyebrow">ACCOUNT</span><h2>Sign in</h2><p>Sign in with your configured account. Your browser uses a revocable, HttpOnly session cookie.</p>
      <form onSubmit={event => void submit(event)}><label>Login<input name="login" autoComplete="username" required maxLength={200}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={1000}/></label><button className="primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in →'}</button></form>
      {error && <ErrorNotice>{error}</ErrorNotice>}{stats.terminal === 'update-required' && <ErrorNotice>This dashboard version is no longer supported. Reload to update before signing in.</ErrorNotice>}
      {stats.activeId === null && stats.terminal === null && <p className="tiny" role="status">Checking for an existing session…</p>}
    </section></main>;
}
function Hit({ hit, selected, select }: { hit: SearchHit; selected: boolean; select: () => void }) {
  const metadata = hit.session.metadata, chunk = hit.chunks[0];
  return <button className={`search-hit ${selected ? 'selected' : ''}`} onClick={select} aria-pressed={selected}>
    <SessionMeta session={hit.session}/><h3>{metadata.title || 'Untitled session'}</h3>
    <p>{chunk ? chunk.summary || chunk.text.slice(0, 260) : 'Archived source · no published annotation'}</p><Tags tags={metadata.tags}/>
    <span className="hit-bottom"><span>{hit.session.ownerId} · {hit.session.source.discoveryRootId}</span><span>{hit.session.indexedRevision === hit.session.revision ? 'Indexed' : 'Indexing lag'} ↗</span></span>
  </button>;
}
function Archive({ connection, stats, user, draft, setDraft, archive, setArchive }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; draft: SearchDraft; setDraft: (draft: SearchDraft) => void; archive: ArchiveState; setArchive: React.Dispatch<React.SetStateAction<ArchiveState>> }) {
  const { submitted, offset, selection } = archive;
  const setSelection = (selection: string | null) => setArchive(current => ({ ...current, selection, selectionKey: current.selectionKey + 1 }));
  const setOffset = (update: (offset: number) => number) => setArchive(current => ({ ...current, offset: update(current.offset) }));
  const [refresh, setRefresh] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); searchInput.current?.select(); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setRefresh(n => n + 1), 20_000); return () => window.clearInterval(timer); }, []);
  const results = useResource(connection, stats, `${JSON.stringify(submitted)}:${offset}:${refresh}`, submitted !== null,
    () => read(connection, new Operation_Search(new SearchQuery(submitted!.query, submitted!.mode, filter(submitted!), 20, offset)), r => r instanceof Result_Search ? r.result : null));
  const facets = useResource(connection, stats, `${JSON.stringify(submitted)}:${refresh}`, true,
    () => read(connection, new Operation_Facets(filter(submitted ?? draft)), r => r instanceof Result_Facets ? r.result : null));
  const setField = (field: keyof SearchDraft, value: string) => setDraft({ ...draft, [field]: field === 'mode' ? SearchMode_parse(value) : value });
  function submit(event: FormEvent) { event.preventDefault(); setArchive(current => ({ ...current, submitted: { ...draft }, offset: 0 })); setRefresh(n => n + 1); }
  return <main className="archive"><section className="search-area"><div className="archive-heading"><div><span className="eyebrow">ARCHIVE</span><h1>Search sessions</h1></div><span className="quiet">Messages and annotations</span></div>
    <form className="search-form" onSubmit={submit}><div className="search-line"><span aria-hidden="true" className="search-symbol">⌕</span><input ref={searchInput} aria-label="Search conversations" placeholder="Search terms" value={draft.query} onChange={e => setField('query', e.target.value)} maxLength={4000}/><kbd>⌘ / Ctrl K</kbd><button className="primary" disabled={stats.activeId === null}>Search <span aria-hidden="true">↗</span></button></div>
      <div className="search-options"><fieldset className="mode-switch"><legend className="sr-only">Search mode</legend>{[SearchMode.Lexical, SearchMode.Semantic, SearchMode.Hybrid].map(mode => <label key={mode} className={draft.mode === mode ? 'mode active-mode' : 'mode'}><input type="radio" name="mode" value={mode} checked={draft.mode === mode} onChange={e => setField('mode', e.target.value)}/>{mode}</label>)}</fieldset><details className="filters"><summary>Filters <span aria-hidden="true">＋</span></summary><div className="filter-fields">
        <label>Project<input list="projects" value={draft.project} onChange={e => setField('project', e.target.value)}/></label><datalist id="projects">{facets.data?.projects.map(f => <option key={f.value} value={f.value}>{f.count}</option>)}</datalist>
        <label>Git branch<input list="branches" value={draft.branch} onChange={e => setField('branch', e.target.value)}/></label><datalist id="branches">{facets.data?.branches.map(f => <option key={f.value} value={f.value}>{f.count}</option>)}</datalist>
        <label>After<input type="datetime-local" value={draft.after} onChange={e => setField('after', e.target.value)}/></label><label>Before<input type="datetime-local" value={draft.before} onChange={e => setField('before', e.target.value)}/></label>
        <label className="wide-field">Tags · comma-separated<input value={draft.tags} onChange={e => setField('tags', e.target.value)} placeholder="architecture, migration"/></label><button type="button" onClick={() => setDraft({ ...draft, project: '', branch: '', after: '', before: '', tags: '' })}>Clear filters</button>
      </div></details><span className="mode-note">{draft.mode === SearchMode.Hybrid ? 'Lexical + semantic rank fusion' : draft.mode === SearchMode.Semantic ? 'Semantic similarity ranking' : 'Exact words and full-text ranking'}</span></div>
    </form></section>
    <div className={`workspace ${selection !== null ? 'has-selection' : ''}`}><section className="results-panel" aria-label="Search results"><div className="section-heading"><h2>Conversations</h2><span className="eyebrow" role="status">{results.loading ? 'Searching…' : results.data ? `${results.data.total} ${results.data.countScope === SearchCountScope.CandidateWindow ? 'RANKED CANDIDATES' : 'RESULTS'}` : 'NO SEARCH SUBMITTED'}</span></div>
      {results.error && <ErrorNotice>{results.error} No fallback search was used.</ErrorNotice>}{facets.error && <p className="tiny" role="status">Filter suggestions unavailable: {facets.error}</p>}
      {results.data && <><div className="result-context">{submitted?.mode} · {submitted?.query || 'All conversations'}{results.data.countScope === SearchCountScope.CandidateWindow && <span> · Approximate ranking of up to {results.data.rankingLimit} chunks; count is not the archive total.</span>}</div>{results.data.hits.map(hit => <Hit key={hit.session.id} hit={hit} selected={selection === hit.session.id} select={() => setSelection(hit.session.id)}/>)}{results.data.hits.length === 0 && <Blank title="No matching sessions">Try fewer filters or a different search mode.</Blank>}<nav className="pagination" aria-label="Search result pages"><button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 20))}>← Previous</button><span>{results.data.total === 0 ? '0' : `${offset + 1}–${Math.min(offset + 20, results.data.total)}`} of {results.data.total}</span><button disabled={offset + 20 >= results.data.total} onClick={() => setOffset(n => n + 20)}>Next →</button></nav></>}
      {!submitted && <Blank title="No search submitted">Enter search terms or use filters to find archived sessions.</Blank>}
      {results.loading && <div className="loading-line" role="status">Retrieving an authorized snapshot…</div>}
    </section><section className="source-panel" aria-label="Conversation source">{selection === null ? <Blank title="No session selected">Select a session to view source messages, annotations and provenance.</Blank> : <Conversation key={`${selection}:${archive.selectionKey}`} connection={connection} stats={stats} user={user} sessionId={selection} match={results.data?.hits.find(hit => hit.session.id === selection) ?? null} select={setSelection} close={() => setSelection(null)} refresh={refresh}/>}</section></div>
  </main>;
}
export function App({ connection }: { connection: ChronicleConnection }) {
  const stats = useConnection(connection), [tab, setTab] = useState<'archive' | 'activity' | 'access'>('archive');
  const [archive, setArchive] = useState<ArchiveState>(emptyArchive);
  const [draft, setDraft] = useState<SearchDraft>(emptyDraft);
  const [archiveOwner, setArchiveOwner] = useState<string | null>(null);
  const identity = useResource(connection, stats, 'identity', true, () => read(connection, new Operation_Whoami(), r => r instanceof Result_Whoami ? r.user : null));
  useEffect(() => {
    if (identity.data !== null && identity.data.id !== archiveOwner) {
      setArchive(emptyArchive()); setDraft(emptyDraft()); setTab('archive'); setArchiveOwner(identity.data.id);
    }
  }, [identity.data?.id, archiveOwner]);
  const user = identity.data !== null && identity.data.id === archiveOwner ? identity.data : null;
  const actions = useMutations(connection, identity.data?.id ?? null);
  useEffect(() => { connection.start(); return () => connection.dispose(); }, [connection]);
  async function logout() {
    setArchive(emptyArchive()); setDraft(emptyDraft()); setTab('archive'); setArchiveOwner(null);
    if (await actions.run(new Operation_Logout(), 'Sign out')) connection.retry();
  }
  return <><a className="skip-link" href="#main-content">Skip to content</a><header className="masthead"><a href="/" className="brand" aria-label="Chronicle home"><span className="brand-mark" aria-hidden="true">C<span>·</span></span>chronicle</a>{user && <><nav aria-label="Main navigation">{(['archive', 'activity', 'access'] as const).map(item => <button className={tab === item ? 'nav-active' : ''} onClick={() => setTab(item)} key={item} aria-current={tab === item ? 'page' : undefined}>{item}</button>)}</nav><div className="identity"><span>{user.login}</span><button className="text-button" disabled={actions.busy || actions.uncertain !== null} onClick={() => void logout()}>Sign out</button></div></>}</header>
    <div id="main-content" tabIndex={-1}><div className="global-mutation-notices"><MutationNotice actions={actions}/></div>{identity.error && stats.terminal !== 'unauthorized' && <ErrorNotice>{identity.error}</ErrorNotice>}
      {identity.data === null ? <LoginPanel connection={connection} stats={stats}/> : user === null ? <div className="loading-line" role="status">Preparing an account-scoped archive…</div> : tab === 'archive' ? <Archive connection={connection} stats={stats} user={user} draft={draft} setDraft={setDraft} archive={archive} setArchive={setArchive}/> : tab === 'activity' ? <Activity connection={connection} stats={stats} actions={actions}/> : <Access connection={connection} stats={stats} user={user} actions={actions}/>}</div>
    <footer className="app-footer"><span>Chronicle</span></footer><ConnectionHealth connection={connection} stats={stats}/>
  </>;
}
