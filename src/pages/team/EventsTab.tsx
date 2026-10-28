import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDate } from '../../lib/db';
import { applyEventDefaults } from '../../lib/team';
import { Badge, Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import { LookupSelect, useLookups } from '../../components/Lookups';
import { KitAvatar, KitSelect, useTeamKits } from '../../components/Kit';
import type { EventRow } from '../../lib/types';
import type { TeamTabProps } from './TeamPage';

const WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']; // index = day of week, 0 = Sunday

export default function EventsTab({ team, canManage }: TeamTabProps) {
  const types = useLookups('event_type', { includeInactive: true });
  const kits = useTeamKits(team.id);
  const { data, loading, error, reload } = useLoad(
    () => q<EventRow[]>(supabase.from('events').select('*').eq('team_id', team.id).order('starts_at', { ascending: false })),
    [team.id],
  );
  const [typeId, setTypeId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [starts, setStarts] = useState('');
  const [location, setLocation] = useState('');
  const [opponent, setOpponent] = useState('');
  const [kitId, setKitId] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState('17:00');
  const [duration, setDuration] = useState('90');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [created, setCreated] = useState<number | null>(null);
  const act = useAction();
  const isMatch = (id: string | null) => !!types.find((t) => t.id === id)?.meta?.is_match;
  const typeName = (id: string) => types.find((t) => t.id === id)?.name_he ?? '';
  const kitOf = (id: string | null) => kits.data?.find((k) => k.id === id);
  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));

  function reset() {
    setTitle(''); setStarts(''); setLocation(''); setOpponent(''); setDays([]); setFrom(''); setUntil('');
  }
  async function create() {
    setCreated(null);
    await act.run(async () => {
      if (repeat) {
        const n = await rpc<number>('create_event_series', {
          p_team: team.id, p_type: typeId, p_title: title, p_days: days, p_start: time,
          p_duration_min: duration ? Number(duration) : null, p_from: from, p_until: until, p_location: location, p_kit: kitId,
        });
        setCreated(n);
      } else {
        const id = await rpc<string>('create_event', {
          p_team: team.id, p_type: typeId, p_title: title, p_starts: new Date(starts).toISOString(),
          p_location: location, p_opponent: isMatch(typeId) ? opponent || null : null,
        });
        if (kitId) await rpc('set_event_kit', { p_event: id, p_kit: kitId });
        if (isMatch(typeId)) await applyEventDefaults(id, team.id).catch(() => {});
        setCreated(1);
      }
      reset(); reload();
    });
  }
  const ready = !!typeId && (repeat ? days.length > 0 && !!time && !!from && !!until : !!starts);

  return (
    <>
      <Loading loading={loading} error={error} />
      {data && !data.length && <Empty>אין עדיין אירועים.</Empty>}
      <ul className="list">
        {data?.map((e) => {
          const kit = kitOf(e.kit_id);
          return (
            <li key={e.id} className="row">
              <Badge>{typeName(e.type_id)}</Badge>
              <Link to={`../event/${e.id}`}>{e.title || typeName(e.type_id)}</Link>
              <small className="muted">{fmtDate(e.starts_at)}{e.opponent ? ` · נגד ${e.opponent}` : ''}</small>
              {e.our_score !== null && <strong>{e.our_score}:{e.their_score}</strong>}
              <span className="grow" />
              {kit && <KitAvatar kit={kit} size={30} />}
            </li>
          );
        })}
      </ul>
      {canManage && (
        <Card title="אירוע חדש">
          <Field label="סוג"><LookupSelect domain="event_type" value={typeId} onChange={setTypeId} /></Field>
          <Field label="כותרת (לא חובה)"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> אירוע חוזר (למשל אימון קבוע)</label>
          {repeat ? (
            <>
              <Field label="בימים">
                <div className="weekdays">
                  {WEEKDAYS.map((d, i) => (
                    <button key={i} type="button" className={days.includes(i) ? 'on' : ''} aria-pressed={days.includes(i)} onClick={() => toggleDay(i)}>{d}</button>
                  ))}
                </div>
              </Field>
              <div className="row wrap">
                <Field label="שעה"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
                <Field label="משך (דקות)"><input type="number" min={0} max={600} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>
              </div>
              <div className="row wrap">
                <Field label="מתאריך"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="עד תאריך"><input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
              </div>
            </>
          ) : (
            <Field label="מתי"><input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
          )}
          <Field label="מיקום"><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="למשל: מגרש העירוני, הרצליה" /></Field>
          {!repeat && isMatch(typeId) && <Field label="יריבה"><input value={opponent} onChange={(e) => setOpponent(e.target.value)} /></Field>}
          {!!kits.data?.some((k) => k.active) && (
            <div className="row">
              <Field label="תלבושת"><KitSelect kits={kits.data} value={kitId} onChange={setKitId} /></Field>
              {kitOf(kitId) && <KitAvatar kit={kitOf(kitId)!} size={56} />}
            </div>
          )}
          <ErrorText error={act.error} />
          {created !== null && <p className="ok">{created === 1 ? 'האירוע נוצר' : `נוצרו ${created} אירועים`}</p>}
          <button disabled={!ready || act.busy} onClick={create}>{repeat ? 'יצירת האירועים' : 'יצירת אירוע'}</button>
        </Card>
      )}
    </>
  );
}
