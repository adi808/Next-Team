import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad } from '../lib/db';
import { Badge, Card, Empty, ErrorText } from './ui';
import { useLookups } from './Lookups';
import { PlayerAvatar, useShirtNumbers } from './People';
import type { AttrDef, AttrValue, EventResponse, EventRow, Lookup, Player } from '../lib/types';

type Role = 'gk' | 'def' | 'mid' | 'fwd';
const ROLE_OF_SLUG: [RegExp, Role][] = [[/goal|gk/, 'gk'], [/def|df/, 'def'], [/mid|mf/, 'mid'], [/forw|fw|att|str/, 'fwd']];
// Formation used when neither the match nor the team sets one, by the number of players on the field.
const FALLBACK: Record<number, number[]> = { 11: [4, 3, 3], 9: [3, 3, 2], 8: [3, 3, 1], 7: [2, 3, 1], 6: [2, 2, 1], 5: [2, 2] };
const MAX_GROUPS = 4;

const roleOf = (l: Lookup | undefined): Role | undefined =>
  !l ? undefined : l.meta?.goalkeeper ? 'gk' : ROLE_OF_SLUG.find(([re]) => re.test(l.slug))?.[1];

/** "4-2-3-1" -> [4, 2, 3, 1] (outfield rows, defence first). */
const rowsOf = (name: string | undefined) => {
  const rows = (name ?? '').split('-').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return rows.length ? rows : null;
};

interface Slot { role: Role; x: number; y: number }

/** Slot 0 is the goalkeeper (bottom), then each row from defence (low) to attack (high), left to right. */
function slotsFor(rows: number[]): Slot[] {
  const slots: Slot[] = [{ role: 'gk', x: 50, y: 90 }];
  rows.forEach((n, r) => {
    const y = rows.length === 1 ? 50 : 72 - (r * 54) / (rows.length - 1);
    const role: Role = rows.length === 1 ? 'mid' : r === 0 ? 'def' : r === rows.length - 1 ? 'fwd' : 'mid';
    for (let i = 0; i < n; i++) slots.push({ role, x: ((i + 1) * 100) / (n + 1), y });
  });
  return slots;
}

