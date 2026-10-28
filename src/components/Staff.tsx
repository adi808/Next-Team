import { rpc, useAction, useLoad } from '../lib/db';
import { Badge, Card, Empty, ErrorText } from './ui';
import { Picture } from './Picture';
import { useLookupName, useLookups } from './Lookups';

interface StaffRow { membership_id: string; user_id: string; full_name: string; avatar_path: string | null; staff_role_id: string | null }

/** Select for a staff member's type (head coach, assistant, fitness, secretary, medic: the "staff_role" list). */
export function StaffRoleSelect({ membershipId, value, onSaved }: { membershipId: string; value: string | null; onSaved: () => void }) {
  const roles = useLookups('staff_role');
  const act = useAction();
  return (
    <>
      <select className="inline-select" aria-label="תפקיד בצוות" value={value ?? ''} disabled={act.busy}
        onChange={(e) => act.run(async () => { await rpc('set_staff_role', { p_membership: membershipId, p_role: e.target.value || null }); onSaved(); })}>
        <option value="">סוג תפקיד…</option>
        {roles.map((l) => <option key={l.id} value={l.id}>{l.name_he}</option>)}
      </select>
      <ErrorText error={act.error} />
    </>
  );
}

/** The team's professional staff with their types; everyone on the team sees it, staff managers edit the types. */
export function TeamStaff({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const { data, error, reload } = useLoad(() => rpc<StaffRow[]>('team_staff', { p_team: teamId }), [teamId]);
  const roleName = useLookupName('staff_role');
  return (
    <Card title="צוות מקצועי">
      <ErrorText error={error} />
      {data && !data.length && <Empty>עדיין אין אנשי צוות בקבוצה.</Empty>}
      <ul className="list compact">
        {data?.map((s) => (
          <li key={s.membership_id} className="row">
            <Picture bucket="avatars" path={s.avatar_path} name={s.full_name || '?'} size={32} />
            <span>{s.full_name || 'איש צוות'}</span>
            <span className="grow" />
            {canManage
              ? <StaffRoleSelect membershipId={s.membership_id} value={s.staff_role_id} onSaved={reload} />
              : <Badge>{roleName(s.staff_role_id) || 'מאמן'}</Badge>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
