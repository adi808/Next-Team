import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { isDemo, supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { teamAllowsPlayerAnswers } from '../../lib/team';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { Badge, Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import { AttributesPanel } from '../../components/Attributes';
import { AttendanceWidget } from '../../components/Attendance';
import { LookupSelect, useLookupName, useLookups, useSports } from '../../components/Lookups';
import { LineupPitch } from '../../components/LineupPitch';
import { EventDashboard } from '../../components/EventDashboard';
import { KitSelect } from '../../components/Kit';
import { EquipmentPicker } from '../../components/Equipment';
import { TransportCard } from '../../components/Transport';
import type { EntityRole, EventResponse, EventRow, EventStat, Player, Team, TeamKit } from '../../lib/types';

// ISO time -> the value a datetime-local input expects, in the viewer's local time.
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export default function EventPage() {
  const { eventId = '' } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const typeName = useLookupName('event_type');
  const reasonName = useLookupName('absence_reason');
  const statName = useLookupName('stat_type');
  const types = useLookups('event_type', { includeInactive: true });
  const sports = useSports();
  const [lineupKey, setLineupKey] = useState(0);
  const { data, loading, error, reload } = useLoad(async () => {
    const event = await q<EventRow>(supabase.from('events').select('*').eq('id', eventId).single());
    const team = await q<Team>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').eq('id', event.team_id).single());
    const links = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', team.id));
    const ids = links.map((l) => l.player_id);
    const players = ids.length ? await q<Player[]>(supabase.from('v_players').select('*').in('id', ids).order('full_name')) : [];
    const responses = await q<EventResponse[]>(supabase.from('event_responses').select('*').eq('event_id', eventId));
    const stats = await q<EventStat[]>(supabase.from('event_stats').select('*').eq('event_id', eventId).order('minute'));
    const kits = await q<TeamKit[]>(supabase.from('team_kits').select('*').eq('team_id', team.id).order('sort_order'));
    return { event, team, players, responses, stats, kits };
  }, [eventId]);
  const act = useAction();
  const acting = useActingRole();
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ type: null as string | null, title: '', starts: '', ends: '', location: '', notes: '', opponent: '', our: '', their: '', kit: null as string | null, equipment: [] as string[] });
  const [statPlayer, setStatPlayer] = useState('');
  const [statType, setStatType] = useState<string | null>(null);
  const [minute, setMinute] = useState('');

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  const { event, team, players, responses, stats, kits } = data;
  const kit = kits.find((k) => k.id === event.kit_id);
  const isMatchType = (id: string | null) => !!types.find((t) => t.id === id)?.meta?.is_match;
  const isMatch = isMatchType(event.type_id);
  const canManage = (acting === 'system_admin' && !!auth.profile?.is_system_admin) || (acting === 'coach' && auth.coachTeamIds.includes(team.id))
    || (acting === 'club_admin' && auth.adminClubIds.includes(team.club_id));
  const myKids = players.filter((p) => (acting === 'parent' && auth.children.some((c) => c.id === p.id)) || (acting === 'player' && auth.me?.id === p.id));
  const resp = (pid: string) => responses.find((r) => r.player_id === pid);
  const roles: EntityRole[] = [];
  if (auth.profile?.is_system_admin) roles.push('system_admin');
  if (auth.adminClubIds.includes(team.club_id)) roles.push('club_admin');
  if (auth.coachTeamIds.includes(team.id)) roles.push('coach');
  if (players.some((p) => auth.children.some((c) => c.id === p.id))) roles.push('parent');
  if (auth.me && players.some((p) => p.id === auth.me?.id)) roles.push('player');
  const myRoles = roles.filter((r) => r === acting);
  const attending = responses.filter((r) => r.status === 'attending').length;
  const absent = responses.filter((r) => r.status === 'not_attending').length;

  function startEdit() {
    setF({
      type: event.type_id, title: event.title, starts: toLocalInput(event.starts_at), ends: event.ends_at ? toLocalInput(event.ends_at) : '', location: event.location, notes: event.notes,
      opponent: event.opponent ?? '', our: event.our_score?.toString() ?? '', their: event.their_score?.toString() ?? '', kit: event.kit_id, equipment: event.equipment ?? [],
    });
    setEdit(true);
  }
  async function saveEdit() {
    await act.run(async () => {
      const match = isMatchType(f.type);
      await rpc('save_event_details', {
        p_event: event.id, p_type: f.type, p_title: f.title, p_starts: new Date(f.starts).toISOString(),
        p_ends: f.ends ? new Date(f.ends).toISOString() : null, p_location: f.location, p_notes: f.notes,
        p_opponent: match ? f.opponent || null : null,
        p_our_score: match && f.our !== '' ? Number(f.our) : null, p_their_score: match && f.their !== '' ? Number(f.their) : null,
      });
      if (f.kit !== event.kit_id) await rpc('set_event_kit', { p_event: event.id, p_kit: f.kit });
      if (f.equipment.join() !== (event.equipment ?? []).join()) await rpc('set_event_equipment', { p_event: event.id, p_items: f.equipment });
      setEdit(false); reload();
    });
  }

  return (
    <>
      <p><Link to={`../team/${team.id}`}>← {team.name}</Link></p>
      <EventDashboard event={event} typeLabel={typeName(event.type_id)} isMatch={isMatch} kit={kit}
        attendance={canManage ? { yes: attending, no: absent, pending: players.length - responses.length } : undefined} />
      {canManage && (
        <div className="row wrap">
          <Link className="button-link grow" to={`../event/${event.id}/prep`}>הכנה לאירוע ←</Link>
          {!edit && <button className="secondary" onClick={startEdit}>✏️ עריכת פרטי האירוע</button>}
        </div>
      )}
      {(canManage || event.notes) && <Card title="פרטים" actions={canManage && (
        <div className="row">
          {!edit && <button className="small secondary" onClick={startEdit}>עריכה</button>}
          <button className="small secondary" onClick={() => { if (confirm('למחוק את האירוע?')) act.run(async () => { await rpc('delete_event', { p_event: event.id }); navigate(`../team/${team.id}`); }); }}>מחיקה</button>
        </div>
      )}>
        {event.notes ? <p>{event.notes}</p> : !edit && <p className="muted">אין הערות.</p>}
        {edit && (
          <div className="stack">
            <Field label="סוג"><LookupSelect domain="event_type" value={f.type} onChange={(v) => setF({ ...f, type: v })} /></Field>
            <Field label="כותרת"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <div className="row wrap">
              <Field label="מתחיל"><input type="datetime-local" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></Field>
              <Field label="מסתיים (לא חובה)"><input type="datetime-local" value={f.ends} min={f.starts} onChange={(e) => setF({ ...f, ends: e.target.value })} /></Field>
            </div>
            <Field label="מיקום"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="הערות"><textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
            <Field label="מה להביא"><EquipmentPicker value={f.equipment} onChange={(v) => setF({ ...f, equipment: v })} /></Field>
            {kits.length > 0 && <Field label="תלבושת"><KitSelect kits={kits} value={f.kit} onChange={(k) => setF({ ...f, kit: k })} /></Field>}
            {isMatchType(f.type) && (
              <>
                <Field label="יריבה"><input value={f.opponent} onChange={(e) => setF({ ...f, opponent: e.target.value })} /></Field>
                <div className="row">
                  <Field label="שלנו"><input type="number" min={0} value={f.our} onChange={(e) => setF({ ...f, our: e.target.value })} /></Field>
                  <Field label="שלהם"><input type="number" min={0} value={f.their} onChange={(e) => setF({ ...f, their: e.target.value })} /></Field>
                </div>
              </>
            )}
            <div className="row">
              <button disabled={act.busy || !f.type || !f.starts || (!!f.ends && f.ends < f.starts)} onClick={saveEdit}>שמירה</button>
              <button className="secondary" onClick={() => setEdit(false)}>ביטול</button>
            </div>
          </div>
        )}
        <ErrorText error={act.error} />
      </Card>}

      {isMatch && canManage && sports.find((s) => s.id === team.sport_id)?.slug === 'football' && (
        <LineupPitch key={lineupKey} event={event} players={players} responses={responses} />
      )}
      {isMatch && (
        <AttributesPanel scope="event" entityId={event.id} myRoles={myRoles} clubId={team.club_id} teamIds={[team.id]} sportIds={[team.sport_id]} title="שיטת משחק"
          onSaved={() => setLineupKey((k) => k + 1)} />
      )}

      {!isDemo && (
        <TransportCard event={event} players={players} responses={responses} canManage={canManage} myId={auth.profile?.id ?? ''}
          myKids={acting === 'parent' ? myKids : []} isStaff={canManage && acting !== 'system_admin'} onToggled={reload} />
      )}

      <Card title="אישורי הגעה">
        {myKids.map((k) => (
          <KidAnswer key={k.id} event={event} kid={k} response={resp(k.id)} asParent={auth.children.some((c) => c.id === k.id)} onSaved={reload} />
        ))}
        {canManage && (
          <>
            <p><Badge tone="ok">מגיעים {attending}</Badge> <Badge tone="bad">לא מגיעים {absent}</Badge> <Badge>טרם נענו {players.length - responses.length}</Badge></p>
            <ul className="list compact">
              {players.map((p) => {
                const r = resp(p.id);
                return (
                  <li key={p.id} className="row">
                    <span>{r ? (r.status === 'attending' ? '✓' : '✗') : '○'}</span>
                    <Link to={`../player/${p.id}`}>{p.full_name}</Link>
                    {r?.status === 'not_attending' && <small className="muted">{reasonName(r.reason_id)}{r.note ? ` · ${r.note}` : ''}</small>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {!canManage && !myKids.length && <Empty>האישורים מוצגים להורה ולצוות בלבד.</Empty>}
      </Card>

      {isMatch && (
        <Card title="אירועי משחק (שערים, כרטיסים, בישולים)">
          {!stats.length && <Empty>עדיין לא נרשמו אירועים.</Empty>}
          <ul className="list compact">
            {stats.map((s) => (
              <li key={s.id} className="row">
                <span>{s.minute !== null ? `${s.minute}'` : ''}</span>
                <strong>{statName(s.stat_type_id)}</strong>
                <span>{players.find((p) => p.id === s.player_id)?.full_name}</span>
                {canManage && <button className="small secondary" onClick={() => act.run(async () => { await rpc('delete_stat', { p_stat: s.id }); reload(); })}>מחיקה</button>}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="stack">
              <select value={statPlayer} onChange={(e) => setStatPlayer(e.target.value)}>
                <option value="">שחקן…</option>
                {players.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
              <LookupSelect domain="stat_type" value={statType} onChange={setStatType} sportId={team.sport_id} empty="סוג…" />
              <input type="number" min={0} max={200} value={minute} onChange={(e) => setMinute(e.target.value)} placeholder="דקה (לא חובה)" />
              <button disabled={!statPlayer || !statType || act.busy}
                onClick={() => act.run(async () => { await rpc('record_stat', { p_event: event.id, p_player: statPlayer, p_stat_type: statType, p_minute: minute === '' ? null : Number(minute) }); setMinute(''); reload(); })}>רישום</button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function KidAnswer({ event, kid, response, asParent, onSaved }: { event: EventRow; kid: Player; response?: EventResponse; asParent: boolean; onSaved: () => void }) {
  const allowed = useLoad(() => (asParent ? Promise.resolve(true) : teamAllowsPlayerAnswers(event.team_id, kid.birth_date)), [event.team_id, kid.id, asParent]);
  return <AttendanceWidget eventId={event.id} playerId={kid.id} playerName={kid.full_name} response={response} canAnswer={allowed.data === true} onSaved={onSaved} />;
}
