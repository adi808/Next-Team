// Next Team assistant: the tools the model may call. Every call runs with the caller's own token, so row level
// security and the permission checks inside the RPCs decide what the assistant can see and do: it never has more
// rights than the person using it. Reading tools run at once; writing tools wait for the person to confirm.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';

export interface Ctx {
  db: SupabaseClient;
  uid: string;
  /** teams the person belongs to in any role: coach, parent of a player, player, club admin */
  teamIds: string[];
}

type Input = Record<string, unknown>;

/** A tool in the OpenAI-compatible format Groq takes. */
export interface ToolDef { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }
/** The answer to one tool call, as a `tool` message. */
export interface ToolMessage { role: 'tool'; tool_call_id: string; content: string }
const def = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
  ({ type: 'function', function: { name, description, parameters } });
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

/** A Hebrew name for a kit colour (#rrggbb), the nearest of a small palette. */
const COLORS: [string, number, number, number][] = [
  ['לבן', 255, 255, 255], ['שחור', 0, 0, 0], ['אפור', 128, 128, 128], ['אדום', 220, 30, 40], ['בורדו', 120, 20, 40],
  ['כתום', 245, 130, 20], ['צהוב', 250, 215, 30], ['ירוק', 30, 150, 60], ['ירוק בהיר', 140, 210, 80], ['תכלת', 110, 180, 235],
  ['כחול', 30, 80, 200], ['כחול כהה', 15, 30, 90], ['סגול', 120, 50, 160], ['ורוד', 240, 120, 170], ['חום', 120, 75, 40],
];
export function colorName(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!m) return hex;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  let best = COLORS[0], bestD = Infinity;
  for (const c of COLORS) {
    const d = (c[1] - r) ** 2 + (c[2] - g) ** 2 + (c[3] - b) ** 2;
    if (d < bestD) { best = c; bestD = d; }
  }
  return best[0];
}

/** How to use the app: returned by the app_help tool only when asked, so it does not weigh on every request. */
const APP_HELP = `- כניסה: עם Google או עם קוד שנשלח במייל. מי שיש לו כמה תפקידים (למשל הורה וגם מאמן) בוחר מצב, ואפשר להחליף מצב מהפרופיל.
- הורה: בלשונית "אירועים" רואים את האירועים של הילדים ומאשרים הגעה לכל ילד. "הילדים" מציג את פרופיל הילד. יש גם "משימות", "סקרים" ו"הודעות".
- אישור הגעה: בכרטיס האירוע לוחצים "מגיע" או "לא מגיע". לא מגיע מחייב סיבה מהרשימה. התשובה האחרונה קובעת ואפשר לשנות בכל זמן. באירוע שבוטל אי אפשר לענות.
- לבוש וציוד: בכרטיס האירוע מופיעים הערכה (חולצה, מכנסיים, גרביים) והציוד להביא, אם הצוות הגדיר אותם.
- הסעה: אם הצוות הפעיל הסעה לאירוע, ההורה בוחר בכרטיס האירוע "לא מעוניין" או מספר נוסעים.
- הוספת ילד: הורה מוסיף ילד מ"הילדים", או מצטרף לקבוצה דרך קישור ההצטרפות שהמאמן שולח; הצוות מאשר את הבקשה.
- הורה שני: מוסיפים מפרופיל הילד (בן או בת זוג, עם קשר, טלפון ומייל). כשהוא נכנס עם אותו מייל הוא מקושר לילד.
- מאמן: "בית" מציג את האירוע הקרוב. "אירועים" ליצירה ועריכה של אירועים (גם סדרה שבועית ועריכה מרוכזת), ביטול עם סיבה, ציוד, ערכה והסעה. "סגל" לשחקנים, להורים ולצוות. "הודעות" לערוץ הקבוצה ולשיחות אישיות. בהגדרות הקבוצה: קישור הצטרפות, ליגה, תזכורות וגיל מינימלי לאישור הגעה.
- הודעות: בערוץ הקבוצה כותבים הצוות וההורים, והשחקנים קוראים. שיחה אישית היא בין מאמן לשחקן, וההורים רואים אותה.
- התראות: הפעמון למעלה. אפשר להפעיל התראות Push מהפרופיל. תזכורת לאישור הגעה נשלחת לפני האירוע.
- התקנה בטלפון: באנדרואיד לוחצים "התקנה" בבאנר; באייפון שיתוף ואז "הוספה למסך הבית".
- מנהל מועדון: יוצר קבוצות, מזמין צוות במייל, ורואה את טבלת השחקנים וההורים של המועדון עם ייצוא לאקסל.`;

