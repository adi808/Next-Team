import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, ageOf } from '../../lib/db';
import { normEmail } from '../../lib/email';
import { Card, Empty, ErrorText, Field } from '../../components/ui';
import { PersonAvatar, PlayerAvatar, ShirtNo, useNames, useShirtNumbers } from '../../components/People';
import type { TeamTabProps } from './TeamPage';

interface Pending { id: string; parent_id: string; player_id: string }

export default function SquadTab({ team, players, canManage, reload }: TeamTabProps) {
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [email, setEmail] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const act = useAction();
  const ids = players.map((p) => p.id);
  const pending = useLoad(
    () => (ids.length && canManage
      ? q<Pending[]>(supabase.from('guardianships').select('id, parent_id, player_id').eq('status', 'pending').in('player_id', ids))
      : Promise.resolve<Pending[]>([])),
    [ids.join(','), canManage],
  );
  const shirt = useShirtNumbers(ids);
  const names = useNames((pending.data ?? []).map((p) => p.parent_id));
  const playerName = (id: string) => players.find((p) => p.id === id)?.full_name ?? '';

  async function add() {
    const pEmail = email.trim() ? normEmail(email) : null;
    const parent = parentEmail.trim() ? normEmail(parentEmail) : null;
    if ((email.trim() && !pEmail) || (parentEmail.trim() && !parent)) return act.setError('כתובת מייל לא תקינה');
    await act.run(async () => {
      await rpc('add_player', { p_team: team.id, p_full_name: name, p_birth_date: birth, p_email: pEmail, p_parent_email: parent });
      setName(''); setBirth(''); setEmail(''); setParentEmail(''); reload();
    });
  }

  return (
    <>
      {!players.length && <Empty>אין עדיין שחקנים בקבוצה.</Empty>}
      <ul className="list">
        {players.map((p) => (
          <li key={p.id} className="row">
            <PlayerAvatar player={p} />
            <ShirtNo n={shirt(p.id)} />
            <Link to={`../player/${p.id}`}>{p.full_name}</Link>
            {p.birth_date && <small className="muted">גיל {ageOf(p.birth_date)}</small>}
            {canManage && (
              <button className="small secondary" disabled={act.busy}
                onClick={() => { if (confirm(`להסיר את ${p.full_name} מהקבוצה?`)) act.run(async () => { await rpc('remove_player_from_team', { p_team: team.id, p_player: p.id }); reload(); }); }}>
                הסרה
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && !!pending.data?.length && (
        <Card title="בקשות קישור הורה־ילד">
          {pending.data.map((r) => (
            <div key={r.id} className="row">
              <PersonAvatar id={r.parent_id} /><span>{names(r.parent_id)} ← {playerName(r.player_id)}</span>
              <button className="small" onClick={() => act.run(async () => { await rpc('respond_guardianship', { p_id: r.id, p_approve: true }); pending.reload(); })}>אישור</button>
              <button className="small secondary" onClick={() => act.run(async () => { await rpc('respond_guardianship', { p_id: r.id, p_approve: false }); pending.reload(); })}>דחייה</button>
            </div>
          ))}
        </Card>
      )}

      {canManage && (
        <Card title="הוספת שחקן">
          <Field label="שם מלא"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="תאריך לידה (חובה)"><input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} /></Field>
          <Field label="מייל של ההורה (לא חובה)"><input type="email" dir="ltr" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="name@example.com" /></Field>
          <Field label="מייל של השחקן, אם יש לו (לא חובה)"><input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <p className="muted">ילד בלי מייל מנוהל על ידי ההורה. הורה שמוזמן כאן מקבל גישה מיד, בלי צורך באישור נוסף.</p>
          <ErrorText error={act.error} />
          <button disabled={!name.trim() || !birth || act.busy} onClick={add}>הוספה</button>
        </Card>
      )}
    </>
  );
}
