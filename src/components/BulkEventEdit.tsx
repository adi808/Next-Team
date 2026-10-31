import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDay } from '../lib/db';
import { dayName, israelDow, israelTime, sameSlotAhead } from '../lib/events';
import { Card, ErrorText, Field } from './ui';
import { KitSelect } from './Kit';
import type { EventRow, TeamKit } from '../lib/types';

/**
 * Edits the chosen event and every later event of the same team, type and weekday at once (all the Sunday
 * trainings, for example): start time, duration, location, kit and notes. Only the ticked fields change.
 */
export function BulkEventEdit({ event, kits, typeLabel, onDone, onClose }: {
  event: EventRow; kits: TeamKit[]; typeLabel: string; onDone: () => void; onClose: () => void;
}) {
  const act = useAction();
  const minutes = event.ends_at ? Math.round((new Date(event.ends_at).getTime() - new Date(event.starts_at).getTime()) / 60_000) : 90;
  const [use, setUse] = useState({ start: false, duration: false, location: false, kit: false, notes: false });
  const [start, setStart] = useState(israelTime(event.starts_at));
  const [duration, setDuration] = useState(String(minutes));
  const [location, setLocation] = useState(event.location ?? '');
  const [kit, setKit] = useState<string | null>(event.kit_id);
  const [notes, setNotes] = useState(event.notes ?? '');
  const [notify, setNotify] = useState(true);
  const tick = (k: keyof typeof use) => (e: React.ChangeEvent<HTMLInputElement>) => setUse({ ...use, [k]: e.target.checked });

  const matches = useLoad(async () => {
    const rows = await q<Pick<EventRow, 'id' | 'type_id' | 'starts_at'>[]>(
      supabase.from('events').select('id, type_id, starts_at').eq('team_id', event.team_id).eq('type_id', event.type_id).gte('starts_at', event.starts_at).order('starts_at'));
    return sameSlotAhead(rows, event);
  }, [event.id]);
  const list = matches.data ?? [];
  const day = dayName(israelDow(event.starts_at));
  const chosen = Object.values(use).some(Boolean);
  const valid = (!use.start || !!start) && (!use.duration || (Number(duration) >= 0 && Number(duration) <= 1440 && duration.trim() !== ''));

  async function save() {
    const changes: Record<string, unknown> = {};
    if (use.start) changes.start = start;
    if (use.duration) changes.duration_min = Number(duration);
    if (use.location) changes.location = location;
    if (use.kit) changes.kit = kit;
    if (use.notes) changes.notes = notes;
    if (!confirm(`לעדכן ${list.length} אירועים (${typeLabel} בימי ${day}) ${notify ? 'ולהודיע להורים' : 'בלי הודעה'}?`)) return;
    await act.run(async () => {
      await rpc('update_events_bulk', { p_event: event.id, p_changes: changes, p_notify: notify });
      onDone();
    });
  }

  return (
    <Card title={`עריכה גורפת: כל ה${typeLabel} בימי ${day}`} actions={<button className="small secondary" onClick={onClose}>סגירה</button>}>
      <p className="muted">
        {matches.loading ? 'בודקים כמה אירועים…' : `יתעדכנו ${list.length} אירועים${list.length > 1 ? `, מ־${fmtDay(list[0].starts_at)} עד ${fmtDay(list[list.length - 1].starts_at)}` : ''}. סמנו רק את מה שרוצים לשנות.`}
      </p>
      <div className="stack">
        <label className="check"><input type="checkbox" checked={use.start} onChange={tick('start')} /> שעת התחלה</label>
        {use.start && <Field label="שעה חדשה"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>}
        <label className="check"><input type="checkbox" checked={use.duration} onChange={tick('duration')} /> משך (בדקות)</label>
        {use.duration && <Field label="משך חדש"><input type="number" min={0} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} /></Field>}
        <label className="check"><input type="checkbox" checked={use.location} onChange={tick('location')} /> מיקום</label>
        {use.location && <Field label="מיקום חדש"><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>}
        {kits.length > 0 && <label className="check"><input type="checkbox" checked={use.kit} onChange={tick('kit')} /> תלבושת</label>}
        {kits.length > 0 && use.kit && <Field label="תלבושת חדשה"><KitSelect kits={kits} value={kit} onChange={setKit} /></Field>}
        <label className="check"><input type="checkbox" checked={use.notes} onChange={tick('notes')} /> הערות</label>
        {use.notes && <Field label="הערות חדשות"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>}
        <label className="check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> להודיע להורים, לשחקנים ולצוות (הודעה אחת)</label>
        <ErrorText error={act.error} />
        <button disabled={!chosen || !valid || !list.length || act.busy} onClick={save}>{list.length ? `עדכון ${list.length} אירועים` : 'עדכון'}</button>
      </div>
    </Card>
  );
}
