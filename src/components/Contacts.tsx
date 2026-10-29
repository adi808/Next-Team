import { supabase } from '../lib/supabase';
import { q, rpc, useLoad } from '../lib/db';
import { Badge, Card, Empty, Loading } from './ui';
import { Picture } from './Picture';
import { useLookupName } from './Lookups';
import type { Club } from '../lib/types';

interface ContactRow {
  kind: 'admin' | 'staff' | 'parent' | 'player';
  person_id: string; full_name: string; avatar_path: string | null; email: string | null; phone: string | null;
  staff_role_id: string | null; note: string | null;
}

/** Phones are stored as +972…; shown the local way (050-1234567, 04-6001234). */
export function fmtPhone(p: string) {
  const local = p.startsWith('+972') ? `0${p.slice(4)}` : p;
  if (/^05\d{8}$|^07\d{8}$/.test(local)) return `${local.slice(0, 3)}-${local.slice(3)}`;
  if (/^0\d{8}$/.test(local)) return `${local.slice(0, 2)}-${local.slice(2)}`;
  return local;
}

/** Call, WhatsApp and email buttons for whatever details exist. */
export function ContactLinks({ phone, email }: { phone?: string | null; email?: string | null }) {
  if (!phone && !email) return <small className="muted">אין פרטי קשר</small>;
  const digits = phone?.replace(/\D/g, '');
  return (
    <span className="contact-links">
      {phone && <a href={`tel:${phone}`} aria-label={`חיוג ${fmtPhone(phone)}`} dir="ltr">📞 {fmtPhone(phone)}</a>}
      {phone && <a href={`https://wa.me/${digits}`} target="_blank" rel="noreferrer">וואטסאפ</a>}
      {email && <a href={`mailto:${email}`} dir="ltr">✉️ {email}</a>}
    </span>
  );
}

function Person({ c, label }: { c: ContactRow; label?: string }) {
  return (
    <li className="contact">
      {c.kind !== 'player' && <Picture bucket="avatars" path={c.avatar_path} name={c.full_name || '?'} size={36} />}
      <div className="grow">
        <div className="row"><strong>{c.full_name || 'ללא שם'}</strong>{label && <Badge>{label}</Badge>}</div>
        {c.note && <small className="muted">{c.kind === 'parent' ? `הורה של ${c.note}` : c.note}</small>}
        <ContactLinks phone={c.phone} email={c.email} />
      </div>
    </li>
  );
}

/** The team's contact list: the club, its admins, the staff, the parents and the players. Every member sees it. */
export function TeamContacts({ teamId, clubId }: { teamId: string; clubId: string }) {
  const { data, loading, error } = useLoad(async () => {
    const [club, rows] = await Promise.all([
      q<Club>(supabase.from('clubs').select('id, name, logo_path, phone, email, address, website').eq('id', clubId).single()),
      rpc<ContactRow[]>('team_contacts', { p_team: teamId }),
    ]);
    return { club, rows };
  }, [teamId, clubId]);
  const roleName = useLookupName('staff_role');
  if (!data) return <Loading loading={loading} error={error} />;
  const { club, rows } = data;
  const of = (k: ContactRow['kind']) => rows.filter((r) => r.kind === k);
  const section = (title: string, list: ContactRow[], label?: (c: ContactRow) => string | undefined, empty?: string) => (
    <Card title={title}>
      {!list.length && <Empty>{empty ?? 'אין עדיין.'}</Empty>}
      <ul className="list compact contacts">{list.map((c) => <Person key={c.person_id} c={c} label={label?.(c)} />)}</ul>
    </Card>
  );
  return (
    <>
      <Card title={`המועדון: ${club.name}`}>
        <ContactLinks phone={club.phone} email={club.email} />
        {club.address && <p className="muted contact-extra">📍 {club.address}</p>}
        {club.website && <p className="contact-extra"><a href={/^https?:\/\//.test(club.website) ? club.website : `https://${club.website}`} target="_blank" rel="noreferrer" dir="ltr">{club.website}</a></p>}
      </Card>
      {section('צוות מקצועי', of('staff'), (c) => roleName(c.staff_role_id) || 'מאמן', 'עדיין אין אנשי צוות בקבוצה.')}
      {of('admin').length > 0 && section('הנהלת המועדון', of('admin'), () => 'מנהל מועדון')}
      {section('הורים', of('parent'), undefined, 'עדיין אין הורים מחוברים.')}
      {section('שחקנים', of('player'), undefined, 'אין שחקנים בקבוצה.')}
    </>
  );
}