// ---------- definitions ----------

const LISTS = ['event_type', 'absence_reason', 'cancel_reason'] as const;

export const TOOLS: ToolDef[] = [
  def('list_events', 'Upcoming events of the person\'s teams (default: next 21 days), with ids.', {
    type: 'object',
    properties: {
      team_id: { type: 'string' },
      from: { type: 'string', description: 'ISO date' },
      to: { type: 'string', description: 'ISO date' },
    },
    additionalProperties: false,
  }),
  def('event_details', 'One event in full: place, notes, kit to wear, equipment to bring, attendance answers, transport.', {
    type: 'object',
    properties: { event_id: { type: 'string' } },
    required: ['event_id'],
    additionalProperties: false,
  }),
  def('list_tasks', 'Open tasks of the person, their children or their team, with assignment ids.', {
    type: 'object',
    properties: { include_done: { type: 'boolean', description: 'Also tasks already done. Default false.' } },
    additionalProperties: false,
  }),
  def('list_options', 'Ids and names of a list: event types, absence reasons, cancel reasons.', {
    type: 'object',
    properties: { list: { type: 'string', enum: [...LISTS] } },
    required: ['list'],
    additionalProperties: false,
  }),
  def('team_contacts', 'Phones and emails of a team\'s club, staff, parents and players.', {
    type: 'object',
    properties: { team_id: { type: 'string' } },
    required: ['team_id'],
    additionalProperties: false,
  }),
  def('team_roster', 'The squad of a team: how many players, their names and ages, and the staff with their roles.', {
    type: 'object',
    properties: { team_id: { type: 'string' } },
    required: ['team_id'],
    additionalProperties: false,
  }),
  def('weather', 'Weather forecast (Open-Meteo) for an event, at its place and hours, up to 15 days ahead. Or for a place and ISO date.', {
    type: 'object',
    properties: { event_id: { type: 'string' }, place: { type: 'string' }, date: { type: 'string', description: 'ISO date' } },
    additionalProperties: false,
  }),
  def('app_help', 'How to do things in the app (screens, buttons, joining, installing). Use for how-to questions.', {
    type: 'object', properties: {}, additionalProperties: false,
  }),
  // writing tools: the person confirms each one in the app before it runs
  def('respond_event', 'Answer attendance for a player. not_attending needs reason_id (absence_reason). The person confirms in the app.', {
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
  }),
  def('set_transport_seats', 'Transport seats for a child (player_id) or for staff themself. 0 = not interested. The person confirms in the app.', {
    type: 'object',
    properties: {
      event_id: { type: 'string' },
      seats: { type: 'integer', minimum: 0, maximum: 9 },
      player_id: { type: 'string' },
    },
    required: ['event_id', 'seats'],
    additionalProperties: false,
  }),
  def('complete_task', 'Mark a task assignment done or not. The person confirms in the app.', {
    type: 'object',
    properties: { assignment_id: { type: 'string' }, done: { type: 'boolean' } },
    required: ['assignment_id', 'done'],
    additionalProperties: false,
  }),
  def('create_event', 'Staff: create an event. Times are ISO with the Israel offset. The person confirms in the app.', {
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
  }),
  def('cancel_event', 'Staff: cancel an event (reason_id from cancel_reason). The person confirms in the app.', {
    type: 'object',
    properties: { event_id: { type: 'string' }, reason_id: { type: 'string' }, note: { type: 'string' } },
    required: ['event_id', 'reason_id'],
    additionalProperties: false,
  }),
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
      .order('starts_at').limit(15)),
    lookupNames(ctx, 'event_type'),
    q<{ id: string; name: string }[]>(ctx.db.from('teams').select('id, name').in('id', teams)),
  ]);
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]));
  return {
    events: rows.map((e) => ({
      id: e.id,
      team: teams.length > 1 ? teamName.get(e.team_id as string) : undefined,
      type: types.get(e.type_id as string),
      title: e.title,
      starts: israel(e.starts_at as string),
      location: e.location || undefined,
      opponent: e.opponent || undefined,
      score: e.our_score != null ? `${e.our_score}-${e.their_score}` : undefined,
      transport: e.has_transport || undefined,
      cancelled: e.cancelled_at ? true : undefined,
    })),
  };
}

