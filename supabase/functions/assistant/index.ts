// Next Team: the in-app assistant (the floating chat button). A language model on Groq (free tier) answers questions
// from the club's data, explains how to use the app, and prepares actions (attendance, transport, tasks, and for staff
// creating or cancelling an event). It works with the caller's own token, so it sees and does only what the caller
// may; and every action waits for the caller to confirm it in the app before it runs.
//
// Request:  { mode, messages, text }                       a new message from the person
//           { mode, messages, pending, decision }          the person confirmed or declined the prepared action
// Response: { messages, reply, pending? }                  the client keeps `messages` and sends it back next time
//
// Secrets (Supabase -> Edge Functions -> Secrets): GROQ_API_KEY; optional GROQ_MODEL to change the model and
// GROQ_FALLBACK_MODELS (comma separated) for when its per-minute quota is used up.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { describeWrite, runTool, TOOLS, WRITE_TOOLS, type Ctx, type ToolMessage } from './tools.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_ROUNDS = 8; // model calls per request
const MAX_MESSAGES = 60; // the client starts a new conversation beyond this
const KEEP_TURNS = 3; // the model sees the last questions of the conversation only (free-tier token quota)
const FALLBACK_MODELS = ['llama-3.3-70b-versatile']; // tried when the main model's per-minute quota is used up

/** The tail of the conversation the model sees: from the KEEP_TURNS-th last typed question on, so tool calls stay paired. */
function recent(messages: Message[]): Message[] {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && typeof m.content === 'string' && ++seen === KEEP_TURNS) return messages.slice(i);
  }
  return messages;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Seconds Groq asks to wait in a 429 ("Please try again in 2.6s"), or null. */
const retryAfter = (msg: string) => { const m = /try again in ([\d.]+)s/.exec(msg); return m ? Number(m[1]) : null; };

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | ToolMessage;

class GroqError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** One model call; on a per-minute quota it waits a little, then tries the fallback models. */
async function complete(apiKey: string, models: string[], system: string, messages: Message[]): Promise<Message> {
  let last: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await completeOnce(apiKey, model, system, messages);
      } catch (e) {
        last = e;
        if (!(e instanceof GroqError)) throw e;
        if (e.status === 404 || (e.status === 400 && /model/i.test(e.message) && /not exist|decommission|not found/i.test(e.message))) break; // model gone: next
        if (e.status !== 429) throw e;
        const wait = retryAfter(e.message);
        if (attempt === 0 && wait != null && wait <= 12) { await sleep(wait * 1000 + 300); continue; }
        break; // a long wait: try the next model
      }
    }
  }
  throw last;
}

async function completeOnce(apiKey: string, model: string, system: string, messages: Message[]) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_completion_tokens: 800, // counts against the per-minute quota even when unused
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new GroqError(res.status, (await res.text()).slice(0, 500));
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  // keep only the fields the next request accepts
  const out: Message = { role: 'assistant', content: typeof msg.content === 'string' ? msg.content : null };
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    out.tool_calls = msg.tool_calls.map((c: ToolCall) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments || '{}' } }));
  }
  return out;
}

