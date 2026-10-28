import { useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { rpc, useAction } from '../../lib/db';
import { Card, ErrorText, Field, PageHero } from '../../components/ui';
import { clearLookupCache, useLookups, useSports } from '../../components/Lookups';
import type { Lookup } from '../../lib/types';

const DOMAINS: { id: string; label: string; hint: string }[] = [
  { id: 'event_type', label: 'סוגי אירוע', hint: 'אימון, משחק, גיבוש…' },
  { id: 'absence_reason', label: 'סיבות אי הגעה', hint: 'מחלה, חופשה…' },
  { id: 'match_format', label: 'מספר שחקנים במגרש', hint: '11 על 11, 9 על 9…' },
  { id: 'formation', label: 'מערכים', hint: '4-3-3, 4-4-2… (שייכים למספר שחקנים)' },
  { id: 'stat_type', label: 'סוגי סטטיסטיקה', hint: 'שער, בישול, כרטיס…' },
  { id: 'position', label: 'תפקידים', hint: 'הגנה, קישור, התקפה… (לכל ענף)' },
  { id: 'player_kind', label: 'שחקן שדה / שוער', hint: 'לכל ענף' },
  { id: 'equipment', label: 'מה להביא לאירוע', hint: 'מים, נעליים, מגני שוקיים…' },
];

/** One screen manages every list in the system (they all live in the lookups table). */
export default function ListsPage() {
  const { profile, adminClubIds } = useAuth();
  const acting = useActingRole();
  const [domain, setDomain] = useState(DOMAINS[0].id);
  const [tick, setTick] = useState(0);
  const sports = useSports();
  const items = useLookups(domain, { includeInactive: true });
  const formats = useLookups('match_format');
  const [name, setName] = useState('');
  const [sportId, setSportId] = useState('');
  const [parentId, setParentId] = useState('');
  const act = useAction();
  const isSys = acting === 'system_admin' && !!profile?.is_system_admin;
  const clubId = isSys ? null : adminClubIds[0] ?? null;
  const canEdit = (l: Lookup) => (isSys ? true : l.club_id !== null && l.club_id === clubId);

  const slugify = (s: string) => `${s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'v'}_${Date.now().toString(36)}`;

  async function add() {
    await act.run(async () => {
      await rpc('upsert_lookup', {
        p_id: null, p_domain: domain, p_slug: slugify(name), p_name_he: name.trim(),
        p_parent: domain === 'formation' && parentId ? parentId : null, p_sport: sportId || null,
        p_club: clubId, p_sort: items.length + 1,
        p_meta: domain === 'event_type' ? {} : {},
      });
      clearLookupCache(); setName(''); setTick((t) => t + 1);
    });
  }
  async function toggle(l: Lookup) {
    await act.run(async () => {
      await rpc('upsert_lookup', {
        p_id: l.id, p_domain: l.domain, p_slug: l.slug, p_name_he: l.name_he, p_icon_path: l.icon_path,
        p_parent: l.parent_id, p_sport: l.sport_id, p_club: l.club_id, p_sort: l.sort_order, p_meta: l.meta, p_active: !l.active,
      });
      clearLookupCache(); setTick((t) => t + 1);
    });
  }
  const sportName = (id: string | null) => sports.find((s) => s.id === id)?.name_he;
  const parentName = (id: string | null) => formats.find((f) => f.id === id)?.name_he;

  return (
    <>
      <PageHero kicker="הגדרות" title="רשימות" />
      <p className="muted">כל הרשימות בממשק (סוגי אירוע, סיבות, מערכים…) מנוהלות כאן. הוספת ערך לא דורשת שינוי קוד.</p>
      <div className="tabs">
        {DOMAINS.map((d) => (
          <button key={d.id} aria-selected={d.id === domain} onClick={() => setDomain(d.id)}>{d.label}</button>
        ))}
      </div>
      <small className="muted">{DOMAINS.find((d) => d.id === domain)?.hint}</small>
      <ul className="list" key={tick}>
        {items.map((l) => (
          <li key={l.id} className="row">
            <span className={l.active ? '' : 'muted'}>{l.name_he}</span>
            <small className="muted">{[sportName(l.sport_id), parentName(l.parent_id), l.club_id ? 'של המועדון' : 'כללי'].filter(Boolean).join(' · ')}</small>
            {canEdit(l) && <button className="small" disabled={act.busy} onClick={() => toggle(l)}>{l.active ? 'הסתרה' : 'הצגה'}</button>}
          </li>
        ))}
      </ul>
      <Card title="ערך חדש">
        <Field label="שם"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {domain !== 'event_type' && domain !== 'absence_reason' && (
          <Field label="ענף">
            <select value={sportId} onChange={(e) => setSportId(e.target.value)}>
              <option value="">כל הענפים</option>
              {sports.map((s) => <option key={s.id} value={s.id}>{s.name_he}</option>)}
            </select>
          </Field>
        )}
        {domain === 'formation' && (
          <Field label="שייך למספר שחקנים">
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">בחרו…</option>
              {formats.map((f) => <option key={f.id} value={f.id}>{f.name_he} ({sportName(f.sport_id)})</option>)}
            </select>
          </Field>
        )}
        <ErrorText error={act.error} />
        <button disabled={!name.trim() || (domain === 'formation' && !parentId) || act.busy} onClick={add}>הוספה</button>
        {!isSys && !clubId && <p className="muted">רק מנהל מועדון או מנהל מערכת יכולים להוסיף ערכים.</p>}
      </Card>
    </>
  );
}