async function eventDetails(ctx: Ctx, a: Input) {
  const id = uuid(a.event_id);
  const e = await q<Record<string, unknown> | null>(ctx.db.from('events').select('*').eq('id', id).maybeSingle());
  if (!e) throw new Error('האירוע לא נמצא או שאין הרשאה לראות אותו');
  const [types, reasons, cancelReasons, roster, answers, team, equipmentNames, kit] = await Promise.all([
    lookupNames(ctx, 'event_type'),
    lookupNames(ctx, 'absence_reason'),
    lookupNames(ctx, 'cancel_reason'),
    q<{ player_id: string }[]>(ctx.db.from('team_players').select('player_id').eq('team_id', e.team_id as string)),
    q<{ player_id: string; status: string; reason_id: string | null; note: string }[]>(
      ctx.db.from('event_responses').select('player_id, status, reason_id, note').eq('event_id', id)),
    q<{ name: string } | null>(ctx.db.from('teams').select('name').eq('id', e.team_id as string).maybeSingle()),
    lookupNames(ctx, 'equipment'),
    e.kit_id
      ? q<{ name: string; shirt: string; shorts: string; socks: string } | null>(
        ctx.db.from('team_kits').select('name, shirt, shorts, socks').eq('id', e.kit_id as string).maybeSingle())
      : Promise.resolve(null),
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
    // what to wear and bring: only what the staff set; null means they set nothing
    kit: kit ? { name: kit.name, shirt: colorName(kit.shirt), shorts: colorName(kit.shorts), socks: colorName(kit.socks) } : null,
    equipment: ((e.equipment as string[] | null) ?? []).map((id) => equipmentNames.get(id)).filter(Boolean),
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

async function teamRoster(ctx: Ctx, a: Input) {
  const team = uuid(a.team_id);
  const [roster, staff, roles] = await Promise.all([
    q<{ player_id: string }[]>(ctx.db.from('team_players').select('player_id').eq('team_id', team)),
    q<{ full_name: string; staff_role_id: string | null }[]>(ctx.db.rpc('team_staff', { p_team: team })),
    lookupNames(ctx, 'staff_role'),
  ]);
  const ids = roster.map((r) => r.player_id);
  const players = ids.length
    ? await q<{ full_name: string; birth_date: string | null }[]>(
      ctx.db.from('v_players').select('full_name, birth_date').in('id', ids).order('full_name'))
    : [];
  const age = (b: string | null) => {
    if (!b) return undefined;
    const d = new Date(b), now = new Date();
    let y = now.getFullYear() - d.getFullYear();
    if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) y--;
    return y;
  };
  return {
    // players this person may see; a parent may see only part of the squad
    players_count: ids.length,
    players: players.map((p) => ({ name: p.full_name, age: age(p.birth_date) })),
    staff: staff.map((m) => ({ name: m.full_name, role: m.staff_role_id ? roles.get(m.staff_role_id) : 'צוות' })),
  };
}

// Weather from Open-Meteo (free, no key), as the event card shows it.
const WEATHER_CODES: [number[], string][] = [
  [[0], 'בהיר'], [[1, 2], 'מעונן חלקית'], [[3], 'מעונן'], [[45, 48], 'ערפל'], [[51, 53, 55, 56, 57], 'טפטוף'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'גשם'], [[71, 73, 75, 77, 85, 86], 'שלג'], [[95, 96, 99], 'סופת רעמים'],
];
const weatherText = (code: number) => WEATHER_CODES.find(([c]) => c.includes(code))?.[1] ?? 'מעונן';

async function geocode(location: string): Promise<{ lat: number; lon: number; name: string } | null> {
  // the whole text, then each comma-separated part from the end (the town is usually last)
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  for (const name of [location.trim(), ...parts.reverse()]) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=he&format=json&name=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(8000) });
    const hit = (await r.json())?.results?.[0];
    if (hit) return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
  }
  return null;
}

