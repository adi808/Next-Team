import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { mutateOne, q, rpc, useAction, useLoad } from '../../lib/db';
import { normEmail } from '../../lib/email';
import { Card, Empty, ErrorText, Field, Loading, Tabs } from '../../components/ui';
import { DefCreator, DefList } from '../../components/Attributes';
import { useSports } from '../../components/Lookups';
import { useAuth } from '../../auth/AuthProvider';
import type { Club, Team } from '../../lib/types';

export default function ClubPage() {
  const { clubId = '' } = useParams();
  const sports = useSports();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoad(async () => {
    const [club, teams] = await Promise.all([
      q<Club>(supabase.from('clubs').select('id, name').eq('id', clubId).single()),
      q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id').eq('club_id', clubId).order('name')),
    ]);
    return { club, teams };
  }, [clubId]);

  const [teamName, setTeamName] = useState('');
  const [sportId, setSportId] = useState('');
  const [email, setEmail] = useState('');
  const [staffTeam, setStaffTeam] = useState('');
  const [editClub, setEditClub] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState<{ id: string; name: string; sport: string } | null>(null);
  const act = useAction();
  const sportName = (id: string) => sports.find((s) => s.id === id)?.name_he ?? '';

  async function createTeam() {
    await act.run(async () => {
      await rpc('create_team', { p_club: clubId, p_name: teamName, p_sport: sportId });
      setTeamName(''); reload();
    });
  }
  async function inviteStaff() {
    const addr = normEmail(email);
    if (!addr) return act.setError('כתובת מייל לא תקינה');
    await act.run(async () => {
      await rpc('invite_by_email', { p_email: addr, p_club: clubId, p_team: staffTeam || null, p_role: staffTeam ? 'coach' : 'club_admin' });
      setEmail('');
    });
  }

  async function saveClub() {
    await act.run(async () => {
      await mutateOne(supabase.from('clubs').update({ name: editClub?.trim() }).eq('id', clubId).select('id'));
      setEditClub(null); reload();
    });
  }
  async function deleteClub() {
    if (!data || !window.confirm(`למחוק את המועדון "${data.club.name}"? יימחקו גם כל הקבוצות, השחקנים, האירועים וההודעות שלו. אי אפשר לבטל.`)) return;
    await act.run(async () => {
      await mutateOne(supabase.from('clubs').delete().eq('id', clubId).select('id'));
      navigate('../clubs');
    });
  }
  async function saveTeam() {
    if (!editTeam) return;
    await act.run(async () => {
      await mutateOne(supabase.from('teams').update({ name: editTeam.name.trim(), sport_id: editTeam.sport }).eq('id', editTeam.id).select('id'));
      setEditTeam(null); reload();
    });
  }
  async function deleteTeam(t: Team) {
    if (!window.confirm(`למחוק את הקבוצה "${t.name}"? יימחקו גם האירועים, המשימות, הסקרים וההודעות שלה. השחקנים נשארים במועדון.`)) return;
    await act.run(async () => {
      await mutateOne(supabase.from('teams').delete().eq('id', t.id).select('id'));
      reload();
    });
  }

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  return (
    <>
      {editClub === null ? (
        <div className="title-row">
          <h2>{data.club.name}</h2>
          <button className="small secondary" onClick={() => setEditClub(data.club.name)}>עריכה</button>
          {profile?.is_system_admin && <button className="small danger" disabled={act.busy} onClick={deleteClub}>מחיקת מועדון</button>}
        </div>
      ) : (
        <Card title="עריכת המועדון">
          <Field label="שם המועדון"><input value={editClub} onChange={(e) => setEditClub(e.target.value)} /></Field>
          <ErrorText error={act.error} />
          <div className="row">
            <button disabled={!editClub.trim() || act.busy} onClick={saveClub}>שמירה</button>
            <button className="secondary" onClick={() => setEditClub(null)}>ביטול</button>
          </div>
        </Card>
      )}
      <Tabs tabs={[
        {
          id: 'teams', label: 'קבוצות', render: () => (
            <>
              {!data.teams.length && <Empty>אין עדיין קבוצות.</Empty>}
              <ul className="list">
                {data.teams.map((t) => editTeam?.id === t.id ? (
                  <li key={t.id} className="stack">
                    <Field label="שם הקבוצה"><input value={editTeam.name} onChange={(e) => setEditTeam({ ...editTeam, name: e.target.value })} /></Field>
                    <Field label="ענף">
                      <select value={editTeam.sport} onChange={(e) => setEditTeam({ ...editTeam, sport: e.target.value })}>
                        {sports.map((s) => <option key={s.id} value={s.id}>{s.name_he}</option>)}
                      </select>
                    </Field>
                    <div className="row">
                      <button className="small" disabled={!editTeam.name.trim() || act.busy} onClick={saveTeam}>שמירה</button>
                      <button className="small secondary" onClick={() => setEditTeam(null)}>ביטול</button>
                    </div>
                  </li>
                ) : (
                  <li key={t.id} className="row">
                    <Link to={`../team/${t.id}`}>{t.name}</Link> <small className="muted">{sportName(t.sport_id)}</small>
                    <span className="grow" />
                    <button className="small secondary" onClick={() => setEditTeam({ id: t.id, name: t.name, sport: t.sport_id })}>עריכה</button>
                    <button className="small danger" disabled={act.busy} onClick={() => deleteTeam(t)}>מחיקה</button>
                  </li>
                ))}
              </ul>
              <Card title="קבוצה חדשה">
                <Field label="שם הקבוצה"><input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></Field>
                <Field label="ענף">
                  <select value={sportId} onChange={(e) => setSportId(e.target.value)}>
                    <option value="">בחרו ענף…</option>
                    {sports.map((s) => <option key={s.id} value={s.id}>{s.name_he}</option>)}
                  </select>
                </Field>
                <ErrorText error={act.error} />
                <button disabled={!teamName.trim() || !sportId || act.busy} onClick={createTeam}>יצירת קבוצה</button>
              </Card>
            </>
          ),
        },
        {
          id: 'staff', label: 'צוות', render: () => (
            <Card title="הזמנת מאמן או מנהל מועדון">
              <p className="muted">ההזמנה לפי כתובת מייל. מי שכבר רשום מצטרף מיד, ואחרת בכניסתו הראשונה.</p>
              <Field label="מייל"><input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
              <Field label="תפקיד">
                <select value={staffTeam} onChange={(e) => setStaffTeam(e.target.value)}>
                  <option value="">מנהל מועדון</option>
                  {data.teams.map((t) => <option key={t.id} value={t.id}>מאמן של {t.name}</option>)}
                </select>
              </Field>
              <ErrorText error={act.error} />
              <button disabled={!email.trim() || act.busy} onClick={inviteStaff}>הזמנה</button>
            </Card>
          ),
        },
        {
          id: 'params', label: 'פרמטרים לשחקנים', render: () => (
            <>
              <p className="muted">פרמטרים שיחולו על כל שחקני המועדון (למשל דירוגים מקצועיים). מאמן יכול להוסיף גם פרמטרים לקבוצה שלו.</p>
              <DefList scope="player" clubId={clubId} onChanged={reload} />
              <Card title="פרמטר חדש">
                <DefCreator scope="player" clubId={clubId} onCreated={reload} />
              </Card>
            </>
          ),
        },
      ]} />
    </>
  );
}
