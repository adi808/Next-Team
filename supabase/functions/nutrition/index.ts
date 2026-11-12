// Next Team: nutrition tips for a child (the "nutrition" tab). A language model on Groq (free tier) writes
//   * plan:   what to eat today, following the day (match / training / rest from the child's schedule), the age
//             and the allergies on the child's profile: before and after the activity, drinks, one tip;
//   * review: feedback on "what did you eat today?": a compliment when it was good, and what to improve.
// Only a parent of the child or the child may ask (checked by the database with the caller's own token), and the
// answers are kept for them only. No weight and no calories, and every answer says it is not medical advice.
//
// Request:  { player_id, day: 'YYYY-MM-DD', action: 'plan' | 'review', text? }
// Response: { entry: { id, kind, day, input, output } }
// Secrets: GROQ_API_KEY (shared with the assistant); optional GROQ_MODEL, GROQ_FALLBACK_MODELS.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const FALLBACK_MODELS = ['llama-3.3-70b-versatile'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

class GroqError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryAfter = (msg: string) => { const m = /try again in ([\d.]+)s/.exec(msg); return m ? Number(m[1]) : null; };

async function ask(apiKey: string, models: string[], system: string, user: string): Promise<Record<string, unknown>> {
  let last: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model, temperature: 0.5, max_completion_tokens: 900,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          }),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new GroqError(res.status, (await res.text()).slice(0, 500));
        const data = await res.json();
        const text = String(data.choices?.[0]?.message?.content ?? '');
        const start = text.indexOf('{'); const end = text.lastIndexOf('}');
        return JSON.parse(text.slice(start, end + 1));
      } catch (e) {
        last = e;
        if (e instanceof SyntaxError) continue; // not JSON: ask again
        if (!(e instanceof GroqError)) throw e;
        if (e.status === 404 || (e.status === 400 && /model/i.test(e.message) && /not exist|decommission|not found/i.test(e.message))) break;
        if (e.status !== 429) throw e;
        const wait = retryAfter(e.message);
        if (attempt === 0 && wait != null && wait <= 12) { await sleep(wait * 1000 + 300); continue; }
        break;
      }
    }
  }
  throw last;
}

const RULES = `את/ה תזונאי/ת ספורט ידידותי/ת לילדים ולהורים, באפליקציה Next Team. כותבים בעברית פשוטה וחמה, פונים לילד בגוף שני.
כללים קבועים:
- בלי משקל, בלי קלוריות, בלי דיאטה, בלי תוספי תזונה ומשקאות אנרגיה. מדברים על אוכל אמיתי, גיוון, שתייה ותזמון.
- מתאימים לגיל: כמויות ותזמון של ילד בגיל הזה, לא של מבוגר.
- אלרגיות: אסור להציע שום מזון שמכיל את מה שמופיע באלרגיות, גם לא כחלופה.
- משפטים קצרים. בלי Markdown, בלי אימוג'י בתוך הטקסט.
- coach_tips הם הנחיות של המאמן לקבוצה ליום הזה: משלבים אותן בהמלצה (ובמשוב בודקים אם הילד עשה אותן), בלי לסתור אותן.
- מחזירים JSON בלבד, בדיוק במבנה שמבוקש.`;

const PLAN = `כתוב/כתבי המלצת תזונה ליום הזה. סוג היום נקבע לפי האירועים: משחק (is_match) > אימון > מנוחה. אם מחר בבוקר יש משחק, להתייחס לארוחת הערב.
JSON:
{"day_type":"match|training|rest","headline":"משפט פתיחה מעודד","meals":[{"when":"בוקר|לפני|אחרי|צהריים|ערב|ביניים","time":"שעה משוערת או ריק","ideas":"מה לאכול, 1-2 משפטים"}],"before":["2-4 טיפים לפני הפעילות"],"after":["2-4 טיפים אחרי"],"drink":"מה ומתי לשתות","tip":"טיפ אחד קטן להיום"}
ביום מנוחה before ו־after ריקים, ו־meals מתארות יום רגיל ומגוון. 4-6 ארוחות.`;

const REVIEW = `הילד סיפר מה אכל היום. תן/תני משוב.
JSON:
{"verdict":"great|good|improve","compliment":"מחמאה כנה על מה שהיה טוב (תמיד יש משהו)","good":["מה היה טוב"],"improve":["1-3 שיפורים קטנים ומעשיים, לפי סוג היום"],"next":"מה כדאי לאכול בארוחה הבאה"}
great = יום מאוזן ומתאים לפעילות; good = טוב עם מקום לשיפור קטן; improve = חסר משהו חשוב (למשל לא אכל לפני משחק, או בלי ירקות ופירות בכלל, או בלי שתייה).
אם הטקסט לא מתאר אוכל, החזר verdict "good", מחמאה כללית, ו־improve עם בקשה לספר מה אכל.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) return json(503, { error: 'העוזר עדיין לא הוגדר (חסר GROQ_API_KEY)' });
  const models = [...new Set([Deno.env.get('GROQ_MODEL') || DEFAULT_MODEL,
    ...(Deno.env.get('GROQ_FALLBACK_MODELS')?.split(',').map((m) => m.trim()).filter(Boolean) ?? FALLBACK_MODELS)])];

  const auth = req.headers.get('Authorization') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: user } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''));
  if (!user?.user) return json(401, { error: 'יש להתחבר מחדש' });

  let body: { player_id?: string; day?: string; action?: string; text?: string };
  try { body = await req.json(); } catch { return json(400, { error: 'בקשה לא תקינה' }); }
  const action = body.action === 'review' ? 'review' : 'plan';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day)) ? String(body.day) : '';
  const text = String(body.text ?? '').trim().slice(0, 2000);
  if (!body.player_id || !day) return json(400, { error: 'בקשה לא תקינה' });
  if (action === 'review' && !text) return json(400, { error: 'ספרו מה אכלתם היום' });

  // the database checks that the caller is a parent of the child or the child
  const { data: ctx, error } = await db.rpc('nutrition_context', { p_player: body.player_id, p_day: day });
  if (error) return json(error.code === '42501' ? 403 : 400, { error: error.code === '42501' ? 'אין הרשאה' : error.message });

  const about = `היום: ${day}\nהילד: ${JSON.stringify(ctx)}`;
  let output: Record<string, unknown>;
  try {
    output = action === 'plan'
      ? await ask(apiKey, models, `${RULES}\n\n${PLAN}`, about)
      : await ask(apiKey, models, `${RULES}\n\n${REVIEW}`, `${about}\n\nמה אכלתי היום:\n${text}`);
  } catch (e) {
    console.error('nutrition', e);
    if (e instanceof GroqError && e.status === 429) return json(429, { error: 'העוזר עמוס כרגע (הגענו למכסה החינמית). נסו שוב מאוחר יותר.' });
    return json(502, { error: 'העוזר לא זמין כרגע. נסו שוב.' });
  }
  const { data: id, error: saveError } = await db.rpc('save_nutrition_entry', {
    p_player: body.player_id, p_day: day, p_kind: action, p_input: action === 'review' ? text : '', p_output: output,
  });
  if (saveError) return json(400, { error: saveError.message });
  return json(200, { entry: { id, kind: action, day, input: action === 'review' ? text : '', output, created_at: new Date().toISOString() } });
});