async function weather(ctx: Ctx, a: Input) {
  let place = str(a.place), start: Date, end: Date | null = null;
  if (a.event_id) {
    const e = await q<{ location: string; starts_at: string; ends_at: string | null } | null>(
      ctx.db.from('events').select('location, starts_at, ends_at').eq('id', uuid(a.event_id)).maybeSingle());
    if (!e) throw new Error('האירוע לא נמצא');
    place = place || e.location;
    start = new Date(e.starts_at);
    end = e.ends_at ? new Date(e.ends_at) : null;
  } else {
    start = str(a.date) ? new Date(str(a.date)) : new Date();
  }
  if (!place) throw new Error('לאירוע אין מיקום, אז אין תחזית. אפשר לשאול על עיר מסוימת.');
  if (isNaN(start.getTime())) throw new Error('תאריך לא תקין');
  const ahead = start.getTime() - Date.now();
  if (ahead > 15 * 86_400_000) return { note: 'התחזית זמינה רק עד 15 יום קדימה' };
  if (ahead < -86_400_000) return { note: 'האירוע כבר עבר' };
  const pos = await geocode(place);
  if (!pos) throw new Error(`לא מצאתי את המקום "${place}" במפה`);
  const ymd = start.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}`
    + `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m`
    + `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code`
    + `&timezone=Asia%2FJerusalem&start_date=${ymd}&end_date=${ymd}`, { signal: AbortSignal.timeout(8000) });
  const w = await r.json();
  if (!w?.hourly) throw new Error('שירות מזג האוויר לא ענה');
  const hourOf = (d: Date) => Number(d.toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }));
  // hours: the event's hours (start to end, or two hours), or from a time given with the date; none for a whole day
  const withTime = !!a.event_id || /T\d/.test(str(a.date));
  const hours = [];
  if (withTime) {
    const from = hourOf(start);
    const to = Math.min(23, end ? Math.max(from, hourOf(end)) : from + 2);
    for (let h = from; h <= to; h++) {
      hours.push({ hour: `${String(h).padStart(2, '0')}:00`, temp: Math.round(w.hourly.temperature_2m[h]),
        rain_chance: w.hourly.precipitation_probability[h] ?? 0, sky: weatherText(w.hourly.weather_code[h]),
        wind_kmh: Math.round(w.hourly.wind_speed_10m[h]) });
    }
  }
  return {
    place: pos.name,
    date: israel(start.toISOString())?.split(',').slice(0, 2).join(','),
    day: { min: Math.round(w.daily.temperature_2m_min[0]), max: Math.round(w.daily.temperature_2m_max[0]),
      rain_chance: w.daily.precipitation_probability_max[0] ?? 0, sky: weatherText(w.daily.weather_code[0]) },
    hours: withTime ? hours : undefined,
  };
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

/** Runs one tool and returns its `tool` message. Errors go back to the model, which explains them. */
export async function runTool(ctx: Ctx, block: { id: string; name: string; input: Input }): Promise<ToolMessage> {
  const a = block.input ?? {};
  try {
    let out: unknown;
    switch (block.name) {
      case 'list_events': out = await listEvents(ctx, a); break;
      case 'event_details': out = await eventDetails(ctx, a); break;
      case 'list_tasks': out = await listTasks(ctx, a); break;
      case 'list_options': out = await listOptions(ctx, a); break;
      case 'team_contacts': out = await teamContacts(ctx, a); break;
      case 'team_roster': out = await teamRoster(ctx, a); break;
      case 'weather': out = await weather(ctx, a); break;
      case 'app_help': out = APP_HELP; break;
      default:
        if (!WRITE_TOOLS.has(block.name)) throw new Error(`כלי לא מוכר: ${block.name}`);
        out = await runWrite(ctx, block.name, a);
    }
    return { role: 'tool', tool_call_id: block.id, content: JSON.stringify(out) };
  } catch (e) {
    return { role: 'tool', tool_call_id: block.id, content: `שגיאה: ${(e as Error).message || 'הפעולה נכשלה'}` };
  }
}
