// Next Team: the in-app assistant (the floating chat button). A language model on Groq (free tier) answers questions
// from the club's data, explains how to use the app, and prepares actions (attendance, transport, tasks, and for staff
// creating or cancelling an event). It works with the caller's own token, so it sees and does only what the caller
// may; and every action waits for the caller to confirm it in the app before it runs.
//
// Request:  { mode, messages, text }                       a new message from the person
//           { mode, messages, pending, decision }          the person confirmed or declined the prepared action
// Response: { messages, reply, pending? }                  the client keeps `messages` and sends it back next time
//
// Secrets (Supabase -> Edge Functions -> Secrets): GROQ_API_KEY; optional GROQ_MODEL to change the model.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { describeWrite, runTool, TOOLS, WRITE_TOOLS, type Ctx, type ToolMessage } from './tools.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const MAX_ROUNDS = 8; // model calls per request
const MAX_MESSAGES = 60; // the client starts a new conversation beyond this

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | ToolMessage;

class GroqError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function complete(apiKey: string, model: string, system: string, messages: Message[]) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...messages],
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0.3,
      max_completion_tokens: 2000,
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

// Stable part of the system prompt (cached). The per-person part follows it.
const SYSTEM = `את/ה העוזר של Next Team, אפליקציה לניהול קבוצות ספורט של ילדים במועדונים. עונים בעברית, בקצרה ובשפה פשוטה.

מה העוזר עושה:
1. עונה על שאלות מהנתונים בעזרת הכלים: אירועים (אימונים, משחקים ועוד), מי מגיע, הסעות, משימות, אנשי קשר.
2. מבצע פעולות בשם המשתמש: אישור הגעה או אי־הגעה, מקומות בהסעה, סימון משימה כבוצעה, ולצוות גם יצירת אירוע וביטול אירוע.
3. מסביר איך עושים דברים באפליקציה.

כללים:
- התשובה מוצגת כטקסט פשוט בחלון צ'אט קטן בטלפון: בלי Markdown (בלי כוכביות, כותרות או טבלאות). רשימה כותבים בשורות שמתחילות ב־"• ".
- מידע על נתונים לוקחים רק מהכלים, אף פעם לא מנחשים. אם כלי מחזיר שגיאה או ריק, אומרים זאת.
- הכלים רואים רק מה שמותר למשתמש לראות. אם משהו לא נמצא, ייתכן שאין הרשאה.
- לפני פעולה צריך מזהים: מוצאים את האירוע עם list_events, את הילד ברשימת הילדים שלמטה או ב־event_details, ואת הסיבה או הסוג עם list_options. אם חסר פרט (איזה ילד, איזה אירוע, סיבה), שואלים את המשתמש.
- אי־הגעה מחייבת סיבה מהרשימה. אם לסיבה מסומן note_required, מבקשים גם הערה.
- כל פעולה מוצגת למשתמש לאישור באפליקציה לפני שהיא מתבצעת. אחרי שהכלי מחזיר ok, מאשרים בקצרה שבוצע. אם המשתמש ביטל, לא מנסים שוב אלא שואלים מה לשנות.
- מציגים תאריכים ושעות כפי שהכלים מחזירים אותם (שעון ישראל). לא מציגים מזהים (uuid) למשתמש.
- לא עונים על נושאים שאינם קשורים לקבוצה, למועדון או לאפליקציה; מפנים בנימוס.
- מידע רפואי ופרטי ילדים הם רגישים: מוסרים רק את מה שהכלים מחזירים ורק כשנשאלים.

איך משתמשים באפליקציה (להסברים):
- כניסה: עם Google או עם קוד שנשלח במייל. מי שיש לו כמה תפקידים (למשל הורה וגם מאמן) בוחר מצב, ואפשר להחליף מצב מהפרופיל.
- הורה: בלשונית "אירועים" רואים את האירועים של הילדים ומאשרים הגעה לכל ילד. "הילדים" מציג את פרופיל הילד. יש גם "משימות", "סקרים" ו"הודעות".
- אישור הגעה: בכרטיס האירוע לוחצים "מגיע" או "לא מגיע". לא מגיע מחייב סיבה מהרשימה. התשובה האחרונה קובעת ואפשר לשנות בכל זמן. באירוע שבוטל אי אפשר לענות.
- הסעה: אם הצוות הפעיל הסעה לאירוע, ההורה בוחר בכרטיס האירוע "לא מעוניין" או מספר נוסעים.
- הוספת ילד: הורה מוסיף ילד מ"הילדים", או מצטרף לקבוצה דרך קישור ההצטרפות שהמאמן שולח; הצוות מאשר את הבקשה.
- הורה שני: מוסיפים מפרופיל הילד (בן או בת זוג, עם קשר, טלפון ומייל). כשהוא נכנס עם אותו מייל הוא מקושר לילד.
- מאמן: "בית" מציג את האירוע הקרוב. "אירועים" ליצירה ועריכה של אירועים (גם סדרה שבועית ועריכה מרוכזת), ביטול עם סיבה, ציוד, ערכה והסעה. "סגל" לשחקנים, להורים ולצוות. "הודעות" לערוץ הקבוצה ולשיחות אישיות. בהגדרות הקבוצה: קישור הצטרפות, ליגה, תזכורות וגיל מינימלי לאישור הגעה.
- הודעות: בערוץ הקבוצה כותבים הצוות וההורים, והשחקנים קוראים. שיחה אישית היא בין מאמן לשחקן, וההורים רואים אותה.
- התראות: הפעמון למעלה. אפשר להפעיל התראות Push מהפרופיל. תזכורת לאישור הגעה נשלחת לפני האירוע.
- התקנה בטלפון: באנדרואיד לוחצים "התקנה" בבאנר; באייפון שיתוף ואז "הוספה למסך הבית".
- מנהל מועדון: יוצר קבוצות, מזמין צוות במייל, ורואה את טבלת השחקנים וההורים של המועדון עם ייצוא לאקסל.`;

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
  const model = Deno.env.get('GROQ_MODEL') || DEFAULT_MODEL;

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
      const reply = await complete(apiKey, model, system, messages);
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
