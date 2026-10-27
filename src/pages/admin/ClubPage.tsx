import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { toE164 } from '../../lib/phone';
import { Card, Empty, ErrorText, Field, Loading, Tabs } from '../../components/ui';
import { DefCreator, DefList } from '../../components/Attributes';
import { useSports } from '../../components/Lookups';
import type { Club, Team } from '../../lib/types';

export default function ClubPage() {
  const { clubId = '' } = useParams();
  const sports = useSports();
  const { data, loading, error, reload } = useLoad(async () => {
    const [club, teams] = await Promise.all([
      q<Club>(supabase.from('clubs').select('id, name').eq('id', clubId).single()),
      q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id').eq('club_id', clubId).order('name')),
    ]);
    return { club, teams };
  }, [clubId]);

  const [teamName, setTeamName] = useState('');
  const [sportId, setSportId] = useState('');
  const [phone, setPhone] = useState('');
  const [staffTeam, setStaffTeam] = useState('');
  const act = useAction();
  const sportName = (id: string) => sports.find((s) => s.id === id)?.name_he ?? '';

  async function createTeam() {
    await act.run(async () => {
      await rpc('create_team', { p_club: clubId, p_name: teamName, p_sport: sportId });
      setTeamName(''); reload();
    });
  }
  async function inviteStaff() {
    const e164 = toE164(phone);
    if (!e164) return act.setError('מספר טלפון לא תקין');
    await act.run(async () => {
      await rpc('invite_by_phone', { p_phone: e164, p_club: clubId, p_team: staffTeam || null, p_role: staffTeam ? 'coach' : 'club_admin' });
      setPhone('');
    });
  }

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  return (
    <>
      <h2>{data.club.name}</h2>
      <Tabs tabs={[
        {
          id: 'teams', label: 'קבוצות', render: () => (
            <>
              {!data.teams.length && <Empty>אין עדיין קבוצות.</Empty>}
              <ul className="list">
                {data.teams.map((t) => (
                  <li key={t.id}><Link to={`../team/${t.id}`}>{t.name}</Link> <small className="muted">{sportName(t.sport_id)}</small></li>
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
              <p className="muted">ההזמנה לפי מספר טלפון. מי שכבר רשום מצטרף מיד, ואחרת בכניסתו הראשונה.</p>
              <Field label="טלפון"><input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" /></Field>
              <Field label="תפקיד">
                <select value={staffTeam} onChange={(e) => setStaffTeam(e.target.value)}>
                  <option value="">מנהל מועדון</option>
                  {data.teams.map((t) => <option key={t.id} value={t.id}>מאמן של {t.name}</option>)}
                </select>
              </Field>
              <ErrorText error={act.error} />
              <button disabled={!phone.trim() || act.busy} onClick={inviteStaff}>הזמנה</button>
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
