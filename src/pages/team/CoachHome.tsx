import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { useCoachTeam } from '../../auth/coachTeam';
import { Badge, Empty, Loading, PageHero, StatTiles } from '../../components/ui';
import { useLookups } from '../../components/Lookups';
import { KitAvatar } from '../../components/Kit';
import type { EventResponse, EventRow, Team, TeamKit } from '../../lib/types';

const TZ = 'Asia/Jerusalem';
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('he-IL', { timeZone: TZ, ...o });

/** The coach's start screen: the next event of the current team, who is coming, and quick actions. */
export default function CoachHome() {
  const { profile, coachTeamIds } = useAuth();
  const [teamId, setTeamId] = useCoachTeam();
  const types = useLookups('event_type', { includeInactive: true });
  const teams = useLoad(
    () => (coachTeamIds.length ? q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').in('id', coachTeamIds).order('name')) : Promise.resolve([])),
    [coachTeamIds.join(',')],
  );
  const { data, loading, error } = useLoad(async () => {
    if (!teamId) return null;
    const since = new Date(Date.now() - 3 * 3600_000).toISOString();
    const events = await q<EventRow[]>(supabase.from('events').select('*').eq('team_id', teamId).gte('starts_at', since).order('starts_at').limit(4));
    const next = events[0];
    const players = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', teamId));
    const responses = next ? await q<EventResponse[]>(supabase.from('event_responses').select('*').eq('event_id', next.id)) : [];
    const kit = next?.kit_id ? (await q<TeamKit[]>(supabase.from('team_kits').select('*').eq('id', next.kit_id)))[0] : undefined;
    return { events: events.slice(0, 4), next, squad: players.length, responses, kit };
  }, [teamId]);

  const team = teams.data?.find((t) => t.id === teamId);
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const first = (profile?.full_name || '').split(' ')[0];
  const next = data?.next;
  const yes = data?.responses.filter((r) => r.status === 'attending').length ?? 0;
  const no = data?.responses.filter((r) => r.status === 'not_attending').length ?? 0;
  const isMatch = !!(next && typeOf(next.type_id)?.meta?.is_match);

  return (
    <>
      <PageHero kicker={`מאמן${team ? ` · ${team.name}` : ''}`} title={first ? `שלום, ${first}` : 'שלום'} ball />
      <div className="overlap stack">
        {(teams.data?.length ?? 0) > 1 && (
          <div className="card team-switch">
            <label className="field">
              <span>קבוצה</span>
              <select value={teamId ?? ''} onChange={(e) => setTeamId(e.target.value)}>
                {teams.data!.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {!coachTeamIds.length && <div className="card"><Empty>אין לך עדיין קבוצות.</Empty></div>}
        <Loading loading={loading} error={error} />

        {data && (next ? (
          <section className="card next-event">
            <div className="card-head">
              <h3>האירוע הבא</h3>
              <Badge>{typeOf(next.type_id)?.name_he ?? ''}</Badge>
            </div>
            <div className="next-event-title">
              {isMatch && next.opponent ? (
                <><strong>{team?.name}</strong><span className="vs">VS</span><strong>{next.opponent}</strong></>
              ) : (
                <strong>{next.title || typeOf(next.type_id)?.name_he}</strong>
              )}
            </div>
            <div className="meta-row">
              {data.kit && <span className="row"><KitAvatar kit={data.kit} size={26} />{data.kit.name}</span>}
              <span>{fmt(next.starts_at, { hour: '2-digit', minute: '2-digit' })}</span>
              <span>{fmt(next.starts_at, { weekday: 'long', day: 'numeric', month: 'numeric' })}</span>
            </div>
            {next.location && <small className="muted">{next.location}</small>}
            <StatTiles items={[
              { label: 'מגיעים', value: yes, tone: 'ok' },
              { label: 'לא מגיעים', value: no, tone: 'bad' },
              { label: 'טרם השיבו', value: Math.max(0, data.squad - yes - no), tone: 'muted' },
            ]} />
            <div className="row wrap">
              <Link className="button-link grow" to={`../event/${next.id}/prep`}>הכנה לאירוע ←</Link>
              <Link className="button-link soft" to={`../event/${next.id}`}>לפרטי האירוע</Link>
            </div>
          </section>
        ) : (
          <div className="card"><Empty>אין אירועים קרובים.</Empty></div>
        ))}

        {teamId && (
          <div className="quick-actions">
            <Link className="quick" to="../t/events"><span className="quick-icon">＋</span>אירוע חדש</Link>
            <Link className="quick" to="../t/tasks"><span className="quick-icon">✓</span>משימה חדשה</Link>
          </div>
        )}

        {data && data.events.length > 1 && (
          <section className="card">
            <h3>בהמשך</h3>
            <ul className="list compact">
              {data.events.slice(1).map((e) => (
                <li key={e.id} className="row">
                  <Badge>{typeOf(e.type_id)?.name_he ?? ''}</Badge>
                  <Link to={`../event/${e.id}`}>{e.title || typeOf(e.type_id)?.name_he}{e.opponent ? ` נגד ${e.opponent}` : ''}</Link>
                  <span className="grow" />
                  <small className="muted">{fmt(e.starts_at, { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(teams.data?.length ?? 0) > 0 && <Link className="muted center-link" to="../teams">כל הקבוצות שלי</Link>}
      </div>
    </>
  );
}
