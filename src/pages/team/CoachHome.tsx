import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { useCoachTeam } from '../../auth/coachTeam';
import { Badge, Empty, Loading, PageHero, StatTiles } from '../../components/ui';
import { EventPoster } from '../../components/EventDashboard';
import { useLookupName, useLookups } from '../../components/Lookups';
import { KitAvatar } from '../../components/Kit';
import { TransportChip, useTransportTotals } from '../../components/Transport';
import { eventHeading, isOver, nextAndOther } from '../../lib/events';
import type { EventResponse, EventRow, Lookup, Team, TeamKit } from '../../lib/types';

const TZ = 'Asia/Jerusalem';
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('he-IL', { timeZone: TZ, ...o });

/** The coach's start screen: the next event of the current team, who is coming, and quick actions. */
export default function CoachHome() {
  const { profile, coachTeamIds, memberships } = useAuth();
  const staffName = useLookupName('staff_role');
  const [teamId, setTeamId] = useCoachTeam();
  const types = useLookups('event_type', { includeInactive: true });
  const teams = useLoad(
    () => (coachTeamIds.length ? q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').in('id', coachTeamIds).order('name')) : Promise.resolve([])),
    [coachTeamIds.join(',')],
  );
  const { data, loading, error } = useLoad(async () => {
    if (!teamId) return null;
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const rows = await q<EventRow[]>(supabase.from('events').select('*').eq('team_id', teamId).gte('starts_at', since).order('starts_at').limit(40));
    const events = rows.filter((e) => !isOver(e));
    const [next, other] = nextAndOther(events);
    const shown = [next, other].filter((e): e is EventRow => !!e);
    const players = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', teamId));
    const responses = shown.length ? await q<EventResponse[]>(supabase.from('event_responses').select('*').in('event_id', shown.map((e) => e.id))) : [];
    const kitIds = shown.map((e) => e.kit_id).filter((k): k is string => !!k);
    const kits = kitIds.length ? await q<TeamKit[]>(supabase.from('team_kits').select('*').in('id', kitIds)) : [];
    const later = events.filter((e) => e !== next && e !== other).slice(0, 4);
    return { next, other, later, squad: players.length, responses, kits };
  }, [teamId]);

  const transport = useTransportTotals([data?.next, data?.other, ...(data?.later ?? [])].filter((e): e is EventRow => !!e));
  const team = teams.data?.find((t) => t.id === teamId);
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const first = (profile?.full_name || '').split(' ')[0];
  const card = (e: EventRow, heading: string) => (
    <NextEventCard key={e.id} event={e} heading={heading} teamName={team?.name ?? ''} type={typeOf(e.type_id)}
      kit={data?.kits.find((k) => k.id === e.kit_id)} squad={data?.squad ?? 0} transport={transport.get(e.id)} responses={data?.responses.filter((r) => r.event_id === e.id) ?? []} />
  );

  return (
    <>
      <PageHero kicker={`${staffName(memberships.find((m) => m.role === 'coach' && m.team_id === teamId)?.staff_role_id) || 'מאמן'}${team ? ` · ${team.name}` : ''}`} title={first ? `שלום, ${first}` : 'שלום'} ball />
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

        {data && (data.next ? card(data.next, 'האירוע הבא') : (
          <div className="card"><Empty>אין אירועים קרובים.</Empty></div>
        ))}
        {data?.other && card(data.other, `ה${typeOf(data.other.type_id)?.name_he ?? 'אירוע'} הקרוב`)}

        {teamId && (
          <div className="quick-actions">
            <Link className="quick" to="../t/events"><span className="quick-icon">＋</span>אירוע חדש</Link>
            <Link className="quick" to="../t/tasks"><span className="quick-icon">✓</span>משימה חדשה</Link>
          </div>
        )}

        {data && data.later.length > 0 && (
          <section className="card">
            <h3>בהמשך</h3>
            <ul className="list compact">
              {data.later.map((e) => (
                <li key={e.id} className="row">
                  <Badge>{typeOf(e.type_id)?.name_he ?? ''}</Badge>
                  <Link to={`../event/${e.id}`}>{eventHeading(e, typeOf(e.type_id)?.name_he ?? '', team?.name)}</Link>
                  <TransportChip total={transport.get(e.id)} />
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

/** One upcoming event on the coach's home: who plays whom, when, the kit, and the attendance so far. */
function NextEventCard({ event, heading, teamName, type, kit, squad, responses, transport }: {
  event: EventRow; heading: string; teamName: string; type?: Lookup; kit?: TeamKit; squad: number; responses: EventResponse[]; transport?: number;
}) {
  const yes = responses.filter((r) => r.status === 'attending').length;
  const no = responses.filter((r) => r.status === 'not_attending').length;
  const isMatch = !!type?.meta?.is_match;
  return (
    <section className="stack next-event">
      <EventPoster event={event} typeLabel={type?.name_he ?? ''} isMatch={isMatch} teamName={teamName} kit={kit} heading={heading} />
      <div className="card">
      {kit && <span className="row"><KitAvatar kit={kit} size={26} />תלבושת: {kit.name}</span>}
      <StatTiles items={[
        { label: 'מגיעים', value: yes, tone: 'ok' },
        { label: 'לא מגיעים', value: no, tone: 'bad' },
        { label: 'טרם השיבו', value: Math.max(0, squad - yes - no), tone: 'muted' },
      ]} />
      {transport !== undefined && (
        <Link className="transport-line" to={`../event/${event.id}`}>🚌 הסעה: <strong>{transport}</strong> נוסעים ←</Link>
      )}
      <div className="row wrap">
        <Link className="button-link grow" to={`../event/${event.id}/prep`}>הכנה לאירוע ←</Link>
        <Link className="button-link soft" to={`../event/${event.id}`}>לפרטי האירוע</Link>
      </div>
      </div>
    </section>
  );
}
