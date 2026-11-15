import { useState } from 'react';
import type { FormEvent } from 'react';
import { Operation_ListGroups, Operation_CreateGroup, Operation_Invite, Operation_AcceptInvite, Operation_RemoveMember, Operation_LeaveGroup, Operation_DeleteGroup, Result_Groups, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { ErrorNotice } from './App.tsx';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
export function Access({ connection, stats, user, actions }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState }) {
  const [sharing, setSharing] = useState<string[]>([]);
  const groups = useResource(connection, stats, 'groups', `${actions.revision}`, true, () => read(connection, new Operation_ListGroups(), r => r instanceof Result_Groups ? r.result : null));
  const blocked = actions.busy || actions.uncertain !== null || stats.activeId === null;
  function named(event: FormEvent<HTMLFormElement>, operation: (name: string) => void) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form); operation(String(data.get('name')).trim()); form.reset();
  }
  return <main className="dashboard-page management-page" aria-label="Access management">
    <div className="management-grid"><section className="management-section"><div className="section-heading"><h2>Access tokens</h2></div><p>Create and revoke API access tokens in account settings. Configured tokens are visible there as read-only.</p><button data-account-settings data-account-user-id={user.id}>Open token settings</button>
    </section><section className="management-section"><div className="section-heading"><h2>Sharing groups</h2></div><p className="sharing-warning">Joining shares <strong>all your eligible existing and future sessions</strong> with every current and future member of that group. Members receive read access, not edit access. Sharing does not extend through a member's other groups.</p>
      <form className="inline-form create-group" onSubmit={event => named(event, name => void actions.run(new Operation_CreateGroup(name), 'Create group'))}><label>New group name<input name="name" required maxLength={120} placeholder="Project collaborators"/></label><button disabled={blocked}>Create group</button></form>
      {groups.error && <ErrorNotice>{groups.error}</ErrorNotice>}{groups.loading && <p role="status">Loading memberships and invitations…</p>}
      {groups.data?.invitations.map(invite => <div className="invitation" key={invite.id}><h3>Invitation to group <code>{invite.groupId}</code></h3><p>For {invite.targetId} · expires {new Date(invite.expiresAt).toLocaleString()}</p><label className="check-label"><input type="checkbox" checked={sharing.includes(invite.id)} onChange={e => setSharing(current => e.target.checked ? [...current, invite.id] : current.filter(id => id !== invite.id))}/>I understand: joining shares ALL my eligible existing and future sessions with current and future group members.</label><button className="primary" disabled={blocked || !sharing.includes(invite.id)} onClick={() => void actions.run(new Operation_AcceptInvite(invite.id, true), 'Accept group invitation')}>Accept invitation & share</button></div>)}
      {groups.data?.groups.map(group => <article className="group-card" key={group.id}><div className="section-heading"><h3>{group.name}</h3><span className="badge">{group.ownerId === user.id ? 'Owner' : 'Member'}</span></div><code className="tiny">{group.id}</code><ul className="member-list">{group.members.map(member => <li key={member}><span>{member}{member === user.id ? ' (you)' : ''}{member === group.ownerId ? ' · owner' : ''}</span>{group.ownerId === user.id && member !== user.id && <button className="text-button" disabled={blocked} onClick={() => void actions.run(new Operation_RemoveMember(group.id, member), 'Remove member')}>Remove</button>}</li>)}</ul>
        {group.ownerId === user.id ? <><form className="invite-form" onSubmit={event => { event.preventDefault(); const form = event.currentTarget, data = new FormData(form); void actions.run(new Operation_Invite(group.id, String(data.get('target')).trim()), 'Invite member'); form.reset(); }}><label>Existing user ID<input name="target" required maxLength={200}/></label><button disabled={blocked}>Invite</button></form><button className="danger text-button" disabled={blocked} onClick={() => { if (window.confirm(`Delete ${group.name}? Sharing through this group ends for all members.`)) void actions.run(new Operation_DeleteGroup(group.id), 'Delete group'); }}>Delete group</button></> : <button className="danger text-button" disabled={blocked} onClick={() => { if (window.confirm(`Leave ${group.name}? Direct sharing through this group will end.`)) void actions.run(new Operation_LeaveGroup(group.id), 'Leave group'); }}>Leave group</button>}
      </article>)}{groups.data?.groups.length === 0 && groups.data.invitations.length === 0 && <p className="tiny">No groups or invitations.</p>}
    </section></div></main>;
}
