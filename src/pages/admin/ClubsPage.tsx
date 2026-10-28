import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { normEmail } from '../../lib/email';
import { Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import type { Club } from '../../lib/types';
import { Picture } from '../../components/Picture';

export default function ClubsPage() {
  const { mode } = useParams();
  const { data, loading, error, reload } = useLoad(() => q<Club[]>(supabase.from('clubs').select('id, name, logo_path').order('name')), []);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const act = useAction();

  async function create() {
    const admin = email.trim() ? normEmail(email) : null;
    if (email.trim() && !admin) return act.setError('כתובת המייל של מנהל המועדון לא תקינה');
    await act.run(async () => {
      await rpc('create_club', { p_name: name, p_admin_email: admin });
      setName(''); setEmail(''); reload();
    });
  }

  return (
    <>
      <h2>{mode === 'sysadmin' ? 'מועדונים' : 'המועדון שלי'}</h2>
      <Loading loading={loading} error={error} />
      {data && !data.length && <Empty>אין עדיין מועדונים.</Empty>}
      <ul className="list">
        {data?.map((c) => (
          <li key={c.id} className="row"><Picture bucket="club-media" path={c.logo_path} name={c.name} size={40} square /><Link to={`../club/${c.id}`}>{c.name}</Link></li>
        ))}
      </ul>
      {mode === 'sysadmin' && (
        <Card title="מועדון חדש">
          <Field label="שם המועדון"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="מייל מנהל המועדון (לא חובה)"><input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
          <ErrorText error={act.error} />
          <button disabled={!name.trim() || act.busy} onClick={create}>יצירת מועדון</button>
        </Card>
      )}
    </>
  );
}
