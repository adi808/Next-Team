import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rpc, useAction, useLoad, fmtDay } from '../lib/db';
import { Card, Empty, ErrorText, Field, Loading } from './ui';
import { useLookupName } from './Lookups';
import { fmtPhone } from './Contacts';
import { ParentsEditor, type ParentRow } from './Parents';
import type { Team } from '../lib/types';

interface RosterRow {
  player_id: string; full_name: string; birth_date: string; phone: string | null; email: string | null;
  team_ids: string[]; team_names: string; parents: ParentRow[];
}

/** The roster as a CSV file Excel opens (UTF-8 with BOM, so Hebrew shows correctly). */
function exportCsv(rows: RosterRow[], relationName: (id: string | null) => string, name: string) {
  const most = Math.max(1, ...rows.map((r) => r.parents.length));
  const head = ['שם הילד', 'תאריך לידה', 'קבוצה', 'טלפון הילד', 'מייל הילד'];
  for (let n = 1; n <= most; n++) head.push(`הורה ${n}`, `קרבה ${n}`, `טלפון הורה ${n}`, `מייל הורה ${n}`);
  const lines = rows.map((r) => {
    const cells = [r.full_name, fmtDay(r.birth_date), r.team_names, r.phone ? fmtPhone(r.phone) : '', r.email ?? ''];
    for (let n = 0; n < most; n++) {
      const p = r.parents[n];
      cells.push(p?.full_name ?? '', p ? relationName(p.relation_id) : '', p?.phone ? fmtPhone(p.phone) : '', p?.email ?? '');
    }
    return cells;
  });
  const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${name}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ParentCell({ p, relationName }: { p?: ParentRow; relationName: (id: string | null) => string }) {
  if (!p) return <td className="muted">—</td>;
  return (
    <td>
      <strong>{p.full_name}</strong>{p.relation_id ? <small className="muted"> · {relationName(p.relation_id)}</small> : null}
      {p.phone && <a className="cell-line" href={`tel:${p.phone}`} dir="ltr">{fmtPhone(p.phone)}</a>}
      {p.email && <a className="cell-line email" href={`mailto:${p.email}`} dir="ltr">{p.email}</a>}
    </td>
  );
}

/** Editing one child from the roster: name, birth date and phone, the parents, and (club admin) deleting the child. */
function RowEditor({ row, isClubAdmin, onChanged, onClose }: { row: RosterRow; isClubAdmin: boolean; onChanged: () => void; onClose: () => void }) {
  const [name, setName] = useState(row.full_name);
  const [birth, setBirth] = useState(row.birth_date);
  const [phone, setPhone] = useState(row.phone ? fmtPhone(row.phone) : '');
  const act = useAction();
  const changed = name.trim() !== row.full_name || birth !== row.birth_date || phone.trim() !== (row.phone ? fmtPhone(row.phone) : '');
  const save = () => act.run(async () => {
    await rpc('update_player', { p_player: row.player_id, p_full_name: name, p_birth_date: birth || null });
    if (phone.trim() !== (row.phone ? fmtPhone(row.phone) : '')) await rpc('set_player_phone', { p_player: row.player_id, p_phone: phone.trim() || null });
    onChanged();
  });
  const del = () => {
    if (!confirm(`למחוק את ${row.full_name} מהמועדון? יימחקו גם ההערכות, הסטטיסטיקות, אישורי ההגעה והקישור להורים. אי אפשר לבטל.`)) return;
    act.run(async () => { await rpc('delete_player', { p_player: row.player_id }); onClose(); onChanged(); });
  };
  return (
    <div className="roster-editor">
      <div className="roster-editor-grid">
        <section>
          <h4>פרטי הילד</h4>
          <Field label="שם מלא"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="תאריך לידה"><input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} /></Field>
          <Field label="טלפון של הילד"><input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          {row.email && <small className="muted">מייל הכניסה של הילד: <bdi>{row.email}</bdi></small>}
          <div className="row">
            <button className="small" disabled={!changed || !name.trim() || act.busy} onClick={save}>שמירה</button>
            <Link className="small-link" to={`../player/${row.player_id}`}>לפרופיל המלא ←</Link>
          </div>
        </section>
        <section>
          <h4>הורים</h4>
          <ParentsEditor playerId={row.player_id} canManage canAdd onChanged={onChanged} />
        </section>
      </div>
      <ErrorText error={act.error} />
      <div className="row">
        <button className="small secondary" onClick={onClose}>סגירה</button>
        <span className="grow" />
        {isClubAdmin && <button className="small danger" disabled={act.busy} onClick={del}>מחיקת הילד מהמועדון</button>}
      </div>
    </div>
  );
}

