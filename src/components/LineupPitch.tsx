import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad } from '../lib/db';
import { Card, Empty, ErrorText } from './ui';
import { useLookups } from './Lookups';
import { PlayerAvatar, useShirtNumbers } from './People';
import type { AttrDef, AttrValue, EventResponse, EventRow, Lookup, Player } from '../lib/types';

type Role = 'gk' | 'def' | 'mid' | 'fwd';
const ROLE_OF_SLUG: [RegExp, Role][] = [[/goal|gk/, 'gk'], [/def|df/, 'def'], [/mid|mf/, 'mid'], [/forw|fw|att|str/, 'fwd']];
// Formation used when neither the match nor the team sets one, by the number of players on the field.
const FALLBACK: Record<number, number[]> = { 11: [4, 3, 3], 9: [3, 3, 2], 8: [3, 3, 1], 7: [2, 3, 1], 6: [2, 2, 1], 5: [2, 2] };

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

/** Fills the slots with players of the matching role first, then anyone left; the rest sit on the bench. */
function autoLineup(slots: Slot[], players: string[], role: (id: string) => Role | undefined): (string | null)[] {
  const left = [...players];
  const take = (pred: (id: string) => boolean) => {
    const i = left.findIndex(pred);
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  const out: (string | null)[] = slots.map((s) => take((id) => role(id) === s.role));
  out.forEach((p, i) => { if (!p && i > 0) out[i] = take((id) => role(id) !== 'gk') ?? take(() => true); });
  if (!out[0]) out[0] = take(() => true);
  return out;
}

export function LineupPitch({ event, players, responses }: { event: EventRow; players: Player[]; responses: EventResponse[] }) {
  const formations = useLookups('formation', { includeInactive: true });
  const formats = useLookups('match_format', { includeInactive: true });
  const positions = useLookups('position', { includeInactive: true });
  const kinds = useLookups('player_kind', { includeInactive: true });
  const ids = players.map((p) => p.id);
  const shirt = useShirtNumbers(ids);
  const { data, error, reload } = useLoad(async () => {
    const defs = await q<AttrDef[]>(supabase.from('attribute_defs').select('*').in('key', ['match_format', 'formation', 'position', 'player_kind']).eq('active', true));
    const values = await q<AttrValue[]>(supabase.from('attribute_values').select('*')
      .in('def_id', defs.map((d) => d.id)).in('entity_id', [event.id, ...ids]).order('seq', { ascending: false }));
    const saved = await q<{ slot: number; player_id: string }[]>(supabase.from('event_lineups').select('slot, player_id').eq('event_id', event.id));
    const teamFormation = await rpc<unknown>('team_param', { p_team: event.team_id, p_key: 'default_formation' });
    return { defs, values, saved, teamFormation: typeof teamFormation === 'string' ? teamFormation : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, ids.join(',')]);

  const latest = (key: string, scope: AttrDef['scope'], entity: string) => {
    const defIds = new Set(data?.defs.filter((d) => d.key === key && d.scope === scope).map((d) => d.id));
    return data?.values.find((v) => defIds.has(v.def_id) && v.entity_id === entity)?.value as string | undefined; // newest first
  };
  const role = (pid: string): Role | undefined => {
    const kind = kinds.find((l) => l.id === latest('player_kind', 'player', pid));
    if (kind?.meta?.goalkeeper) return 'gk';
    const r = roleOf(positions.find((l) => l.id === latest('position', 'player', pid)));
    return kind && r === 'gk' ? undefined : r;
  };
  const positionName = (pid: string) => positions.find((l) => l.id === latest('position', 'player', pid))?.name_he ?? '';

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

  const status = (pid: string) => responses.find((r) => r.player_id === pid)?.status;
  const coming = players.filter((p) => status(p.id) === 'attending').map((p) => p.id);
  const unanswered = players.filter((p) => !status(p.id)).map((p) => p.id);
  const rows = rowsOf(formationName) ?? FALLBACK[11];
  const slots = slotsFor(rows);
  const savedLineup = useMemo(() => {
    if (!data?.saved.length) return null;
    const out: (string | null)[] = slots.map(() => null);
    data.saved.forEach((s) => { if (s.slot < out.length && ids.includes(s.player_id)) out[s.slot] = s.player_id; });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, slots.length, ids.join(',')]);
  const suggestion = () => autoLineup(slots, [...coming, ...unanswered], role);

  const [lineup, setLineup] = useState<(string | null)[] | null>(null);
  const [picked, setPicked] = useState<{ slot: number } | { bench: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const act = useAction();
  useEffect(() => {
    if (!data || dirty) return;
    setLineup(savedLineup ?? suggestion());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, savedLineup, formationName, positions.length, kinds.length, responses]);

  if (error) return <Card title="הרכב על המגרש"><ErrorText error={error} /></Card>;
  if (!data || !lineup) return null;

  const onField = new Set(lineup.filter(Boolean));
  const bench = [...coming, ...unanswered].filter((id) => !onField.has(id));
  const player = (id: string) => players.find((p) => p.id === id);
  const change = (next: (string | null)[]) => { setLineup(next); setDirty(true); setPicked(null); };

  function tapSlot(i: number) {
    if (!picked) return setPicked({ slot: i });
    const next = [...lineup!];
    if ('slot' in picked) {
      if (picked.slot === i) return setPicked(null);
      [next[i], next[picked.slot]] = [next[picked.slot], next[i]];
    } else {
      next[i] = picked.bench;
    }
    change(next);
  }
  function tapBench(id: string) {
    if (picked && 'slot' in picked) {
      const next = [...lineup!];
      next[picked.slot] = id;
      return change(next);
    }
    setPicked(picked && 'bench' in picked && picked.bench === id ? null : { bench: id });
  }
  const benchToField = (i: number) => change(lineup!.map((p, j) => (j === i ? null : p)));
  const save = () => act.run(async () => {
    await rpc('set_event_lineup', { p_event: event.id, p_players: lineup });
    setDirty(false); reload();
  });

  const marker = (id: string) => {
    const p = player(id);
    if (!p) return null;
    const st = status(id);
    return (
      <>
        <span className={`pitch-photo ${st === 'attending' ? '' : st === 'not_attending' ? 'out' : 'maybe'}`}>
          <PlayerAvatar player={p} size={42} />
          {shirt(id) !== undefined && <b className="pitch-no">{shirt(id)}</b>}
        </span>
        <span className="pitch-name">{p.full_name.split(' ')[0]}</span>
        {positionName(id) && <small className="pitch-pos">{positionName(id)}</small>}
      </>
    );
  };

  return (
    <Card title={`הרכב על המגרש · ${rows.join('-')}`} actions={dirty && <span className="badge warn">לא נשמר</span>}>
      {!coming.length && !unanswered.length && <Empty>אין עדיין שחקנים שמגיעים.</Empty>}
      <div className="pitch" role="group" aria-label="סקיצת מגרש">
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
          const id = lineup[i];
          const sel = !!picked && 'slot' in picked && picked.slot === i;
          return (
            <button key={i} type="button" className={`pitch-slot${sel ? ' picked' : ''}${id ? '' : ' empty'}`}
              style={{ left: `${s.x}%`, top: `${s.y}%` }} onClick={() => tapSlot(i)}
              aria-label={id ? player(id)?.full_name : 'מקום פנוי'}>
              {id ? marker(id) : <span className="pitch-photo">＋</span>}
            </button>
          );
        })}
      </div>
      <p className="muted pitch-help">
        {picked ? 'עכשיו לחצו על שחקן או מקום נוסף כדי להחליף ביניהם.' : 'לחצו על שחקן ואז על מקום אחר (או על שחקן בספסל) כדי להחליף.'}
        {' '}מסגרת מקווקוות: טרם אישר הגעה. אדומה: לא מגיע.
      </p>
      {picked && 'slot' in picked && lineup[picked.slot] && (
        <button type="button" className="small secondary" onClick={() => benchToField(picked.slot)}>להוריד לספסל</button>
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
        <button disabled={act.busy || !dirty} onClick={save}>שמירת ההרכב</button>
        <button className="secondary" disabled={act.busy} onClick={() => change(suggestion())}>סידור אוטומטי לפי תפקידים</button>
      </div>
      <small className="muted">המערך נקבע ב"שיטת משחק" למטה; את התפקיד והמספר של כל שחקן קובעים בפרופיל השחקן.</small>
    </Card>
  );
}
