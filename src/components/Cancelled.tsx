import { useState } from 'react';
import { rpc, useAction } from '../lib/db';
import type { EventRow } from '../lib/types';
import { Badge, ErrorText, Field } from './ui';
import { LookupSelect, useLookupName, useLookups } from './Lookups';

export const isCancelled = (e: Pick<EventRow, 'cancelled_at'>) => !!e.cancelled_at;

/** Small "בוטל" badge for event lists. */
export function CancelledBadge({ event }: { event: Pick<EventRow, 'cancelled_at'> }) {
  return isCancelled(event) ? <Badge tone="bad">בוטל</Badge> : null;
}

/** The banner on a cancelled event: reason and note, and for staff a way back. */
export function CancelledBanner({ event, canManage, onChanged }: { event: EventRow; canManage?: boolean; onChanged?: () => void }) {
  const reasonName = useLookupName('cancel_reason');
  const act = useAction();
  if (!isCancelled(event)) return null;
  return (
    <div className="notice cancelled-banner" role="status">
      <strong>❌ האירוע בוטל</strong>
      <p>
        {reasonName(event.cancel_reason_id) || 'ללא סיבה'}
        {event.cancel_note ? ` · ${event.cancel_note}` : ''}
      </p>
      {canManage && (
        <button className="small secondary" disabled={act.busy}
          onClick={() => act.run(async () => { await rpc('restore_event', { p_event: event.id }); onChanged?.(); })}>
          ↩️ ביטול הביטול: האירוע מתקיים
        </button>
      )}
      <ErrorText error={act.error} />
    </div>
  );
}

/** Staff: cancel an event with a reason from the list (and a note); the team is told by push or email. */
export function CancelEventBox({ event, onClose, onDone }: { event: EventRow; onClose: () => void; onDone: () => void }) {
  const reasons = useLookups('cancel_reason');
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const act = useAction();
  const needsNote = !!reasons.find((r) => r.id === reason)?.meta?.note_required;
  const ready = !!reason && (!needsNote || !!note.trim());
  return (
    <div className="card stack">
      <h3>ביטול האירוע</h3>
      <p className="muted">האירוע יישאר בלוח, מסומן כמבוטל. השחקנים, ההורים והצוות יקבלו הודעה, ומי שלא הפעיל התראות יקבל מייל.</p>
      <Field label="סיבה"><LookupSelect domain="cancel_reason" value={reason} onChange={setReason} empty="בחרו סיבה…" /></Field>
      <Field label={needsNote ? 'פירוט' : 'פירוט (לא חובה)'}><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="row">
        <button className="danger" disabled={!ready || act.busy}
          onClick={() => act.run(async () => { await rpc('cancel_event', { p_event: event.id, p_reason: reason, p_note: note.trim() }); onDone(); })}>
          ביטול האירוע ושליחת הודעה
        </button>
        <button className="secondary" onClick={onClose}>חזרה</button>
      </div>
      <ErrorText error={act.error} />
    </div>
  );
}
