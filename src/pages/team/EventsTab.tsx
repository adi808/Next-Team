import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDate } from '../../lib/db';
import { applyEventDefaults } from '../../lib/team';
import { Badge, Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import { LookupSelect, useLookups } from '../../components/Lookups';
import type { EventRow } from '../../lib/types';
import type { TeamTabProps } from './TeamPage';

export default function EventsTab({ team, canManage }: TeamTabProps) {
  const types = useLookups('event_type', { includeInactive: true });
  const { data, loading, error, reload } = useLoad(
    () => q<EventRow[]>(supabase.from('events').select('*').eq('team_id', team.id).order('starts_at', { ascending: false })),
    [team.id],
  );
  const [typeId, setTypeId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [starts, setStarts] = useState('');
  const [location, setLocation] = useState('');
  const [opponent, setOpponent] = useState('');
  const act = useAction();
  const isMatch = (id: string | null) => !!types.find((t) => t.id === id)?.meta?.is_match;
  const typeName = (id: string) => types.find((t) => t.id === id)?.name_he ?? '';

  async function create() {
    await act.run(async () => {
      const id = await rpc<string>('create_event', {
        p_team: team.id, p_type: typeId, p_title: title, p_starts: new Date(starts).toISOString(),
        p_location: location, p_opponent: isMatch(typeId) ? opponent || null : null,
      });
      if (isMatch(typeId)) await applyEventDefaults(id, team.id).catch(() => {});
      setTitle(''); setStarts(''); setLocation(''); setOpponent(''); reload();
    });
  }

  return (
    <>
      <Loading loading={loading} error={error} />
      {data && !data.length && <Empty>אין עדיין אירועים.</Empty>}
      <ul className="list">
        {data?.map((e) => (
          <li key={e.id} className="row">
            <Badge>{typeName(e.type_id)}</Badge>
            <Link to={`../event/${e.id}`}>{e.title || typeName(e.type_id)}</Link>
            <small className="muted">{fmtDate(e.starts_at)}{e.opponent ? ` · נגד ${e.opponent}` : ''}</small>
            {e.our_score !== null && <strong>{e.our_score}:{e.their_score}</strong>}
          </li>
        ))}
      </ul>
      {canManage && (
        <Card title="אירוע חדש">
          <Field label="סוג"><LookupSelect domain="event_type" value={typeId} onChange={setTypeId} /></Field>
          <Field label="כותרת (לא חובה)"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="מתי"><input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} /></Field>
          <Field label="מיקום"><input value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
          {isMatch(typeId) && <Field label="יריבה"><input value={opponent} onChange={(e) => setOpponent(e.target.value)} /></Field>}
          <ErrorText error={act.error} />
          <button disabled={!typeId || !starts || act.busy} onClick={create}>יצירת אירוע</button>
        </Card>
      )}
    </>
  );
}