/**
 * Every child with their parents and contact details. Club admins see the whole club and filter by team;
 * a coach sees one team. Edit a row to change the child or the parents; export the filtered table to Excel.
 */
export function Roster({ clubId, teams, teamId, isClubAdmin, title }: {
  clubId: string; teams?: Team[]; teamId?: string; isClubAdmin: boolean; title: string;
}) {
  const [team, setTeam] = useState(teamId ?? '');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, loading, error, reload } = useLoad(
    () => rpc<RosterRow[]>('club_roster', { p_club: clubId, p_team: team || null }), [clubId, team],
  );
  const relationName = useLookupName('guardian_relation');
  const term = search.trim().toLowerCase();
  const rows = (data ?? []).filter((r) => !term || [r.full_name, r.phone, r.email, ...r.parents.flatMap((p) => [p.full_name, p.phone, p.email])]
    .some((x) => x?.toLowerCase().includes(term)));
  const most = Math.max(2, ...rows.map((r) => r.parents.length));
  const openRow = rows.find((r) => r.player_id === open);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [open]);

  return (
    <Card title={title} actions={rows.length > 0 && (
      <button className="small secondary" onClick={() => exportCsv(rows, relationName, title)}>ייצוא לאקסל</button>
    )}>
      <div className="row wrap roster-filters">
        {teams && !teamId && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="סינון לפי קבוצה">
            <option value="">כל הקבוצות</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם, טלפון או מייל" />
      </div>
      <Loading loading={loading && !data} error={error} />
      {data && !rows.length && <Empty>{term ? 'לא נמצאו תוצאות.' : 'אין עדיין ילדים.'}</Empty>}
      {rows.length > 0 && (
        <>
          <small className="muted">{rows.length} ילדים</small>
          <div className="table-scroll">
            <table className="roster">
              <thead>
                <tr>
                  <th>ילד</th>
                  {Array.from({ length: most }, (_, n) => <th key={n}>הורה {n + 1}</th>)}
                  <th>קבוצה</th><th>טלפון / מייל הילד</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.player_id} className={open === r.player_id ? 'open' : ''}>
                    <td><strong>{r.full_name}</strong><small className="cell-line muted">{fmtDay(r.birth_date)}</small></td>
                    {Array.from({ length: most }, (_, n) => <ParentCell key={n} p={r.parents[n]} relationName={relationName} />)}
                    <td>{r.team_names || <span className="muted">—</span>}</td>
                    <td>
                      {r.phone && <a className="cell-line" href={`tel:${r.phone}`} dir="ltr">{fmtPhone(r.phone)}</a>}
                      {r.email && <a className="cell-line email" href={`mailto:${r.email}`} dir="ltr">{r.email}</a>}
                      {!r.phone && !r.email && <span className="muted">—</span>}
                    </td>
                    <td><button className="small secondary" onClick={() => setOpen(open === r.player_id ? null : r.player_id)}>{open === r.player_id ? 'סגירה' : 'עריכה'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {openRow && (
            <div ref={editorRef} className="roster-editor-wrap">
              <h3>עריכה: {openRow.full_name}</h3>
              <RowEditor key={openRow.player_id} row={openRow} isClubAdmin={isClubAdmin} onChanged={reload} onClose={() => setOpen(null)} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
