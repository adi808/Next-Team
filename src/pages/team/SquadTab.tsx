import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, ageOf } from '../../lib/db';
import { toE164 } from '../../lib/phone';
import { Card, Empty, ErrorText, Field } from '../../components/ui';
import { PlayerAvatar, useNames } from '../../components/People';
import type { TeamTabProps } from './TeamPage';

interface Pending { id: string; parent_id: string; player_id: string }

export default function SquadTab({ team, players, canManage, reload }: TeamTabProps) {
  const [name, setName] = useState('');
  const [birth, setBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const act = useAction();
  const ids = players.map((p) => p.id);
  const pending = useLoad(
    () => (ids.length && canManage
      ? q<Pending[]>(supabase.from('guardianships').select('id, parent_id, player_id').eq('status', 'pending').in('player_id', ids))
      : Promise.resolve<Pending[]>([])),
    [ids.join(','), canManage],
  );
  const names = useNames((pending.data ?? []).map((p) => p.parent_id));
  const playerName = (id: string) => players.find((p) => p.id === id)?.full_name ?? '';

  async function add() {
    const pPhone = phone.trim() ? toE164(phone) : null;
    const parent = parentPhone.trim() ? toE164(parentPhone) : null;
    if ((phone.trim() && !pPhone) || (parentPhone.trim() && !parent)) return act.setError('מספר טלפון לא תקין');
    await act.run(async () => {
      await rpc('add_player', { p_team: team.id, p_full_name: name, p_birth_date: birth, p_phone: pPhone, p_parent_phone: parent });
      setName(''); setBirth(''); setPhone(''); setParentPhone(''); reload();
    });
  }

  return (
    <>
      {!players.length && <Empty>אין עדיין שחקנים בקבוצה.</Empty>}
      <ul className="list">
        {players.map((p) => (
          <li key={p.id} className="row">
            <PlayerAvatar player={p} />
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
              <span>{names(r.parent_id)} ← {playerName(r.player_id)}</span>
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
          <Field label="טלפון של ההורה (לא חובה)"><input type="tel" dir="ltr" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="050-0000000" /></Field>
          <Field label="טלפון של השחקן, אם יש לו (לא חובה)"><input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <p className="muted">ילד בלי טלפון מנוהל על ידי ההורה. הורה שמוזמן כאן מקבל גישה מיד, בלי צורך באישור נוסף.</p>
          <ErrorText error={act.error} />
          <button disabled={!name.trim() || !birth || act.busy} onClick={add}>הוספה</button>
        </Card>
      )}
    </>
  );
}