/** Fills the empty slots of one group from the candidates: matching role first, then anyone left. Returns who is left. */
function fill(slots: Slot[], group: (string | null)[], candidates: string[], role: (id: string) => Role | undefined): string[] {
  const left = [...candidates];
  const take = (pred: (id: string) => boolean) => {
    const i = left.findIndex(pred);
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  slots.forEach((s, i) => { if (!group[i]) group[i] = take((id) => role(id) === s.role); });
  group.forEach((p, i) => { if (!p && i > 0) group[i] = take((id) => role(id) !== 'gk') ?? take(() => true); });
  if (!group[0]) group[0] = take(() => true);
  return left;
}

/**
 * The suggested lineup of every group:
 * 1. players whose default group is one of the match's groups stand in it, by role - even when they said they
 *    will not come (they stay on the pitch, marked, so the coach sees the gap);
 * 2. players without a group (or whose group does not play) fill the empty places of the groups in order;
 * 3. players whose default is the bench, and whoever is left, sit on the bench.
 */
function autoLineup(slots: Slot[], groups: number, players: string[], role: (id: string) => Role | undefined,
  defaultGroup: (id: string) => number | 'bench' | undefined, absent: (id: string) => boolean): (string | null)[][] {
  const out = Array.from({ length: groups }, () => slots.map(() => null as string | null));
  let free: string[] = [];
  for (let g = 0; g < groups; g++) {
    const mine = players.filter((id) => defaultGroup(id) === g + 1);
    free.push(...fill(slots, out[g], mine, role).filter((id) => !absent(id)));
  }
  free = [...free, ...players.filter((id) => {
    const d = defaultGroup(id);
    return !absent(id) && d !== 'bench' && (d === undefined || d > groups);
  })];
  for (let g = 0; g < groups; g++) free = fill(slots, out[g], free, role);
  return out;
}

type Picked = { g: number; slot: number } | { bench: string };

export function LineupPitch({ event, players, responses }: { event: EventRow; players: Player[]; responses: EventResponse[] }) {
  const formations = useLookups('formation', { includeInactive: true });
  const formats = useLookups('match_format', { includeInactive: true });
  const positions = useLookups('position', { includeInactive: true });
  const kinds = useLookups('player_kind', { includeInactive: true });
  const groupList = useLookups('lineup_group', { includeInactive: true });
  const reasons = useLookups('absence_reason', { includeInactive: true });
  const ids = players.map((p) => p.id);
  const shirt = useShirtNumbers(ids);
  const { data, error, reload } = useLoad(async () => {
    const defs = await q<AttrDef[]>(supabase.from('attribute_defs').select('*')
      .in('key', ['match_format', 'formation', 'position', 'player_kind', 'parallel_groups', 'default_group']).eq('active', true));
    const values = await q<AttrValue[]>(supabase.from('attribute_values').select('*')
      .in('def_id', defs.map((d) => d.id)).in('entity_id', [event.id, ...ids]).order('seq', { ascending: false }));
    const saved = await q<{ group_no: number; slot: number; player_id: string }[]>(
      supabase.from('event_lineups').select('group_no, slot, player_id').eq('event_id', event.id));
    const state = await q<{ approved_at: string }[]>(supabase.from('event_lineup_state').select('approved_at').eq('event_id', event.id));
    const teamFormation = await rpc<unknown>('team_param', { p_team: event.team_id, p_key: 'default_formation' });
    const teamGroups = await rpc<unknown>('team_param', { p_team: event.team_id, p_key: 'parallel_groups' });
    return {
      defs, values, saved, approved: state.length > 0,
      teamFormation: typeof teamFormation === 'string' ? teamFormation : null,
      teamGroups: typeof teamGroups === 'number' ? teamGroups : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, ids.join(',')]);

  const latest = (key: string, scope: AttrDef['scope'], entity: string) => {
    const defIds = new Set(data?.defs.filter((d) => d.key === key && d.scope === scope).map((d) => d.id));
    return data?.values.find((v) => defIds.has(v.def_id) && v.entity_id === entity)?.value; // newest first
  };
  const role = (pid: string): Role | undefined => {
    const kind = kinds.find((l) => l.id === latest('player_kind', 'player', pid));
    if (kind?.meta?.goalkeeper) return 'gk';
    const r = roleOf(positions.find((l) => l.id === latest('position', 'player', pid)));
    return kind && r === 'gk' ? undefined : r;
  };
  const positionName = (pid: string) => positions.find((l) => l.id === latest('position', 'player', pid))?.name_he ?? '';
  const defaultGroup = (pid: string): number | 'bench' | undefined => {
    const l = groupList.find((x) => x.id === latest('default_group', 'player', pid));
    if (!l) return undefined;
    if (l.meta?.bench) return 'bench';
    const n = Number(l.meta?.group_no);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  // The formation: the match's, else the first one of the match's format, else the team's default.
  const formationName = useMemo(() => {
    if (!data) return undefined;
    const own = formations.find((l) => l.id === latest('formation', 'event', event.id));
    if (own) return own.name_he;
    const format = formats.find((l) => l.id === latest('match_format', 'event', event.id));
    if (format) {
      const first = formations.filter((l) => l.parent_id === format.id && l.active).sort((a, b) => a.sort_order - b.sort_order)[0];
      if (first) return first.name_he;
      const n = Number(format.name_he.match(/\d+/)?.[0]);
      if (FALLBACK[n]) return FALLBACK[n].join('-');
    }
    return formations.find((l) => l.id === data.teamFormation)?.name_he;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, formations, formats, event.id]);

  // Groups playing at once: the match's setting, else the team's, else one.
  const groups = useMemo(() => {
    const own = Number(latest('parallel_groups', 'event', event.id));
    const n = Number.isInteger(own) && own > 0 ? own : data?.teamGroups ?? 1;
    return Math.min(Math.max(Math.round(n), 1), MAX_GROUPS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, event.id]);

  const response = (pid: string) => responses.find((r) => r.player_id === pid);
  const status = (pid: string) => response(pid)?.status;
  const absent = (pid: string) => status(pid) === 'not_attending';
  const reasonOf = (pid: string) => {
    const r = response(pid);
    return r?.status === 'not_attending' ? reasons.find((l) => l.id === r.reason_id)?.name_he ?? 'לא מגיע' : '';
  };
  const coming = players.filter((p) => status(p.id) === 'attending').map((p) => p.id);
  const unanswered = players.filter((p) => !status(p.id)).map((p) => p.id);
  const rows = rowsOf(formationName) ?? FALLBACK[11];
  const slots = slotsFor(rows);
  const savedLineup = useMemo(() => {
    if (!data?.saved.length) return null;
    const out = Array.from({ length: groups }, () => slots.map(() => null as string | null));
    data.saved.forEach((s) => {
      if (s.group_no <= groups && s.slot < slots.length && ids.includes(s.player_id)) out[s.group_no - 1][s.slot] = s.player_id;
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, groups, slots.length, ids.join(',')]);
  // Order matters only for who fills the free places: those who said they come before those who have not answered.
  const suggestion = () => autoLineup(slots, groups, [...coming, ...unanswered, ...players.map((p) => p.id).filter(absent)],
    role, defaultGroup, absent);

  const [lineup, setLineup] = useState<(string | null)[][] | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [dirty, setDirty] = useState(false);
  const act = useAction();
  const drafted = useRef(false);
  // The draft waits for every list it reads, so it is not built from a fallback formation or without the defaults.
  const lookupsReady = [groupList, positions, kinds, formations, formats].every((l) => l.length > 0);
  useEffect(() => {
    if (!data || dirty) return;
    setLineup(savedLineup ?? suggestion());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, savedLineup, formationName, groups, positions.length, kinds.length, groupList.length, responses]);

  // A match without a lineup gets a draft saved right away, from the defaults; the coach reviews and approves it.
  useEffect(() => {
    if (!data || savedLineup || drafted.current || !lookupsReady || !players.length) return;
    drafted.current = true;
    const draft = suggestion();
    if (!draft.some((g) => g.some(Boolean))) return;
    act.run(async () => {
      await rpc('save_event_lineup', { p_event: event.id, p_groups: draft, p_approve: false });
      reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, savedLineup, lookupsReady]);

  if (error) return <Card title="הרכב על המגרש"><ErrorText error={error} /></Card>;
  if (!data || !lineup) return null;

  const onField = new Set(lineup.flat().filter(Boolean));
  const bench = [...coming, ...unanswered].filter((id) => !onField.has(id));
  const player = (id: string) => players.find((p) => p.id === id);
  const change = (next: (string | null)[][]) => { setLineup(next); setDirty(true); setPicked(null); };
  const copy = () => lineup!.map((g) => [...g]);

  function tapSlot(g: number, i: number) {
    if (!picked) return setPicked({ g, slot: i });
    const next = copy();
    if ('slot' in picked) {
      if (picked.g === g && picked.slot === i) return setPicked(null);
      [next[g][i], next[picked.g][picked.slot]] = [next[picked.g][picked.slot], next[g][i]];
    } else {
      next[g][i] = picked.bench;
    }
    change(next);
  }
  function tapBench(id: string) {
    if (picked && 'slot' in picked) {
      const next = copy();
      next[picked.g][picked.slot] = id;
      return change(next);
    }
    setPicked(picked && 'bench' in picked && picked.bench === id ? null : { bench: id });
  }
  const toBench = (g: number, i: number) => change(lineup!.map((grp, j) => grp.map((p, k) => (j === g && k === i ? null : p))));
  const save = (approve: boolean) => act.run(async () => {
    await rpc('save_event_lineup', { p_event: event.id, p_groups: lineup, p_approve: approve });
    setDirty(false); reload();
  });

  const marker = (id: string) => {
    const p = player(id);
    if (!p) return null;
    const st = status(id);
    const reason = reasonOf(id);
    return (
      <>
        <span className={`pitch-photo ${st === 'attending' ? '' : st === 'not_attending' ? 'out' : 'maybe'}`}>
          <PlayerAvatar player={p} size={42} />
          {shirt(id) !== undefined && <b className="pitch-no">{shirt(id)}</b>}
        </span>
        <span className="pitch-name">{p.full_name.split(' ')[0]}</span>
        {reason ? <small className="pitch-reason">{reason}</small> : positionName(id) && <small className="pitch-pos">{positionName(id)}</small>}
      </>
    );
  };

  const groupName = (g: number) => groupList.find((l) => Number(l.meta?.group_no) === g + 1)?.name_he ?? `קבוצה ${g + 1}`;
  const absentOnField = lineup.flat().filter((id): id is string => !!id && absent(id)).length;
  const approved = data.approved && !dirty;

  return (
    <Card title={`הרכב על המגרש · ${rows.join('-')}${groups > 1 ? ` · ${groups} קבוצות` : ''}`}
      actions={dirty ? <span className="badge warn">לא נשמר</span> : <Badge tone={approved ? 'ok' : undefined}>{approved ? 'מאושר' : 'טיוטה'}</Badge>}>
      {!coming.length && !unanswered.length && !absentOnField && <Empty>אין עדיין שחקנים שמגיעים.</Empty>}
      {lineup.map((grp, g) => (
        <div key={g}>
          {groups > 1 && <h4 className="section-title pitch-group-title">{groupName(g)}</h4>}
          <div className="pitch" role="group" aria-label={groups > 1 ? `סקיצת מגרש · ${groupName(g)}` : 'סקיצת מגרש'}>
            <svg className="pitch-lines" viewBox="0 0 68 100" preserveAspectRatio="none" aria-hidden="true">
              <g fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth="0.5">
                <rect x="2" y="2" width="64" height="96" />
                <line x1="2" y1="50" x2="66" y2="50" />
                <circle cx="34" cy="50" r="8" />
                <rect x="15" y="2" width="38" height="15" /><rect x="25" y="2" width="18" height="5" />
                <rect x="15" y="83" width="38" height="15" /><rect x="25" y="93" width="18" height="5" />
              </g>
            </svg>
            {slots.map((s, i) => {
              const id = grp[i];
              const sel = !!picked && 'slot' in picked && picked.g === g && picked.slot === i;
              return (
                <button key={i} type="button" className={`pitch-slot${sel ? ' picked' : ''}${id ? '' : ' empty'}`}
                  style={{ left: `${s.x}%`, top: `${s.y}%` }} onClick={() => tapSlot(g, i)}
                  aria-label={id ? player(id)?.full_name : 'מקום פנוי'}>
                  {id ? marker(id) : <span className="pitch-photo">＋</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="muted pitch-help">
        {picked ? 'עכשיו לחצו על שחקן או מקום נוסף כדי להחליף ביניהם.' : `לחצו על שחקן ואז על מקום אחר${groups > 1 ? ' (גם בקבוצה האחרת)' : ''} או על שחקן בספסל כדי להחליף.`}
        {' '}מסגרת מקווקוות: טרם אישר הגעה. אדומה: לא מגיע, עם הסיבה.
      </p>
      {absentOnField > 0 && <p className="pitch-help"><Badge tone="bad">{absentOnField} לא מגיעים על המגרש</Badge> כדאי להחליף אותם בשחקני ספסל.</p>}
      {picked && 'slot' in picked && lineup[picked.g][picked.slot] && (
        <button type="button" className="small secondary" onClick={() => toBench(picked.g, picked.slot)}>
          {absent(lineup[picked.g][picked.slot]!) ? 'להוציא מההרכב' : 'להוריד לספסל'}
        </button>
      )}
      <h4 className="section-title">ספסל ({bench.length})</h4>
      <div className="bench">
        {bench.map((id) => (
          <button key={id} type="button" className={`pitch-slot bench-slot${picked && 'bench' in picked && picked.bench === id ? ' picked' : ''}`} onClick={() => tapBench(id)}>
            {marker(id)}
          </button>
        ))}
        {!bench.length && <small className="muted">אין שחקנים בספסל.</small>}
      </div>
      <ErrorText error={act.error} />
      <div className="row wrap">
        <button className="secondary" disabled={act.busy || !dirty} onClick={() => save(false)}>שמירת טיוטה</button>
        <button disabled={act.busy || approved} onClick={() => save(true)}>אישור ההרכב</button>
        <button className="secondary" disabled={act.busy} onClick={() => change(suggestion())}>סידור אוטומטי לפי ברירות המחדל</button>
      </div>
      <small className="muted">
        המערך ומספר הקבוצות במקביל נקבעים ב"שיטת משחק" למטה; תפקיד, קבוצה ברירת מחדל ומספר של כל שחקן נקבעים בפרופיל השחקן.
        רק הצוות רואה את ההרכב.
      </small>
    </Card>
  );
}
