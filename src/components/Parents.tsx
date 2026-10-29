import { useState } from 'react';
import { rpc, useAction, useLoad } from '../lib/db';
import { normEmail } from '../lib/email';
import { Badge, Empty, ErrorText, Field } from './ui';
import { Picture } from './Picture';
import { LookupSelect, useLookupName } from './Lookups';
import { ContactLinks, fmtPhone } from './Contacts';

/** A parent of a child: a linked account (id = profile) or a contact without an account (id = contact row). */
export interface ParentRow {
  kind: 'account' | 'contact'; id: string; full_name: string; avatar_path?: string | null;
  relation_id: string | null; phone: string | null; email: string | null;
}

interface Form { full_name: string; relation_id: string | null; phone: string; email: string }
const toForm = (p?: ParentRow): Form => ({
  full_name: p?.full_name ?? '', relation_id: p?.relation_id ?? null, phone: p?.phone ? fmtPhone(p.phone) : '', email: p?.email ?? '',
});

function ParentForm({ value, onChange, emailLocked }: { value: Form; onChange: (f: Form) => void; emailLocked?: boolean }) {
  return (
    <div className="parent-form">
      <Field label="שם מלא"><input value={value.full_name} onChange={(e) => onChange({ ...value, full_name: e.target.value })} /></Field>
      <label className="field"><span>קרבה לילד</span>
        <LookupSelect domain="guardian_relation" value={value.relation_id} onChange={(v) => onChange({ ...value, relation_id: v })} empty="בחרו…" />
      </label>
      <Field label="טלפון"><input type="tel" dir="ltr" inputMode="tel" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="050-1234567" /></Field>
      {emailLocked
        ? <small className="muted">מייל: <bdi>{value.email}</bdi> (כתובת הכניסה של ההורה, לא ניתנת לשינוי)</small>
        : <Field label="מייל"><input type="email" dir="ltr" value={value.email} onChange={(e) => onChange({ ...value, email: e.target.value })} placeholder="name@example.com" /></Field>}
    </div>
  );
}

/**
 * A child's parents with relation and contact details. Staff (canManage) edit everyone and unlink parent accounts;
 * a parent edits their own relation and the contacts they or others added, and adds the second parent.
 * Adding with an email of an existing account links that parent at once; otherwise a contact is kept, and
 * signing in with that email later links it.
 */
export function ParentsEditor({ playerId, canManage, canAdd, myId, onChanged }: {
  playerId: string; canManage: boolean; canAdd: boolean; myId?: string; onChanged?: () => void;
}) {
  const { data, error, reload } = useLoad(() => rpc<ParentRow[]>('player_parents', { p_player: playerId }), [playerId]);
  const relationName = useLookupName('guardian_relation');
  const act = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(toForm());
  const [adding, setAdding] = useState(false);
  const done = () => { setEditing(null); setAdding(false); reload(); onChanged?.(); };
  const badEmail = !!form.email.trim() && !normEmail(form.email);

  const save = (p: ParentRow) => act.run(async () => {
    if (p.kind === 'contact') {
      await rpc('update_guardian_contact', { p_id: p.id, p_full_name: form.full_name, p_relation: form.relation_id, p_phone: form.phone.trim() || null, p_email: form.email.trim() || null });
    } else {
      if (canManage) await rpc('update_parent_profile', { p_parent: p.id, p_full_name: form.full_name, p_phone: form.phone.trim() || null });
      if (form.relation_id !== p.relation_id) await rpc('set_guardian_relation', { p_player: playerId, p_parent: p.id, p_relation: form.relation_id });
    }
    done();
  });
  const remove = (p: ParentRow) => {
    if (!confirm(p.kind === 'account' ? `לנתק את ${p.full_name} מהילד? החשבון של ההורה נשאר.` : `למחוק את ${p.full_name} מרשימת ההורים של הילד?`)) return;
    act.run(async () => {
      if (p.kind === 'account') await rpc('unlink_guardian', { p_player: playerId, p_parent: p.id });
      else await rpc('remove_guardian_contact', { p_id: p.id });
      done();
    });
  };
  const add = () => act.run(async () => {
    await rpc('add_guardian', { p_player: playerId, p_full_name: form.full_name, p_relation: form.relation_id, p_phone: form.phone.trim() || null, p_email: form.email.trim() || null });
    done();
  });

  return (
    <div className="parents">
      <ErrorText error={error} />
      {data && !data.length && <Empty>אין הורים מקושרים.</Empty>}
      <ul className="list compact contacts">
        {data?.map((p) => {
          const mine = p.kind === 'account' && p.id === myId;
          const canEdit = canManage || p.kind === 'contact' || mine;
          return (
            <li key={p.id} className="contact">
              <Picture bucket="avatars" path={p.avatar_path ?? null} name={p.full_name || '?'} size={32} />
              <div className="grow">
                <div className="row wrap">
                  <strong>{p.full_name || 'הורה'}{mine ? ' (אני)' : ''}</strong>
                  {p.relation_id && <Badge>{relationName(p.relation_id)}</Badge>}
                  {p.kind === 'contact' && <small className="muted">{p.email ? 'טרם נכנס/ה לאפליקציה' : 'ללא חשבון'}</small>}
                </div>
                {editing === p.id ? (
                  <>
                    {p.kind === 'account' && !canManage
                      ? (
                        <label className="field"><span>הקרבה שלי לילד</span>
                          <LookupSelect domain="guardian_relation" value={form.relation_id} onChange={(v) => setForm({ ...form, relation_id: v })} empty="בחרו…" />
                        </label>
                      )
                      : <ParentForm value={form} onChange={setForm} emailLocked={p.kind === 'account'} />}
                    <div className="row">
                      <button className="small" disabled={!form.full_name.trim() || badEmail || act.busy} onClick={() => save(p)}>שמירה</button>
                      <button className="small secondary" onClick={() => setEditing(null)}>ביטול</button>
                    </div>
                  </>
                ) : (
                  <>
                    <ContactLinks phone={p.phone} email={p.email} />
                    {canEdit && (
                      <div className="row parent-actions">
                        {canEdit && <button className="small secondary" onClick={() => { setEditing(p.id); setAdding(false); setForm(toForm(p)); }}>עריכה</button>}
                        {(canManage || p.kind === 'contact') && (
                          <button className="small danger" disabled={act.busy} onClick={() => remove(p)}>{p.kind === 'account' ? 'ניתוק מהילד' : 'מחיקה'}</button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {canAdd && (adding ? (
        <div className="stack add-parent">
          <strong>הוספת הורה</strong>
          <ParentForm value={form} onChange={setForm} />
          <small className="muted">עם מייל, ההורה יוכל להיכנס לאפליקציה ויקושר לילד אוטומטית.</small>
          {badEmail && <p className="error">כתובת מייל לא תקינה</p>}
          <div className="row">
            <button className="small" disabled={!form.full_name.trim() || badEmail || act.busy} onClick={add}>הוספה</button>
            <button className="small secondary" onClick={() => setAdding(false)}>ביטול</button>
          </div>
        </div>
      ) : <button className="small secondary" onClick={() => { setAdding(true); setEditing(null); setForm(toForm()); }}>+ הוספת הורה</button>)}
      <ErrorText error={act.error} />
    </div>
  );
}
