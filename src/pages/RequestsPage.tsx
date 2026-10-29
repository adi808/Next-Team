import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isDemo, supabase } from '../lib/supabase';
import { ageOf, fmtDate, q, rpc, useAction, useLoad } from '../lib/db';
import { LookupSelect, useLookupName } from '../components/Lookups';
import { Badge, Card, Empty, ErrorText, Loading } from '../components/ui';
import type { Player } from '../lib/types';

export interface JoinRequest {
  id: string; team_id: string; team_name: string; role: 'coach' | 'parent'; staff_role_id: string | null;
  full_name: string; email: string | null; phone: string | null; avatar_path: string | null;
  children: { full_name: string; birth_date: string; email: string | null; phone?: string | null }[]; created_at: string;
  relation_id?: string | null;
  other_parent?: { full_name: string; relation_id: string | null; phone: string | null; email: string | null } | null;
}

export const loadRequests = () => (isDemo ? Promise.resolve<JoinRequest[]>([]) : rpc<JoinRequest[]>('pending_join_requests'));

/** Shown above every staff screen while join requests wait for the viewer's decision: how many, and who. */
export function PendingRequestsBanner() {
  const { data } = useLoad(() => loadRequests().catch(() => []), []);
  const staffName = useLookupName('staff_role');
  if (!data?.length) return null;
  const as = (r: JoinRequest) => (r.role === 'parent' ? 'הורה' : staffName(r.staff_role_id) || 'מאמן');
  return (
    <Link className="requests-banner" to="requests">
      <strong>🔔 {data.length === 1 ? 'בקשת הצטרפות אחת ממתינה' : `${data.length} בקשות הצטרפות ממתינות`} לאישור</strong>
      <ul>
        {data.slice(0, 3).map((r) => <li key={r.id}>{r.full_name} · {as(r)} · {r.team_name}</li>)}
        {data.length > 3 && <li>ועוד {data.length - 3}…</li>}
      </ul>
      <span className="go">לאישור או דחייה ←</span>
    </Link>
  );
}

/** Join requests the viewer may decide: staff (club admin decides) and parents (team staff decide). */
export default function RequestsPage() {
  const { data, loading, error, reload } = useLoad(loadRequests, []);
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <>
      <h2>בקשות הצטרפות</h2>
      {!data.length && <Empty>אין בקשות שממתינות לאישור.</Empty>}
      {data.map((r) => <RequestCard key={r.id} r={r} onDone={reload} />)}
    </>
  );
}

function RequestCard({ r, onDone }: { r: JoinRequest; onDone: () => void }) {
  const staffName = useLookupName('staff_role');
  const relationName = useLookupName('guardian_relation');
  const [staff, setStaff] = useState<string | null>(r.staff_role_id);
  const [matches, setMatches] = useState<Record<number, string>>({});
  const roster = useLoad(async () => {
    if (r.role !== 'parent') return [];
    const links = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', r.team_id));
    const ids = links.map((l) => l.player_id);
    return ids.length ? q<Player[]>(supabase.from('v_players').select('*').in('id', ids).order('full_name')) : [];
  }, [r.team_id, r.role]);
  const act = useAction();

  const decide = (approve: boolean) => act.run(async () => {
    await rpc('decide_join_request', {
      p_request: r.id, p_approve: approve, p_matches: matches, p_staff_role: r.role === 'coach' ? staff : null,
    });
    onDone();
  });
  const asLabel = r.role === 'parent' ? 'הורה' : staffName(r.staff_role_id) || 'מאמן';
  return (
    <Card title={r.full_name} actions={<Badge tone="warn">{asLabel}</Badge>}>
      <p className="muted">
        {r.team_name} · {fmtDate(r.created_at)}<br />
        {r.email}{r.phone ? ` · ${r.phone}` : ''}{r.relation_id ? ` · ${relationName(r.relation_id)}` : ''}
      </p>
      {r.other_parent && (
        <p className="muted">
          הורה שני: <strong>{r.other_parent.full_name}</strong>
          {r.other_parent.relation_id ? ` · ${relationName(r.other_parent.relation_id)}` : ''}
          {r.other_parent.phone ? ` · ${r.other_parent.phone}` : ''}{r.other_parent.email ? ` · ${r.other_parent.email}` : ''}
        </p>
      )}
      {r.role === 'coach' && (
        <label className="field"><span>סוג צוות באישור</span>
          <LookupSelect domain="staff_role" value={staff} onChange={setStaff} empty="מאמן (ללא סוג)" />
        </label>
      )}
      {r.role === 'parent' && (
        <ul className="list compact">
          {r.children.map((c, n) => (
            <li key={n} className="stack">
              <span><strong>{c.full_name}</strong> <small className="muted">גיל {ageOf(c.birth_date)}{c.email ? ` · ${c.email}` : ''}{c.phone ? ` · ${c.phone}` : ''}</small></span>
              {!!roster.data?.length && (
                <select value={matches[n] ?? ''} onChange={(e) => setMatches({ ...matches, [n]: e.target.value })}>
                  <option value="">שחקן חדש בקבוצה</option>
                  {roster.data.map((p) => <option key={p.id} value={p.id}>זה {p.full_name} שכבר בסגל</option>)}
                </select>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button disabled={act.busy} onClick={() => decide(true)}>אישור</button>
        <button className="danger" disabled={act.busy} onClick={() => { if (confirm(`לדחות את הבקשה של ${r.full_name}?`)) decide(false); }}>דחייה</button>
      </div>
      <ErrorText error={act.error} />
    </Card>
  );
}
