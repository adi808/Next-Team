import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { toE164 } from '../../lib/phone';
import { Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import type { Club } from '../../lib/types';

export default function ClubsPage() {
  const { mode } = useParams();
  const { data, loading, error, reload } = useLoad(() => q<Club[]>(supabase.from('clubs').select('id, name').order('name')), []);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const act = useAction();

  async function create() {
    const admin = phone.trim() ? toE164(phone) : null;
    if (phone.trim() && !admin) return act.setError('מספר הטלפון של מנהל המועדון לא תקין');
    await act.run(async () => {
      await rpc('create_club', { p_name: name, p_admin_phone: admin });
      setName(''); setPhone(''); reload();
    });
  }

  return (
    <>
      <h2>{mode === 'sysadmin' ? 'מועדונים' : 'המועדון שלי'}</h2>
      <Loading loading={loading} error={error} />
      {data && !data.length && <Empty>אין עדיין מועדונים.</Empty>}
      <ul className="list">
        {data?.map((c) => (
          <li key={c.id}><Link to={`../club/${c.id}`}>{c.name}</Link></li>
        ))}
      </ul>
      {mode === 'sysadmin' && (
        <Card title="מועדון חדש">
          <Field label="שם המועדון"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="טלפון מנהל המועדון (לא חובה)"><input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-0000000" /></Field>
          <ErrorText error={act.error} />
          <button disabled={!name.trim() || act.busy} onClick={create}>יצירת מועדון</button>
        </Card>
      )}
    </>
  );
}
