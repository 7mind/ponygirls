import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeControl } from './ThemeControl.tsx';
import type { ThemeController } from './theme.ts';
import type { FormEvent } from 'react';
import { Operation_Whoami, Operation_Logout, Result_Whoami, type SessionInfo } from './api.ts';
import type { ChronicleConnection } from './client.ts';
import { login, read } from './client.ts';
import { useConnection, useResource } from './hooks.ts';
import { ConnectionHealth } from './ConnectionHealth.tsx';
import { Archive, emptyArchive } from './Archive.tsx';
import type { ArchiveState } from './Archive.tsx';
import { ArchiveReadLane } from './archive-requests.ts';
import { Access } from './Access.tsx';
import { McpTester, useMcpTester } from './McpTester.tsx';
import { Activity } from './Activity.tsx';
import { useMutations } from './mutations.ts';
import { MutationNotice } from './MutationNotice.tsx';
import type { ManagerStats } from './transport/types.ts';
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
export function App({ connection, theme }: { connection: ChronicleConnection; theme: ThemeController }) {
  const stats = useConnection(connection), [tab, setTab] = useState<'archive' | 'activity' | 'access' | 'mcp'>('archive');
  const [archive, setArchive] = useState<ArchiveState>(emptyArchive);
  const archiveRequests = useMemo(() => new ArchiveReadLane(), [connection]);
  useEffect(() => {
    const unsubscribe = connection.onInvalidate(() => archiveRequests.invalidate());
    return () => { unsubscribe(); archiveRequests.invalidate(); };
  }, [connection, archiveRequests]);
  const [draft, setDraft] = useState('');
  const [archiveOwner, setArchiveOwner] = useState<string | null>(null);
  const resetArchive = useCallback((owner: string | null) => {
    archiveRequests.invalidate(); setArchive(emptyArchive()); setDraft(''); setTab('archive'); setArchiveOwner(owner);
  }, [archiveRequests]);
  const identity = useResource(connection, stats, 'identity', '', true, () => read(connection, new Operation_Whoami(), r => r instanceof Result_Whoami ? r.user : null));
  useEffect(() => {
    if (stats.terminal === 'unauthorized') { if (archiveOwner !== null) resetArchive(null); return; }
    if (identity.data !== null && identity.data.id !== archiveOwner) resetArchive(identity.data.id);
  }, [identity.data?.id, archiveOwner, stats.terminal, resetArchive]);
  const user = identity.data !== null && identity.data.id === archiveOwner ? identity.data : null;
  const tester = useMcpTester(connection, stats, user === null ? null : user.id, tab === 'mcp');
  const actions = useMutations(connection, identity.data?.id ?? null);
  useEffect(() => { connection.start(); return () => connection.dispose(); }, [connection]);
  async function logout() {
    resetArchive(null);
    if (await actions.run(new Operation_Logout(), 'Sign out')) connection.retry();
  }
  return <><a className="skip-link" href="#main-content">Skip to content</a><header className="masthead"><a href="/" className="brand" aria-label="Chronicle home"><span className="brand-mark" aria-hidden="true">C<span>·</span></span>chronicle</a>{user && <><nav aria-label="Main navigation">{(['archive', 'activity', 'access', 'mcp'] as const).map(item => <button className={tab === item ? 'nav-active' : ''} onClick={() => setTab(item)} key={item} aria-current={tab === item ? 'page' : undefined}>{item}</button>)}</nav><div className="identity"><span>{user.login}</span><button className="text-button" disabled={actions.busy || actions.uncertain !== null} onClick={() => void logout()}>Sign out</button></div></>}<ThemeControl controller={theme}/></header>
    <div id="main-content" tabIndex={-1}><div className="global-mutation-notices"><MutationNotice actions={actions}/></div>{identity.error && stats.terminal !== 'unauthorized' && <ErrorNotice>{identity.error}</ErrorNotice>}
      {identity.data === null ? <LoginPanel connection={connection} stats={stats}/> : user === null ? <div className="loading-line" role="status">Preparing an account-scoped archive…</div> : tab === 'archive' ? <Archive connection={connection} requests={archiveRequests} stats={stats} user={user} draft={draft} setDraft={setDraft} archive={archive} setArchive={setArchive}/> : tab === 'activity' ? <Activity connection={connection} stats={stats} user={user} actions={actions}/> : tab === 'mcp' ? <McpTester tester={tester}/> : <Access connection={connection} stats={stats} user={user} actions={actions}/>}</div>
    <footer className="app-footer"><span>Chronicle</span></footer><ConnectionHealth connection={connection} stats={stats}/>
  </>;
}
