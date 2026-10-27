import { useState } from 'react';
import { rpc, useAction } from '../lib/db';
import type { EventResponse } from '../lib/types';
import { Badge, ErrorText } from './ui';
import { LookupSelect, useLookupName, useLookups } from './Lookups';

/** Attending / not attending (with a reason from the list and a free note). The last answer wins. */
export function AttendanceWidget({ eventId, playerId, playerName, response, canAnswer, onSaved }: {
  eventId: string; playerId: string; playerName?: string; response?: EventResponse; canAnswer: boolean; onSaved: () => void;
}) {
  const reasonName = useLookupName('absence_reason');
  const reasons = useLookups('absence_reason');
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<string | null>(response?.reason_id ?? null);
  const [note, setNote] = useState(response?.note ?? '');
  const act = useAction();
  const noteRequired = !!reasons.find((r) => r.id === reason)?.meta?.note_required;

  async function send(status: 'attending' | 'not_attending') {
    await act.run(async () => {
      await rpc('respond_event', {
        p_event: eventId, p_player: playerId, p_status: status,
        p_reason: status === 'not_attending' ? reason : null, p_note: status === 'not_attending' ? note : null,
      });
      setEditing(false);
      onSaved();
    });
  }

  return (
    <div className="attend">
      {playerName && <strong>{playerName}</strong>}
      {response && !editing && (
        <span>
          {response.status === 'attending' ? <Badge tone="ok">מגיע</Badge> : <Badge tone="bad">לא מגיע · {reasonName(response.reason_id)}</Badge>}
          {response.note && <small className="muted"> {response.note}</small>}
        </span>
      )}
      {!response && !editing && <Badge>טרם נענה</Badge>}
      {canAnswer ? (
        <>
          <div className="row">
            <button className="small" disabled={act.busy} onClick={() => send('attending')}>מגיע</button>
            <button className="small secondary" disabled={act.busy} onClick={() => setEditing(true)}>לא מגיע</button>
          </div>
          {editing && (
            <div className="stack">
              <LookupSelect domain="absence_reason" value={reason} onChange={setReason} empty="סיבה…" />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה" />
              <button className="small" disabled={!reason || (noteRequired && !note.trim()) || act.busy} onClick={() => send('not_attending')}>שמירה</button>
            </div>
          )}
        </>
      ) : (
        <small className="muted">ההורה מאשר הגעה</small>
      )}
      <ErrorText error={act.error} />
    </div>
  );
}
