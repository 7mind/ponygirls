import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Operation_ListGroups, Operation_CreateGroup, Operation_Invite, Operation_AcceptInvite, Operation_RemoveMember, Operation_LeaveGroup, Operation_DeleteGroup, Result_Groups, type GroupInfo, type InviteInfo, type UserInfo } from './api.ts';
import { read, type ChronicleConnection } from './client.ts';
import { useResource } from './hooks.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { Glyph } from './Glyph.tsx';
import type { MutationState } from './mutations.ts';
import type { ManagerStats } from './transport/types.ts';
import './access.css';

const GROUP_NAME_MAX = 120, INVITEE_MAX = 200;
type Pending =
  | { kind: 'join'; invite: InviteInfo }
  | { kind: 'delete'; group: GroupInfo }
  | { kind: 'leave'; group: GroupInfo }
  | { kind: 'remove'; group: GroupInfo; member: string };
function plural(count: number, noun: string) { return `${count} ${noun}${count === 1 ? '' : 's'}`; }
const MS_PER_HOUR = 3_600_000, HOURS_PER_DAY = 24;
const EXPIRY_FORMAT: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
/** `Dec 1, 00:00 · in 13 days` in the browser's time zone (spec §5 rule 9); the title carries the full ISO timestamp. */
function expiry(iso: string, now: number): string {
  const at = new Date(iso), hours = Math.round((at.getTime() - now) / MS_PER_HOUR);
  if (Number.isNaN(hours)) return iso;
  const relative = hours <= 0 ? 'expired' : hours < HOURS_PER_DAY ? `in ${hours} h` : `in ${plural(Math.round(hours / HOURS_PER_DAY), 'day')}`;
  return `${at.toLocaleString(undefined, EXPIRY_FORMAT)} · ${relative}`;
}

