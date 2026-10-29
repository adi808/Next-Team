import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { Card, Empty, Loading, PageHero, ScoreRing, StatTiles } from '../../components/ui';
import { useLookups } from '../../components/Lookups';
import { PlayerAvatar, ShirtNo, useShirtNumbers } from '../../components/People';
import { average, defsFor, latestRatings } from '../../lib/scores';
import { eventHeading } from '../../lib/events';
import type { AttrDef, AttrValue, EventResponse, EventRow, Player, Team } from '../../lib/types';

const TZ = 'Asia/Jerusalem';
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('he-IL', { timeZone: TZ, ...o });

/** Coach view before an event: the available squad by position and its average rating. */
export default function EventPrepPage() {
  const { eventId = '' } = useParams();
  const auth = useAuth();
  const acting = useActingRole();
  const types = useLookups('event_type', { includeInactive: true });
  const positions = useLookups('position', { includeInactive: true });
  const kinds = useLookups('player_kind', { includeInactive: true });
  const [showList, setShowList] = useState(false);
  const { data, loading, error } = useLoad(async () => {
    const event = await q<EventRow>(supabase.from('events').select('*').eq('id', eventId).single());
    const team = await q<Team>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').eq('id', event.team_id).single());
    const links = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', team.id));
    const ids = links.map((l) => l.player_id);
    const players = ids.length ? await q<Player[]>(supabase.from('v_players').select('*').in('id', ids).order('full_name')) : [];
    const responses = await q<EventResponse[]>(supabase.from('event_responses').select('*').eq('event_id', eventId));
    const defs = await q<AttrDef[]>(supabase.from('attribute_defs').select('*').eq('scope', 'player').eq('active', true).order('sort_order'));
    const values = ids.length
      ? await q<(AttrValue & { seq: number })[]>(supabase.from('attribute_values').select('*').in('entity_id', ids).order('seq', { ascending: false }))
      : [];
    return { event, team, players, responses, defs, values };
  }, [eventId]);
  const shirt = useShirtNumbers(data?.players.map((p) => p.id) ?? []);

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  const { event, team, players, responses, defs, values } = data;
  const canManage = (acting === 'system_admin' && !!auth.profile?.is_system_admin) || (acting === 'coach' && auth.coachTeamIds.includes(team.id))
    || (acting === 'club_admin' && auth.adminClubIds.includes(team.club_id));
  if (!canManage) return <Empty>ההכנה לאירוע פתוחה לצוות המקצועי בלבד.</Empty>;

  const typeName = types.find((t) => t.id === event.type_id)?.name_he ?? '';
  const status = (pid: string) => responses.find((r) => r.player_id === pid)?.status;
  const coming = players.filter((p) => status(p.id) === 'attending');
  const pendingCount = players.filter((p) => !status(p.id)).length;

  const scope = { clubId: team.club_id, teamIds: [team.id], sportIds: [team.sport_id], roles: acting ? [acting] : [] };
  const visible = defsFor(defs, scope);
  const posDef = visible.find((d) => d.key === 'position');
  const kindDef = visible.find((d) => d.key === 'player_kind');
  const scaleDefs = visible.filter((d) => d.data_type === 'scale');
  const positionOf = (pid: string) => {
    if (!posDef) return undefined;
    const v = values.find((x) => x.def_id === posDef.id && x.entity_id === pid)?.value; // values are newest first
    return positions.find((l) => l.id === v);
  };
  const kindOf = (pid: string) => {
    if (!kindDef) return undefined;
    const v = values.find((x) => x.def_id === kindDef.id && x.entity_id === pid)?.value;
    return kinds.find((l) => l.id === v);
  };
  // field player / goalkeeper decides; otherwise a goalkeeper position does
  const isKeeper = (pid: string) => { const k = kindOf(pid); return k ? !!k.meta?.goalkeeper : !!positionOf(pid)?.meta?.goalkeeper; };
  const scoreOf = (pid: string) => average(latestRatings(scaleDefs, values, pid).map((r) => r.score));

  const keepers = coming.filter((p) => isKeeper(p.id)).length;
  const sportPositions = positions.filter((l) => l.sport_id === team.sport_id && l.active);
  const byPosition = sportPositions.map((l) => ({ l, n: coming.filter((p) => positionOf(p.id)?.id === l.id).length }));
  const noPosition = coming.filter((p) => !positionOf(p.id)).length;
  const scored = coming.map((p) => scoreOf(p.id)).filter((s): s is number => s !== null);
  const teamScore = average(scored);

  return (
    <>
      <PageHero kicker={[typeName, `${fmt(event.starts_at, { weekday: 'long' })} ${fmt(event.starts_at, { hour: '2-digit', minute: '2-digit' })}`, event.location].filter(Boolean).join(' | ')}
        title="הכנה לאירוע">
        <span className="hero-sub">{eventHeading(event, typeName, team.name)} · {team.name}</span>
      </PageHero>
      <div className="overlap">
        <Card title="הסגל הזמין">
          <StatTiles items={[
            { label: 'מגיעים', value: coming.length, tone: 'ok' },
            { label: 'לא מגיעים', value: responses.filter((r) => r.status === 'not_attending').length, tone: 'bad' },
            { label: 'טרם השיבו', value: pendingCount, tone: 'muted' },
          ]} />
        </Card>
      </div>

      <Card title="פילוח לפי תפקידים">
        {posDef ? (
          <>
            {(!!kindDef || sportPositions.some((l) => l.meta?.goalkeeper)) && (
              <StatTiles items={[
                { label: 'שוערים', value: keepers, tone: 'info' },
                { label: 'שחקני שדה', value: coming.length - keepers, tone: 'info' },
              ]} />
            )}
            <div className="position-grid">
              {byPosition.map(({ l, n }) => <div key={l.id} className="position-chip"><strong>{n}</strong><span>{l.name_he}</span></div>)}
              {noPosition > 0 && <div className="position-chip muted"><strong>{noPosition}</strong><span>ללא תפקיד</span></div>}
            </div>
            {noPosition > 0 && <small className="muted">את התפקיד של כל שחקן קובעים בפרופיל השחקן.</small>}
          </>
        ) : <Empty>אין פרמטר תפקיד לענף הזה.</Empty>}
      </Card>

      <Card title="ציון משוקלל של הסגל הזמין">
        <div className="score-card">
          <ScoreRing value={teamScore} />
          <div className="stack">
            <span className="muted">ממוצע ההערכה האחרונה של {scored.length} מתוך {coming.length} השחקנים שמגיעים, מתוך 10.</span>
            {!scaleDefs.length && <small className="muted">כדי לקבל ציון מגדירים פרמטרי דירוג (1–10) בהגדרות הקבוצה.</small>}
            <button className="secondary" onClick={() => setShowList((v) => !v)}>{showList ? 'הסתרת הרשימה' : 'רשימת השחקנים'}</button>
          </div>
        </div>
        {showList && (
          <ul className="list compact">
            {coming.map((p) => {
              const s = scoreOf(p.id);
              return (
                <li key={p.id} className="row">
                  <PlayerAvatar player={p} size={32} />
                  <ShirtNo n={shirt(p.id)} />
                  <Link to={`../player/${p.id}`}>{p.full_name}</Link>
                  <small className="muted">{positionOf(p.id)?.name_he ?? ''}</small>
                  <span className="grow" />
                  <strong>{s === null ? '—' : s.toFixed(1)}</strong>
                </li>
              );
            })}
            {!coming.length && <li className="muted">עדיין אף אחד לא אישר הגעה.</li>}
          </ul>
        )}
      </Card>
      <Link className="center-link" to={`../event/${event.id}`}>לפרטי האירוע ←</Link>
    </>
  );
}