const args = (c: ToolCall): Record<string, unknown> => {
  try { const a = JSON.parse(c.function.arguments || '{}'); return a && typeof a === 'object' ? a : {}; } catch { return {}; }
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

const MODES: Record<string, string> = {
  sysadmin: 'מנהל מערכת', admin: 'מנהל מועדון', coach: 'מאמן / איש צוות', parent: 'הורה', player: 'שחקן',
};

// The instructions. The app guide is a tool (app_help), so it is sent only when someone asks how to do something:
// on Groq's free tier every token counts against a per-minute quota.
const SYSTEM = `את/ה העוזר של Next Team, אפליקציה לניהול קבוצות ספורט של ילדים. עונים בעברית בלבד, בקצרה ובשפה פשוטה, כטקסט פשוט בלי Markdown. רשימה: שורות שמתחילות ב־"• ".
כללים:
- כל עובדה על אירועים, לבוש, ציוד, הגעה, הסעות, משימות ואנשי קשר לוקחים רק מהכלים. לא ממציאים ולא נותנים עצות כלליות. אם הכלי לא מחזיר את המידע (למשל kit או equipment ריקים), אומרים שהצוות לא הגדיר את זה ומציעים לשאול את המאמן.
- "מה ללבוש" / "מה להביא": event_details של האירוע (kit, equipment).
- שאלות "איך עושים" באפליקציה: app_help.
- לפני פעולה מוצאים מזהים: אירוע עם list_events, ילד מרשימת הילדים למטה, סיבה או סוג עם list_options. חסר פרט? שואלים.
- כל פעולה מוצגת למשתמש לאישור. אחרי ok מאשרים בקצרה. אם המשתמש ביטל, שואלים מה לשנות.
- לא מציגים מזהים (uuid). מציגים תאריכים כפי שהכלים מחזירים.
- נושאים שלא קשורים לקבוצה או לאפליקציה: מפנים בנימוס.`;

interface PendingAction { id: string; name: string; input: Record<string, unknown>; summary: string }
interface Pending { results: ToolMessage[]; actions: PendingAction[] }

async function personContext(db: Ctx['db'], uid: string, mode: string) {
  const [profile, memberships, guardianships, players] = await Promise.all([
    db.from('profiles').select('full_name, is_system_admin').eq('id', uid).maybeSingle(),
    db.from('memberships').select('club_id, team_id, role').eq('user_id', uid),
    db.from('guardianships').select('player_id').eq('parent_id', uid).eq('status', 'approved'),
    db.from('v_players').select('id, full_name, birth_date, is_me'),
  ]);
  const ms = (memberships.data ?? []) as { club_id: string; team_id: string | null; role: string }[];
  const childIds = new Set(((guardianships.data ?? []) as { player_id: string }[]).map((g) => g.player_id));
  const all = (players.data ?? []) as { id: string; full_name: string; birth_date: string | null; is_me: boolean }[];
  const children = all.filter((p) => childIds.has(p.id));
  const me = all.find((p) => p.is_me);
  const own = [...children, ...(me ? [me] : [])].map((p) => p.id);

  const [rosterTeams, clubTeams] = await Promise.all([
    own.length ? db.from('team_players').select('team_id, player_id').in('player_id', own) : Promise.resolve({ data: [] }),
    ms.some((m) => m.role === 'club_admin')
      ? db.from('teams').select('id').in('club_id', ms.filter((m) => m.role === 'club_admin').map((m) => m.club_id))
      : Promise.resolve({ data: [] }),
  ]);
  const rt = (rosterTeams.data ?? []) as { team_id: string; player_id: string }[];
  const byMode: Record<string, string[]> = {
    coach: ms.filter((m) => m.role === 'coach' && m.team_id).map((m) => m.team_id as string),
    parent: rt.filter((r) => childIds.has(r.player_id)).map((r) => r.team_id),
    player: rt.filter((r) => r.player_id === me?.id).map((r) => r.team_id),
    admin: ((clubTeams.data ?? []) as { id: string }[]).map((t) => t.id),
  };
  // the current mode's teams first; the other roles' teams stay reachable
  const teamIds = [...new Set([...(byMode[mode] ?? []), ...Object.values(byMode).flat()])];
  const teams = teamIds.length
    ? ((await db.from('teams').select('id, name').in('id', teamIds)).data ?? []) as { id: string; name: string }[]
    : [];
  const teamName = new Map(teams.map((t) => [t.id, t.name]));

  const now = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', dateStyle: 'full', timeStyle: 'short' });
  const offset = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Jerusalem', timeZoneName: 'longOffset' })
    .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+02:00';
  const lines = [
    `עכשיו: ${now} (שעון ישראל, היסט ${offset}). ISO עכשיו: ${new Date().toISOString()}`,
    `המשתמש: ${(profile.data as { full_name?: string } | null)?.full_name || 'ללא שם'}`,
    `המצב הנוכחי באפליקציה: ${MODES[mode] ?? mode}`,
    `הקבוצות: ${teams.map((t) => `${t.name} (team_id ${t.id})`).join('; ') || 'אין'}`,
  ];
  if (byMode.coach.length) lines.push(`מאמן/צוות בקבוצות: ${byMode.coach.map((id) => teamName.get(id) ?? id).join(', ')}`);
  if (children.length) {
    lines.push(`הילדים של המשתמש: ${children.map((c) => {
      const t = rt.filter((r) => r.player_id === c.id).map((r) => teamName.get(r.team_id)).filter(Boolean).join(', ');
      return `${c.full_name} (player_id ${c.id}${t ? `, קבוצה: ${t}` : ''})`;
    }).join('; ')}`);
  }
  if (me) lines.push(`המשתמש הוא גם שחקן: ${me.full_name} (player_id ${me.id})`);
  return { teamIds, text: lines.join('\n') };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) return json(503, { error: 'העוזר עדיין לא הוגדר (חסר GROQ_API_KEY)' });
  const models = [...new Set([Deno.env.get('GROQ_MODEL') || DEFAULT_MODEL,
    ...(Deno.env.get('GROQ_FALLBACK_MODELS')?.split(',').map((m) => m.trim()).filter(Boolean) ?? FALLBACK_MODELS)])];

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: user } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!user?.user) return json(401, { error: 'יש להתחבר מחדש' });
  const uid = user.user.id;

  let body: { mode?: string; messages?: Message[]; text?: string; pending?: Pending; decision?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'בקשה לא תקינה' }); }
  const mode = String(body.mode ?? '');
  const messages: Message[] = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length > MAX_MESSAGES) return json(400, { error: 'השיחה ארוכה מדי. התחילו שיחה חדשה.' });

  const person = await personContext(db, uid, mode);
  const ctx: Ctx = { db, uid, teamIds: person.teamIds };

  if (body.pending) {
    // The person answered the confirmation card: run the actions (or not) and give the model every result.
    const last = messages[messages.length - 1];
    const asked = new Set(last?.role === 'assistant' ? (last.tool_calls ?? []).map((c) => c.id) : []);
    const actions = (body.pending.actions ?? []).filter((x) => asked.has(x.id) && WRITE_TOOLS.has(x.name));
    const results = (body.pending.results ?? []).filter((r) => asked.has(r.tool_call_id));
    if (!actions.length || results.length + actions.length !== asked.size) return json(400, { error: 'הפעולה כבר לא בתוקף' });
    // the action runs with the arguments the model gave, as stored in the conversation
    const calls = new Map(((last as { tool_calls?: ToolCall[] }).tool_calls ?? []).map((c) => [c.id, c]));
    for (const x of actions) {
      results.push(body.decision === 'confirm'
        ? await runTool(ctx, { id: x.id, name: x.name, input: args(calls.get(x.id)!) })
        : { role: 'tool', tool_call_id: x.id, content: 'המשתמש ביטל את הפעולה ולא אישר אותה.' });
    }
    messages.push(...results);
  } else {
    const text = String(body.text ?? '').trim().slice(0, 2000);
    if (!text) return json(400, { error: 'הודעה ריקה' });
    messages.push({ role: 'user', content: text });
  }

  const system = `${SYSTEM}\n\n${person.text}`;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await complete(apiKey, models, system, recent(messages));
      // models sometimes slip in a stray character from another script; the answer is Hebrew
      if (reply.role === 'assistant' && reply.content) reply.content = reply.content.replace(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, '');
      messages.push(reply);
      const calls = reply.role === 'assistant' ? reply.tool_calls ?? [] : [];
      if (!calls.length) {
        return json(200, { messages, reply: (reply.content ?? '').trim() || 'לא הצלחתי לנסח תשובה. נסו לשאול שוב.' });
      }
      const reads = calls.filter((c) => !WRITE_TOOLS.has(c.function.name));
      const writes = calls.filter((c) => WRITE_TOOLS.has(c.function.name));
      const results = await Promise.all(reads.map((c) => runTool(ctx, { id: c.id, name: c.function.name, input: args(c) })));
      if (writes.length) {
        // Stop here: the app shows the actions and sends the answer back with `pending`.
        const actions = await Promise.all(writes.map(async (c) => ({
          id: c.id, name: c.function.name, input: args(c), summary: await describeWrite(ctx, c.function.name, args(c)),
        })));
        return json(200, { messages, reply: reply.content ?? '', pending: { results, actions } satisfies Pending });
      }
      messages.push(...results);
    }
    return json(200, { messages, reply: 'זה לקח יותר מדי צעדים. נסו לשאול בצורה ממוקדת יותר.' });
  } catch (e) {
    console.error('assistant', e);
    if (e instanceof GroqError && e.status === 429) return json(429, { error: 'העוזר עמוס כרגע (הגענו למכסה החינמית). נסו שוב מאוחר יותר.' });
    if (e instanceof GroqError && (e.status === 401 || e.status === 403)) return json(503, { error: 'מפתח ה־API של העוזר לא תקין' });
    if (e instanceof GroqError && e.status === 400) return json(400, { error: 'השיחה לא תקינה. התחילו שיחה חדשה.', reset: true });
    return json(502, { error: 'העוזר לא זמין כרגע. נסו שוב.' });
  }
});
