// Next Team assistant: the tools the model may call. Every call runs with the caller's own token, so row level
// security and the permission checks inside the RPCs decide what the assistant can see and do: it never has more
// rights than the person using it. Reading tools run at once; writing tools wait for the person to confirm.
import type Anthropic from 'npm:@anthropic-ai/sdk@1.1.0';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export interface Ctx {
  db: SupabaseClient;
  uid: string;
  /** teams the person belongs to in any role: coach, parent of a player, player, club admin */
  teamIds: string[];
}

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const uuid = (v: unknown) => {
  const s = str(v);
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new Error(`מזהה לא תקין: ${s || '(ריק)'}`);
  return s;
};

async function q<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data as T;
}

const lookupCache = new WeakMap<SupabaseClient, Map<string, Promise<Map<string, string>>>>();
function lookupNames(ctx: Ctx, domain: string): Promise<Map<string, string>> {
  let byDomain = lookupCache.get(ctx.db);
  if (!byDomain) lookupCache.set(ctx.db, (byDomain = new Map()));
  let p = byDomain.get(domain);
  if (!p) {
    p = q<{ id: string; name_he: string }[]>(ctx.db.from('lookups').select('id, name_he').eq('domain', domain))
      .then((rows) => new Map(rows.map((r) => [r.id, r.name_he])));
    byDomain.set(domain, p);
  }
  return p;
}

const israel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

// ---------- definitions ----------

