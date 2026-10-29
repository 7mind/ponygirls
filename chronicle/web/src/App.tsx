import './styles.css';
import { dismissPopoverOnExternalFocus } from './Popover.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeControl } from './ThemeControl.tsx';
import type { ThemeController } from './theme.ts';
import type { FormEvent } from 'react';
import { Operation_Whoami, Operation_Logout, Result_Whoami, Scope, type SessionInfo } from './api.ts';
import type { ChronicleConnection } from './client.ts';
import { login, read } from './client.ts';
import { useConnection, useResource } from './hooks.ts';
import { useSessionRenewal } from './use-session-renewal.ts';
import { ConnectionHealth } from './ConnectionHealth.tsx';
import { Archive, emptyArchive } from './Archive.tsx';
import type { ArchiveState } from './Archive.tsx';
import { ArchiveReadLane } from './archive-requests.ts';
import { SessionFindReadGate } from './session-find.ts';
import { ReindexProgress, useRebuildProgress } from './ReindexProgress.tsx';
import { Access } from './Access.tsx';
import { McpTester, useMcpTester } from './McpTester.tsx';
import { Activity } from './Activity.tsx';
import { useMutations } from './mutations.ts';
import { MutationNotice } from './MutationNotice.tsx';
export function ErrorNotice({ children }: { children: React.ReactNode }) { return <div className="notice error" role="alert">{children}</div>; }
export function Blank({ title, children }: { title: string; children: React.ReactNode }) { return <div className="blank"><span className="blank-icon" aria-hidden="true">⌁</span><h2>{title}</h2><p>{children}</p></div>; }
export function Tags({ tags }: { tags: readonly string[] }) { return <span className="tags">{tags.map(tag => <span className="tag" key={tag}>{tag}</span>)}</span>; }
export function formatDate(value: string | undefined): string { if (!value) return 'date unavailable'; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
export function SessionMeta({ session }: { session: SessionInfo }) { return <span className="meta"><span>{session.source.format}</span><span>{session.metadata.project ?? 'No project'}</span><span>{formatDate(session.metadata.startedAt)}</span></span>; }
function LoginPanel({ connection }: { connection: ChronicleConnection }) {
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
      {error && <ErrorNotice>{error}</ErrorNotice>}
    </section></main>;
}
export function App({ connection, theme }: { connection: ChronicleConnection; theme: ThemeController }) {
  const stats = useConnection(connection), [tab, setTab] = useState<'archive' | 'activity' | 'access' | 'mcp'>('archive');
  // Register transport lifecycle verification before renewal's return/focus listener.
  useEffect(() => { connection.start(); return () => connection.dispose(); }, [connection]);
  const [archive, setArchive] = useState<ArchiveState>(emptyArchive);
  const archiveRequests = useMemo(() => new ArchiveReadLane(), [connection]);
  const findReads = useMemo(() => new SessionFindReadGate(), [connection]);
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
  const [logoutGeneration, setLogoutGeneration] = useState<number | null>(null);
  const renewal = useSessionRenewal(connection, stats, logoutGeneration === stats.generation ? null : user?.id ?? null);
  const tester = useMcpTester(connection, stats, user === null ? null : user.id, tab === 'mcp');
  const actions = useMutations(connection, identity.data?.id ?? null);
  const rebuild = useRebuildProgress(connection, stats, user === null ? null : user.id, user !== null && user.scopes.includes(Scope.Read), actions.ownerReindexed);
  async function logout() {
    renewal.suspend(); setLogoutGeneration(stats.generation); resetArchive(null);
    if (await actions.run(new Operation_Logout(), 'Sign out')) connection.retry();
  }
  return <div className="app-shell" onFocusCapture={dismissPopoverOnExternalFocus}><a className="skip-link" href="#main-content">Skip to content</a><header className="masthead"><a href="/" className="brand" aria-label="Chronicle home"><span className="brand-mark" aria-hidden="true">C<span>·</span></span>chronicle</a>{user && <><nav aria-label="Main navigation">{(['archive', 'activity', 'access', 'mcp'] as const).map(item => <button className={tab === item ? 'nav-active' : ''} onClick={() => setTab(item)} key={item} aria-current={tab === item ? 'page' : undefined}>{item}</button>)}</nav><div className="identity"><span>{user.login}</span><button className="text-button" disabled={actions.busy || actions.uncertain !== null} onClick={() => void logout()}>Sign out</button></div></>}<ThemeControl controller={theme}/><ConnectionHealth connection={connection} stats={stats}/></header>
    <div id="main-content" tabIndex={-1}><div className="global-mutation-notices"><MutationNotice actions={actions}/><ReindexProgress progress={rebuild}/></div>{identity.error && stats.terminal !== 'unauthorized' && <ErrorNotice>{identity.error}</ErrorNotice>}
      {renewal.error && <ErrorNotice>{renewal.error}. Your credentials have not been rejected. <button onClick={renewal.retry}>Retry session renewal</button></ErrorNotice>}
      {stats.terminal === 'unauthorized' ? <LoginPanel connection={connection}/> : stats.terminal === 'update-required' ? <section className="blank"><h2>Dashboard update required</h2><p role="status">This dashboard version is no longer supported. Reload to update before checking your session.</p><button onClick={() => window.location.reload()}>Reload dashboard</button></section> : identity.data === null ? <section className="blank"><h2>{identity.error || stats.terminal !== null ? 'Session unavailable' : stats.activeId === null ? 'Reconnecting' : 'Checking session'}</h2><p role="status">{identity.error || stats.terminal !== null ? 'Session unavailable. Retry without entering credentials.' : stats.activeId === null ? 'Reconnecting and checking your existing session…' : 'Checking your existing session…'}</p><button onClick={() => connection.retry()}>Retry session</button></section> : user === null ? <div className="loading-line" role="status">Preparing an account-scoped archive…</div> : tab === 'archive' ? <Archive connection={connection} requests={archiveRequests} findReads={findReads} stats={stats} user={user} draft={draft} setDraft={setDraft} archive={archive} setArchive={setArchive}/> : tab === 'activity' ? <Activity connection={connection} stats={stats} user={user} actions={actions}/> : tab === 'mcp' ? <McpTester tester={tester}/> : <Access connection={connection} stats={stats} user={user} actions={actions}/>}</div>
    <footer className="app-footer"><span>Chronicle</span></footer>
  </div>;
}
