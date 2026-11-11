import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, isDemo } from '../lib/supabase';
import { rpc, useLoad } from '../lib/db';
import { Card } from './ui';

const KEY = (team: string) => `nt-first-steps-hidden-${team}`;

/** How many rows (up to 5) a table has for the team; 0 when it cannot be read. */
async function count(table: string, column: string, value: string, extra?: (qb: any) => any): Promise<number> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let qb: any = supabase.from(table).select(column).eq(column, value);
    if (extra) qb = extra(qb);
    const { data, error } = await qb.limit(5);
    return error ? 0 : (data as unknown[] | null)?.length ?? 0;
  } catch { return 0; }
}

/** A new team's checklist on the coach's home: each step links to its screen and is ticked once done. */
export function FirstSteps({ teamId }: { teamId: string }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(KEY(teamId)) === '1'; } catch { return false; } });
  const { data } = useLoad(async () => {
    const [players, events, kits, links, format] = await Promise.all([
      count('team_players', 'team_id', teamId),
      count('events', 'team_id', teamId),
      count('team_kits', 'team_id', teamId),
      isDemo ? Promise.resolve(1) : count('join_links', 'team_id', teamId, (qb) => qb.eq('active', true)),
      rpc<unknown>('team_param', { p_team: teamId, p_key: 'default_match_format' }).catch(() => null),
    ]);
    return [
      { done: players >= 5, label: 'להוסיף את השחקנים לסגל', to: '../t/squad' },
      { done: links > 0, label: 'לשלוח להורים קישור הצטרפות', to: '../t/squad' },
      { done: format !== null && format !== undefined, label: 'לקבוע פורמט משחק ומערך', to: '../team/' + teamId + '?tab=settings' },
      { done: kits > 0, label: 'להגדיר תלבושות (בית / חוץ)', to: '../team/' + teamId + '?tab=settings' },
      { done: events > 0, label: 'ליצור אימונים ומשחקים (אפשר סדרה קבועה)', to: '../t/events' },
    ];
  }, [teamId]);
  if (hidden || !data || data.every((s) => s.done)) return null;
  const left = data.filter((s) => !s.done).length;
  const hide = () => { try { localStorage.setItem(KEY(teamId), '1'); } catch { /* storage blocked */ } setHidden(true); };
  return (
    <Card title={`צעדים ראשונים · נשארו ${left}`} actions={<button className="link small" onClick={hide}>הסתרה</button>}>
      <ol className="first-steps">
        {data.map((s) => (
          <li key={s.label} className={s.done ? 'done' : ''}>
            <span className="step-mark" aria-hidden="true">{s.done ? '✓' : ''}</span>
            {s.done ? <span>{s.label}</span> : <Link to={s.to}>{s.label}</Link>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