const LISTS = ['event_type', 'absence_reason', 'cancel_reason'] as const;

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_events',
    description: 'Events (trainings, matches, ...) of the person\'s teams, sorted by start time. Use it for "when is the next training", "what is on this week" and to find an event id before any other event tool.',
    input_schema: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Only this team. Omit for all of the person\'s teams.' },
        from: { type: 'string', description: 'ISO date or date-time to start from. Default: now.' },
        to: { type: 'string', description: 'ISO date or date-time to end at. Default: 21 days after from.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'event_details',
    description: 'One event in full: place, notes, equipment, match details, who answered attending / not attending / not yet, and transport. Use it for "who is coming", "did my child answer", "is there transport".',
    input_schema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_tasks',
    description: 'Tasks assigned to the person, to their children, or (for staff) to their team, with the assignment id needed to mark one done.',
    input_schema: {
      type: 'object',
      properties: { include_done: { type: 'boolean', description: 'Also tasks already done. Default false.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_options',
    description: 'Values of a list kept in the database: event types, absence reasons, cancel reasons. Use it to get the id to pass to a writing tool.',
    input_schema: {
      type: 'object',
      properties: { list: { type: 'string', enum: [...LISTS] } },
      required: ['list'],
      additionalProperties: false,
    },
  },
  {
    name: 'team_contacts',
    description: 'Contact details (phone, email) of the club, the staff, the parents and the players of a team.',
    input_schema: {
      type: 'object',
      properties: { team_id: { type: 'string' } },
      required: ['team_id'],
      additionalProperties: false,
    },
  },
  // writing tools: the person confirms each one in the app before it runs
  {
    name: 'respond_event',
    description: 'Answer attendance for a player (a child of the person, or the person as a player): attending or not attending. Not attending needs a reason id from list_options("absence_reason"). The person confirms in the app before it is saved.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        player_id: { type: 'string' },
        status: { type: 'string', enum: ['attending', 'not_attending'] },
        reason_id: { type: 'string', description: 'Required when not attending.' },
        note: { type: 'string' },
      },
      required: ['event_id', 'player_id', 'status'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_transport_seats',
    description: 'Ask for seats on an event\'s transport: for a child (player_id), or for a staff member themself (no player_id). 0 means not interested. Only on events with transport. The person confirms in the app.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        seats: { type: 'integer', minimum: 0, maximum: 9 },
        player_id: { type: 'string' },
      },
      required: ['event_id', 'seats'],
      additionalProperties: false,
    },
  },
  {
    name: 'complete_task',
    description: 'Mark a task assignment done (or not done). The person confirms in the app.',
    input_schema: {
      type: 'object',
      properties: { assignment_id: { type: 'string' }, done: { type: 'boolean' } },
      required: ['assignment_id', 'done'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_event',
    description: 'Staff only: create one event for a team. type_id from list_options("event_type"). Times are ISO date-times with the Israel offset (+02:00 or +03:00). The person confirms in the app.',
    input_schema: {
      type: 'object',
      properties: {
        team_id: { type: 'string' },
        type_id: { type: 'string' },
        title: { type: 'string' },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        location: { type: 'string' },
        notes: { type: 'string' },
        opponent: { type: 'string', description: 'Matches only.' },
      },
      required: ['team_id', 'type_id', 'title', 'starts_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_event',
    description: 'Staff only: cancel an event. reason_id from list_options("cancel_reason"). The team is notified. The person confirms in the app.',
    input_schema: {
      type: 'object',
      properties: { event_id: { type: 'string' }, reason_id: { type: 'string' }, note: { type: 'string' } },
      required: ['event_id', 'reason_id'],
      additionalProperties: false,
    },
  },
];

export const WRITE_TOOLS = new Set(['respond_event', 'set_transport_seats', 'complete_task', 'create_event', 'cancel_event']);

// ---------- reading ----------

async function listEvents(ctx: Ctx, a: Input) {
  const teams = a.team_id ? [uuid(a.team_id)] : ctx.teamIds;
  if (!teams.length) return { events: [], note: 'לא נמצאו קבוצות של המשתמש' };
  const from = str(a.from) ? new Date(str(a.from)) : new Date();
  const to = str(a.to) ? new Date(str(a.to)) : new Date(from.getTime() + 21 * 86_400_000);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) throw new Error('תאריך לא תקין');
  const [rows, types, teamRows] = await Promise.all([
    q<Record<string, unknown>[]>(ctx.db.from('events')
      .select('id, team_id, type_id, title, starts_at, ends_at, location, opponent, our_score, their_score, has_transport, cancelled_at')
      .in('team_id', teams).gte('starts_at', from.toISOString()).lte('starts_at', to.toISOString())
      .order('starts_at').limit(40)),
    lookupNames(ctx, 'event_type'),
    q<{ id: string; name: string }[]>(ctx.db.from('teams').select('id, name').in('id', teams)),
  ]);
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
  return {
    events: rows.map((e) => ({
      id: e.id,
      team: teamName.get(e.team_id as string),
      team_id: e.team_id,
      type: types.get(e.type_id as string),
      title: e.title,
      starts: israel(e.starts_at as string),
      starts_at: e.starts_at,
      ends: israel(e.ends_at as string | null),
      location: e.location || null,
      opponent: e.opponent,
      score: e.our_score != null ? `${e.our_score}-${e.their_score}` : null,
      transport: e.has_transport,
      cancelled: !!e.cancelled_at,
    })),
  };
}

async function eventDetails(ctx: Ctx, a: Input) {
  const id = uuid(a.event_id);
  const e = await q<Record<string, unknown> | null>(ctx.db.from('events').select('*').eq('id', id).maybeSingle());
  if (!e) throw new Error('האירוע לא נמצא או שאין הרשאה לראות אותו');
  const [types, reasons, cancelReasons, roster, answers, team] = await Promise.all([
    lookupNames(ctx, 'event_type'),
    lookupNames(ctx, 'absence_reason'),
    lookupNames(ctx, 'cancel_reason'),
    q<{ player_id: string }[]>(ctx.db.from('team_players').select('player_id').eq('team_id', e.team_id as string)),
    q<{ player_id: string; status: string; reason_id: string | null; note: string }[]>(
      ctx.db.from('event_responses').select('player_id, status, reason_id, note').eq('event_id', id)),
    q<{ name: string } | null>(ctx.db.from('teams').select('name').eq('id', e.team_id as string).maybeSingle()),
  ]);
  const ids = roster.map((r) => r.player_id);
  const players = ids.length
    ? await q<{ id: string; full_name: string }[]>(ctx.db.from('v_players').select('id, full_name').in('id', ids))
    : [];
  const name = new Map(players.map((p) => [p.id, p.full_name]));
  const answered = new Map(answers.map((r) => [r.player_id, r]));
  const attending: string[] = [];
  const notAttending: { name: string; reason?: string; note?: string }[] = [];
  const noAnswer: string[] = [];
  for (const pid of ids) {
    const n = name.get(pid);
    if (!n) continue; // not visible to this person
    const r = answered.get(pid);
    if (!r) noAnswer.push(n);
    else if (r.status === 'attending') attending.push(n);
    else notAttending.push({ name: n, reason: r.reason_id ? reasons.get(r.reason_id) : undefined, note: r.note || undefined });
  }
  let transport: unknown = null;
  if (e.has_transport) {
    const { data } = await ctx.db.rpc('event_transport_list', { p_event: id });
    const seats = (data ?? []) as { name: string; seats: number }[];
    transport = { total_seats: seats.reduce((s, x) => s + (x.seats ?? 0), 0), travellers: seats.filter((s) => s.seats > 0) };
  }
  return {
    id,
    team: team?.name,
    team_id: e.team_id,
    type: types.get(e.type_id as string),
    title: e.title,
    starts: israel(e.starts_at as string),
    ends: israel(e.ends_at as string | null),
    location: e.location || null,
    notes: e.notes || null,
    equipment: (e.equipment as string[] | null)?.length ? e.equipment : null,
    opponent: e.opponent,
    score: e.our_score != null ? `${e.our_score}-${e.their_score}` : null,
    cancelled: e.cancelled_at ? { reason: cancelReasons.get(e.cancel_reason_id as string), note: e.cancel_note || null } : false,
    attendance: { attending, not_attending: notAttending, no_answer: noAnswer },
    player_ids: Object.fromEntries(players.map((p) => [p.full_name, p.id])),
    transport,
  };
}

async function listTasks(ctx: Ctx, a: Input) {
  let query = ctx.db.from('task_assignments')
    .select('id, player_id, kind, done_at, tasks!inner(title, description, due_at, team_id)')
    .limit(60);
  if (!a.include_done) query = query.is('done_at', null);
  const rows = await q<{ id: string; player_id: string; kind: string; done_at: string | null;
    tasks: { title: string; description: string; due_at: string | null; team_id: string } }[]>(query);
  const pids = [...new Set(rows.map((r) => r.player_id))];
  const players = pids.length
    ? await q<{ id: string; full_name: string }[]>(ctx.db.from('v_players').select('id, full_name').in('id', pids))
    : [];
  const name = new Map(players.map((p) => [p.id, p.full_name]));
  return {
    tasks: rows.map((r) => ({
      assignment_id: r.id,
      title: r.tasks.title,
      description: r.tasks.description || null,
      due: israel(r.tasks.due_at),
      player: name.get(r.player_id),
      for: r.kind === 'parent' ? 'ההורים' : 'השחקן',
      done: !!r.done_at,
    })),
  };
}

async function listOptions(ctx: Ctx, a: Input) {
  const list = str(a.list);
  if (!(LISTS as readonly string[]).includes(list)) throw new Error('רשימה לא מוכרת');
  const rows = await q<{ id: string; name_he: string; meta: Record<string, unknown> | null }[]>(
    ctx.db.from('lookups').select('id, name_he, meta').eq('domain', list).eq('active', true).order('sort_order'));
  return { options: rows.map((r) => ({ id: r.id, name: r.name_he, note_required: r.meta?.note_required ? true : undefined })) };
}

async function teamContacts(ctx: Ctx, a: Input) {
  const rows = await q<{ kind: string; full_name: string; email: string | null; phone: string | null; note: string | null }[]>(
    ctx.db.rpc('team_contacts', { p_team: uuid(a.team_id) }));
  return { contacts: rows.map((r) => ({ kind: r.kind, name: r.full_name, phone: r.phone, email: r.email, note: r.note || undefined })) };
}

// ---------- writing ----------

async function rpc(ctx: Ctx, name: string, args: Record<string, unknown>) {
  const { data, error } = await ctx.db.rpc(name, args);
  if (error) throw new Error(friendly(error));
  return data;
}

function friendly(e: { message: string; code?: string }) {
  const m = e.message ?? '';
  if (m.includes('the event was cancelled')) return 'האירוע בוטל, אי אפשר לאשר הגעה';
  if (m.includes('already cancelled')) return 'האירוע כבר בוטל';
  if (e.code === '42501') return 'אין למשתמש הרשאה לפעולה הזו';
  if (e.code === 'P0002') return 'לא נמצא';
  return m || 'הפעולה נכשלה';
}

async function runWrite(ctx: Ctx, name: string, a: Input): Promise<unknown> {
  switch (name) {
    case 'respond_event':
      if (a.status !== 'attending' && a.status !== 'not_attending') throw new Error('סטטוס לא תקין');
      await rpc(ctx, 'respond_event', {
        p_event: uuid(a.event_id), p_player: uuid(a.player_id), p_status: a.status,
        p_reason: a.status === 'not_attending' && a.reason_id ? uuid(a.reason_id) : null,
        p_note: a.status === 'not_attending' ? str(a.note) || null : null,
      });
      return { ok: true };
    case 'set_transport_seats':
      await rpc(ctx, 'set_transport_seats', {
        p_event: uuid(a.event_id), p_seats: Math.max(0, Math.min(9, Number(a.seats) || 0)),
        p_player: a.player_id ? uuid(a.player_id) : null, p_profile: a.player_id ? null : ctx.uid,
      });
      return { ok: true };
    case 'complete_task':
      await rpc(ctx, 'complete_assignment', { p_assignment: uuid(a.assignment_id), p_done: a.done !== false });
      return { ok: true };
    case 'create_event': {
      const id = await rpc(ctx, 'create_event', {
        p_team: uuid(a.team_id), p_type: uuid(a.type_id), p_title: str(a.title), p_starts: str(a.starts_at),
        p_ends: str(a.ends_at) || null, p_location: str(a.location), p_notes: str(a.notes), p_opponent: str(a.opponent) || null,
      });
      return { ok: true, event_id: id };
    }
    case 'cancel_event':
      await rpc(ctx, 'cancel_event', { p_event: uuid(a.event_id), p_reason: uuid(a.reason_id), p_note: str(a.note) });
      return { ok: true };
  }
  throw new Error(`כלי לא מוכר: ${name}`);
}

/** A Hebrew line the person reads before confirming a writing tool. */
export async function describeWrite(ctx: Ctx, name: string, a: Input): Promise<string> {
  const eventLabel = async (id: unknown) => {
    try {
      const e = await q<{ title: string; starts_at: string } | null>(
        ctx.db.from('events').select('title, starts_at').eq('id', uuid(id)).maybeSingle());
      return e ? `"${e.title}" (${israel(e.starts_at)})` : 'האירוע';
    } catch { return 'האירוע'; }
  };
  const playerName = async (id: unknown) => {
    try {
      const p = await q<{ full_name: string } | null>(ctx.db.from('v_players').select('full_name').eq('id', uuid(id)).maybeSingle());
      return p?.full_name ?? 'השחקן';
    } catch { return 'השחקן'; }
  };
  switch (name) {
    case 'respond_event': {
      const [ev, pl] = await Promise.all([eventLabel(a.event_id), playerName(a.player_id)]);
      if (a.status === 'attending') return `לאשר ש${pl} מגיע/ה ל${ev}`;
      const reason = a.reason_id ? (await lookupNames(ctx, 'absence_reason')).get(str(a.reason_id)) : null;
      return `לעדכן ש${pl} לא מגיע/ה ל${ev}${reason ? `, סיבה: ${reason}` : ''}${str(a.note) ? ` (${str(a.note)})` : ''}`;
    }
    case 'set_transport_seats': {
      const ev = await eventLabel(a.event_id);
      const who = a.player_id ? await playerName(a.player_id) : 'עבורך';
      const n = Number(a.seats) || 0;
      return n ? `לבקש ${n} מקומות בהסעה ל${ev} (${who})` : `לעדכן שאין צורך בהסעה ל${ev} (${who})`;
    }
    case 'complete_task':
      return a.done === false ? 'לסמן את המשימה כלא בוצעה' : 'לסמן את המשימה כבוצעה';
    case 'create_event': {
      const type = (await lookupNames(ctx, 'event_type')).get(str(a.type_id)) ?? 'אירוע';
      return `ליצור ${type}: "${str(a.title)}" ב־${israel(str(a.starts_at))}${str(a.location) ? `, ${str(a.location)}` : ''}`;
    }
    case 'cancel_event': {
      const [ev, reasons] = await Promise.all([eventLabel(a.event_id), lookupNames(ctx, 'cancel_reason')]);
      const reason = reasons.get(str(a.reason_id));
      return `לבטל את ${ev}${reason ? `, סיבה: ${reason}` : ''}. הקבוצה תקבל הודעה`;
    }
  }
  return name;
}

/** Runs one tool and returns its tool_result block. Errors go back to the model, which explains them. */
export async function runTool(ctx: Ctx, block: { id: string; name: string; input: unknown }): Promise<Anthropic.ToolResultBlockParam> {
  const a = (block.input ?? {}) as Input;
  try {
    let out: unknown;
    switch (block.name) {
      case 'list_events': out = await listEvents(ctx, a); break;
      case 'event_details': out = await eventDetails(ctx, a); break;
      case 'list_tasks': out = await listTasks(ctx, a); break;
      case 'list_options': out = await listOptions(ctx, a); break;
      case 'team_contacts': out = await teamContacts(ctx, a); break;
      default:
        if (!WRITE_TOOLS.has(block.name)) throw new Error(`כלי לא מוכר: ${block.name}`);
        out = await runWrite(ctx, block.name, a);
    }
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: block.id, content: (e as Error).message || 'שגיאה', is_error: true };
  }
}
