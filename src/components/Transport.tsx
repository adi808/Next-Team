import { q, rpc, useAction, useLoad } from '../lib/db';
import { isDemo, supabase } from '../lib/supabase';
import type { EventResponse, EventRow, Player } from '../lib/types';
import { Badge, Card, Empty, ErrorText } from './ui';

interface Seat { player_id: string | null; profile_id: string | null; name: string; role: string; staff_label: string | null; seats: number }

const MAX = 20;

/** Seats for one traveller: "not interested" or the number of passengers. Saving 0 means not interested. */
function SeatPicker({ seats, busy, onSave }: { seats: number | null; busy: boolean; onSave: (n: number) => void }) {
  const n = seats ?? 0;
  return (
    <div className="seat-picker">
      <div className="chips">
        <button className={seats === 0 ? 'on' : ''} disabled={busy} onClick={() => onSave(0)}>לא מעוניין</button>
        <button className={n > 0 ? 'on' : ''} aria-pressed={n > 0} disabled={busy} onClick={() => { if (!n) onSave(1); }}>צריך הסעה</button>
      </div>
      {n > 0 && (
        <div className="stepper">
          <span className="muted">כמות נוסעים</span>
          <button className="small secondary" disabled={busy || n <= 1} onClick={() => onSave(n - 1)} aria-label="פחות">−</button>
          <output aria-label="כמות נוסעים">{n}</output>
          <button className="small secondary" disabled={busy || n >= MAX} onClick={() => onSave(n + 1)} aria-label="יותר">+</button>
        </div>
      )}
    </div>
  );
}

/**
 * Transport (הסעה) for an event. Staff turn it on; then each parent answers for their child "not interested" or
 * how many passengers (the child and anyone travelling with them), and staff answer for themselves.
 * Everyone on the team sees the total; staff also see who answered what.
 */
export function TransportCard({ event, players = [], responses, myKids, canManage, isStaff, myId, onToggled }: {
  event: EventRow; players?: Player[]; responses: EventResponse[]; myKids: Player[]; canManage: boolean;
  /** the viewer is on the team's staff (coach / club admin), so has a seat row of their own */
  isStaff: boolean; myId: string; onToggled: () => void;
}) {
  // The answers are part of the key: changing one reloads the seats (the server clears them when a child is marked not coming).
  const answers = responses.filter((r) => r.event_id === event.id).map((r) => `${r.player_id}:${r.status}`).sort().join(',');
  const list = useLoad(() => (event.has_transport ? rpc<Seat[]>('event_transport_list', { p_event: event.id }) : Promise.resolve([])),
    [event.id, event.has_transport, answers]);
  const act = useAction();
  if (!event.has_transport && !canManage) return null;

  const rows = list.data ?? [];
  const total = rows.reduce((s, r) => s + r.seats, 0);
  const seatsOf = (playerId: string | null, profileId: string | null) =>
    rows.find((r) => (playerId ? r.player_id === playerId : r.profile_id === profileId))?.seats ?? null;
  const answerOf = (pid: string) => responses.find((r) => r.event_id === event.id && r.player_id === pid)?.status;
  const save = (n: number, player: string | null, profile: string | null) => act.run(async () => {
    await rpc('set_transport_seats', { p_event: event.id, p_seats: n, p_player: player, p_profile: profile });
    list.reload();
  });
  const toggle = (on: boolean) => act.run(async () => { await rpc('set_event_transport', { p_event: event.id, p_enabled: on }); onToggled(); });

  if (!event.has_transport) {
    return (
      <Card title="הסעה">
        <p className="muted">אפשר להציע הסעה לאירוע. ההורים יענו לכל ילד "לא מעוניין" או כמה נוסעים.</p>
        <button disabled={act.busy} onClick={() => toggle(true)}>🚌 הוספת אפשרות להסעה</button>
        <ErrorText error={act.error} />
      </Card>
    );
  }

  const answered = rows.filter((r) => r.role === 'player');
  const waiting = players.filter((p) => answerOf(p.id) === 'attending' && !answered.some((r) => r.player_id === p.id));
  return (
    <Card title="🚌 הסעה" actions={canManage && (
      <button className="small secondary" disabled={act.busy} onClick={() => { if (confirm('לבטל את ההסעה לאירוע? התשובות יישמרו.')) toggle(false); }}>ביטול הסעה</button>
    )}>
      <div className="transport-total"><strong>{total}</strong><span>נוסעים בהסעה</span></div>
      {myKids.map((k) => (
        <div key={k.id} className="transport-row">
          <strong>{k.full_name}</strong>
          {answerOf(k.id) === 'attending'
            ? <SeatPicker seats={seatsOf(k.id, null)} busy={act.busy} onSave={(n) => save(n, k.id, null)} />
            : <small className="muted">{answerOf(k.id) === 'not_attending' ? 'לא מגיע לאירוע, אין הסעה' : 'אפשר לבקש הסעה אחרי שמסמנים שהילד מגיע'}</small>}
        </div>
      ))}
      {isStaff && (
        <div className="transport-row">
          <strong>אני (צוות)</strong>
          <SeatPicker seats={seatsOf(null, myId)} busy={act.busy} onSave={(n) => save(n, null, myId)} />
        </div>
      )}
      {canManage && (
        <>
          <h4 className="section-title">מי נוסע</h4>
          {!rows.length && <Empty>עדיין אין תשובות.</Empty>}
          <ul className="list compact">
            {rows.map((r) => (
              <li key={r.player_id ?? r.profile_id} className="row">
                <span className="grow">{r.name}{r.role !== 'player' && <small className="muted"> · {r.staff_label || 'צוות'}</small>}</span>
                {r.seats ? <Badge tone="ok">{r.seats} נוסעים</Badge> : <Badge>לא מעוניין</Badge>}
              </li>
            ))}
          </ul>
          {waiting.length > 0 && <p className="muted">טרם ענו: {waiting.map((p) => p.full_name).join(', ')}</p>}
        </>
      )}
      <ErrorText error={act.error ?? list.error} />
    </Card>
  );
}

/** Total passengers per event, for the events with transport turned on (one query for all of them). */
export function useTransportTotals(events: EventRow[]): Map<string, number> {
  const ids = events.filter((e) => e.has_transport).map((e) => e.id);
  const { data } = useLoad(
    () => (isDemo || !ids.length ? Promise.resolve([]) : q<{ event_id: string; seats: number }[]>(supabase.from('event_transport').select('event_id, seats').in('event_id', ids))),
    [ids.join(',')],
  );
  const totals = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const r of data ?? []) totals.set(r.event_id, (totals.get(r.event_id) ?? 0) + r.seats);
  return totals;
}

/** "🚌 7 נוסעים" next to an event that offers transport. */
export function TransportChip({ total }: { total: number | undefined }) {
  if (total === undefined) return null;
  return <Badge tone={total > 0 ? 'ok' : undefined}>🚌 {total > 0 ? `${total} נוסעים` : 'הסעה'}</Badge>;
}