export function Access({ connection, stats, user, actions }: { connection: ChronicleConnection; stats: ManagerStats; user: UserInfo; actions: MutationState }) {
  const [creating, setCreating] = useState(false), [pending, setPending] = useState<Pending | null>(null), [understood, setUnderstood] = useState(false), formId = useId();
  const groups = useResource(connection, stats, 'groups', `${actions.revision}`, true, () => read(connection, new Operation_ListGroups(), r => r instanceof Result_Groups ? r.result : null));
  const blocked = actions.busy || actions.uncertain !== null || stats.activeId === null;
  const owned = (group: GroupInfo) => group.ownerId === user.id;
  function ask(next: Pending) { setUnderstood(false); setPending(next); }
  function confirm(item: Pending) {
    setPending(null);
    switch (item.kind) {
      case 'join': void actions.run(new Operation_AcceptInvite(item.invite.id, true), 'Accept group invitation'); break;
      case 'delete': void actions.run(new Operation_DeleteGroup(item.group.id), 'Delete group'); break;
      case 'leave': void actions.run(new Operation_LeaveGroup(item.group.id), 'Leave group'); break;
      case 'remove': void actions.run(new Operation_RemoveMember(item.group.id, item.member), 'Remove member'); break;
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (await actions.run(new Operation_CreateGroup(name), 'Create group')) setCreating(false);
  }
  async function invite(event: FormEvent<HTMLFormElement>, group: GroupInfo) {
    event.preventDefault();
    const form = event.currentTarget;
    if (await actions.run(new Operation_Invite(group.id, String(new FormData(form).get('target')).trim()), 'Invite member')) form.reset();
  }
  const invitations = groups.data?.invitations ?? [], memberships = groups.data?.groups ?? [];
  return <main className="page page-narrow stack-lg" aria-label="Access management">
    <div className="page-head">
      <div><h1 className="page-title">Access</h1><p className="page-sub">Sharing groups give every member read access to the other members' sessions. API access tokens live in <a href="#account/tokens">Account → Access tokens</a>.</p></div>
      <button type="button" className="btn btn-primary" aria-expanded={creating} aria-controls={formId} onClick={() => setCreating(open => !open)}><Glyph name="plus"/>New group</button>
    </div>
    {creating && <form className="card" id={formId} onSubmit={event => void create(event)}>
      <div className="card-head"><h2>New sharing group</h2></div>
      <div className="card-body stack">
        <div className="field"><label className="label" htmlFor={`${formId}-name`}>Group name</label><input className="input" id={`${formId}-name`} name="name" required maxLength={GROUP_NAME_MAX} placeholder="Project collaborators" autoFocus/><span className="hint">You become the owner. Invite members after creating it.</span></div>
        <div className="form-actions"><button type="submit" className="btn btn-primary" disabled={blocked}>Create group</button><button type="button" className="btn" onClick={() => setCreating(false)}>Cancel</button></div>
      </div>
    </form>}
    {groups.error && <div className="notice notice-danger" role="alert"><Glyph name="alert"/><div>{groups.error}</div></div>}
    {groups.loading && <div className="list-foot" role="status"><span className="spinner" aria-hidden="true"/>Loading memberships and invitations…</div>}
    {invitations.length > 0 && <section className="stack" aria-label="Pending invitations">
      <div className="row"><h2 className="section-title">Invitations</h2><span className="count count-attn">{invitations.length}</span></div>
      <div className="notice notice-warn"><Glyph name="alert"/><div><div className="notice-title">Joining a group shares your sessions</div>All your eligible existing and future sessions become readable by every current and future member of that group. Members get read access, not edit access. Sharing does not extend through a member's other groups.</div></div>
      <div className="card">{invitations.map(item => <div className="access-invitation" key={item.id} data-invitation-id={item.id}>
        <div className="grow"><strong>Invitation to group <code>{item.groupId}</code></strong><div className="xs muted" title={item.expiresAt}>Expires {expiry(item.expiresAt, Date.now())}</div></div>
        <button type="button" className="btn btn-sm" disabled={blocked} onClick={() => ask({ kind: 'join', invite: item })}>Review and join…</button>
      </div>)}</div>
    </section>}
    {groups.data !== null && <section className="stack" aria-label="Your groups">
      <div className="row"><h2 className="section-title">Your groups</h2><span className="count">{memberships.length}</span></div>
      {memberships.length === 0 && <div className="card"><div className="empty"><h3>No groups yet</h3><p>Create a group to share your sessions with its members, or wait for an invitation.</p></div></div>}
      {memberships.map(group => <GroupCard key={group.id} group={group} user={user} owner={owned(group)} blocked={blocked} ask={ask} invite={invite}/>)}
    </section>}
    {pending !== null && <PendingDialog pending={pending} understood={understood} setUnderstood={setUnderstood} confirm={() => confirm(pending)} cancel={() => setPending(null)}/>}
  </main>;
}

function GroupCard({ group, user, owner, blocked, ask, invite }: { group: GroupInfo; user: UserInfo; owner: boolean; blocked: boolean; ask: (pending: Pending) => void; invite: (event: FormEvent<HTMLFormElement>, group: GroupInfo) => Promise<void> }) {
  const titleId = useId();
  return <article className="card" aria-labelledby={titleId} data-group-id={group.id}>
    <div className="card-head">
      <div className="grow"><h3 id={titleId}>{group.name}</h3><code className="xs muted access-group-id">{group.id}</code></div>
      <span className={owner ? 'chip chip-accent' : 'chip'}>{owner ? 'Owner' : 'Member'}</span>
      <span className="xs muted">{plural(group.members.length, 'member')}{owner ? '' : ` · owner ${group.ownerId}`}</span>
      {owner
        ? <button type="button" className="btn btn-sm btn-danger-quiet" disabled={blocked} onClick={() => ask({ kind: 'delete', group })}>Delete group…</button>
        : <button type="button" className="btn btn-sm" disabled={blocked} onClick={() => ask({ kind: 'leave', group })}>Leave group…</button>}
    </div>
    <table className="table table-static table-inset" aria-label={`Members of ${group.name}`}>
      <thead><tr><th>Member</th><th>Role</th><th className="col-actions"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{group.members.map(member => <tr key={member}>
        <td><span className="cell-title">{member}{member === user.id && <span className="muted"> (you)</span>}</span></td>
        <td>{member === group.ownerId ? 'Owner' : 'Member'}</td>
        <td className="col-actions">{owner && member !== user.id && <button type="button" className="btn btn-sm" disabled={blocked} aria-label={`Remove ${member} from ${group.name}`} onClick={() => ask({ kind: 'remove', group, member })}>Remove</button>}</td>
      </tr>)}</tbody>
    </table>
    {owner && <form className="card-foot" onSubmit={event => void invite(event, group)}>
      <input className="input access-invite-input" name="target" required maxLength={INVITEE_MAX} placeholder="User id to invite" aria-label="User id to invite"/>
      <button type="submit" className="btn" disabled={blocked}>Invite</button><span className="xs muted">Invitations expire after 24 hours.</span>
    </form>}
  </article>;
}

function PendingDialog({ pending, understood, setUnderstood, confirm, cancel }: { pending: Pending; understood: boolean; setUnderstood: (value: boolean) => void; confirm: () => void; cancel: () => void }) {
  switch (pending.kind) {
    case 'join': return <ConfirmDialog title="Join this group?" wide={true} confirmLabel="Join and share" danger={false} confirmDisabled={!understood} onConfirm={confirm} onCancel={cancel}>
      <p>Invitation to group <code>{pending.invite.groupId}</code>. Joining shares <strong>all your eligible existing and future sessions</strong> with every current and future member of that group. You can leave at any time; leaving stops sharing.</p>
      <label className="check"><input type="checkbox" checked={understood} onChange={event => setUnderstood(event.target.checked)}/>I understand that joining shares all my eligible sessions with this group.</label>
    </ConfirmDialog>;
    case 'delete': return <ConfirmDialog title={`Delete “${pending.group.name}”?`} wide={false} confirmLabel="Delete group" danger={true} confirmDisabled={false} onConfirm={confirm} onCancel={cancel}>
      <p>Sharing through this group ends immediately for its {plural(pending.group.members.length, 'member')}. This cannot be undone.</p>
    </ConfirmDialog>;
    case 'leave': return <ConfirmDialog title={`Leave “${pending.group.name}”?`} wide={false} confirmLabel="Leave group" danger={true} confirmDisabled={false} onConfirm={confirm} onCancel={cancel}>
      <p>Direct sharing through this group ends. You can be invited again.</p>
    </ConfirmDialog>;
    case 'remove': return <ConfirmDialog title={`Remove ${pending.member} from “${pending.group.name}”?`} wide={false} confirmLabel="Remove member" danger={true} confirmDisabled={false} onConfirm={confirm} onCancel={cancel}>
      <p>Sharing between <strong>{pending.member}</strong> and the other members of this group ends. You can invite them again.</p>
    </ConfirmDialog>;
  }
}
