import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDay, q, useLoad } from '../lib/db';
import { average, defsFor, latestRatings } from '../lib/scores';
import { appliesToKind, isGoalkeeper } from './Attributes';
import { useLookups } from './Lookups';
import { Card, ScoreBar } from './ui';
import type { AttrDef, AttrValue, EntityRole, Player, Team } from '../lib/types';

interface Goal { id: string; title: string; target_date: string | null; done_at: string | null; archived: boolean }

/**
 * The coach's latest rating and the open goals of a child, right on the child's (or the parent's) home screen,
 * with a link to the full profile.
 */
export function PlayerProgress({ player, teams, role, showName }: { player: Player; teams: Team[]; role: EntityRole; showName?: boolean }) {
  const kinds = useLookups('player_kind', { includeInactive: true });
  const positions = useLookups('position', { includeInactive: true });
  const { data } = useLoad(async () => {
    const [defs, values, goals] = await Promise.all([
      q<AttrDef[]>(supabase.from('attribute_defs').select('*').eq('scope', 'player').eq('active', true).order('sort_order')),
      q<(AttrValue & { seq: number })[]>(supabase.from('attribute_values').select('*').eq('entity_id', player.id).order('seq', { ascending: false })),
      q<Goal[]>(supabase.from('player_goals').select('id, title, target_date, done_at, archived').eq('player_id', player.id).order('created_at')),
    ]);
    return { defs, values, goals };
  }, [player.id]);
  if (!data) return null;
  const scope = { clubId: player.club_id, teamIds: teams.map((t) => t.id), sportIds: teams.map((t) => t.sport_id), roles: [role] };
  const keeper = isGoalkeeper(data.defs, data.values, player.id, kinds, positions);
  const ratings = latestRatings(defsFor(data.defs, scope).filter((d) => d.data_type === 'scale' && appliesToKind(d, keeper)), data.values, player.id);
  const avg = average(ratings.map((r) => r.score));
  const last = ratings.reduce<string | null>((m, r) => (!m || r.at > m ? r.at : m), null);
  const open = data.goals.filter((g) => !g.archived && !g.done_at);
  const done = data.goals.filter((g) => !g.archived && g.done_at).length;
  const first = player.full_name.split(' ')[0];
  return (
    <Card title={showName ? `ההתקדמות של ${first}` : 'ההתקדמות שלי'} actions={avg !== null && <span className="score-badge">{avg.toFixed(1)}/10</span>}>
      <h4 className="section-title">הערכת המאמן{last ? <small className="muted"> · {fmtDay(last)}</small> : null}</h4>
      {ratings.length
        ? <div className="stack">{ratings.map((r) => <ScoreBar key={r.def.id} label={r.def.label_he} value={r.score} />)}</div>
        : <p className="muted">המאמן עוד לא מילא הערכה.</p>}
      <h4 className="section-title">יעדים{done ? <small className="muted"> · {done} הושגו 🏆</small> : null}</h4>
      {open.length
        ? <ul className="goal-list">{open.map((g) => <li key={g.id}>🎯 {g.title}{g.target_date ? <small className="muted"> · עד {fmtDay(g.target_date)}</small> : null}</li>)}</ul>
        : <p className="muted">אין יעדים פתוחים כרגע.</p>}
      <Link to={`../player/${player.id}`}>לפרופיל המלא ←</Link>
    </Card>
  );
}
