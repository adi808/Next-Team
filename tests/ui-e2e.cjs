// End-to-end: the built UI in a real browser against a real PostgREST + Postgres, one session per role.
// Needs: the database + PostgREST as in tests/api-integration.cjs, the UI built with
//   VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=x npx vite build
// and served on :4173 (npx vite preview --port 4173). Run: node tests/ui-e2e.cjs [screenshot-dir]
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const PGRST = process.env.API || 'http://localhost:3000';
const APP = 'http://localhost:4173';
const SHOTS = process.argv[2];
const psql = (sql) => execFileSync('psql', ['-h', process.env.PGHOST || '/home/pgt', '-p', process.env.PGPORT || '5544', '-U', process.env.PGUSER || 'pgt', '-At', '-F', '|', 'postgres', '-c', sql]).toString().trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function sign(sub) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const ids = Object.fromEntries(psql('select phone, id from profiles').split('\n').map((l) => l.split('|')));
const PHONES = { S: '+972501000001', A: '+972501000002', C: '+972501000003', P1: '+972501000005', U2: '+972501000006', O: '+972501000008' };
const K1 = psql("select id from players where full_name = 'דני כהן'"), T1 = psql("select id from teams where name = 'ילדים א'");
const E_MATCH = psql("select id from events where title = 'משחק ליגה'"), E_TRAIN = psql("select id from events where title = 'אימון שני'");

// minimal stand-in for the Supabase gateway: /rest/v1 -> PostgREST, /auth/v1 -> the current user
const gateway = http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Expose-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/rest/v1/')) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const headers = {}; for (const k of ['authorization', 'content-type', 'accept', 'prefer', 'range']) if (req.headers[k]) headers[k] = req.headers[k];
    const r = await fetch(PGRST + url.pathname.replace('/rest/v1', '') + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const out = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) out[k] = v; });
    res.writeHead(r.status, { ...out, ...cors }); return res.end(Buffer.from(await r.arrayBuffer()));
  }
  res.writeHead(200, { 'Content-Type': 'application/json', ...cors }); res.end('{}');
});

let fails = 0;
const out = (ok, label, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && extra ? ' :: ' + extra : ''}`); };

async function persona(browser, who, steps) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const exp = Math.floor(Date.now() / 1000) + 3600, id = ids[PHONES[who]], token = sign(id);
  const session = { access_token: token, refresh_token: 'r', expires_in: 3600, expires_at: exp, token_type: 'bearer', user: { id, aud: 'authenticated', phone: PHONES[who], app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } };
  await ctx.addInitScript(([s]) => localStorage.setItem('sb-127-auth-token', JSON.stringify(s)), [session]);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  // visible text plus the values of inputs and the selected option of selects (editable parameters live there)
  const text = async () => {
    const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    const fields = await p.evaluate(() => [...document.querySelectorAll('input,select,textarea')]
      .map((e) => (e.type === 'checkbox' || e.type === 'radio' || e.type === 'file' ? '' : e.tagName === 'SELECT' ? e.selectedOptions[0]?.text ?? '' : e.value)).join(' '));
    return `${body} ${fields}`;
  };
  const go = async (path) => { await p.goto(APP + path); await p.waitForTimeout(1300); };
  const has = async (label, ...needles) => { const t = await text(); const miss = needles.filter((n) => !t.includes(n)); out(!miss.length, `[${who}] ${label}`, `missing ${miss.join(', ')} in: ${t.slice(0, 160)}`); };
  const hasNot = async (label, ...needles) => { const t = await text(); const found = needles.filter((n) => t.includes(n)); out(!found.length, `[${who}] ${label}`, `unexpected ${found.join(', ')}`); };
  const shot = (n) => SHOTS && p.screenshot({ path: `${SHOTS}/${who}-${n}.png` });
  await steps({ p, go, has, hasNot, shot, text });
  out(errors.length === 0, `[${who}] no runtime errors`, errors.slice(0, 2).join(' || '));
  await ctx.close();
}

(async () => {
  await new Promise((r) => gateway.listen(54321, '127.0.0.1', r));
  const browser = await chromium.launch();

  await persona(browser, 'C', async ({ p, go, has, hasNot, shot }) => {
    await go('/'); out(p.url().endsWith('/m/coach/teams'), '[C] coach lands on their teams', p.url());
    await has('team list', 'ילדים א'); await shot('teams');
    await p.click('text=ילדים א'); await p.waitForTimeout(1200);
    await has('squad shows both players', 'דני כהן', 'רוני לוי'); await shot('squad');
    for (const [tab, needles] of [['אירועים', ['משחק ליגה', 'אימון שני']], ['משימות', ['מתיחות', '100 הרמות כדור']], ['סקרים', ['מי מגיע לטורניר?']], ['הודעות', ['ברוכים הבאים', 'מי מסיע בשבת?']], ['הגדרות', ['שליטה בכדור', 'גיל מינימלי']]]) {
      await p.click(`role=tab[name="${tab}"]`); await p.waitForTimeout(1000); await has(`tab ${tab}`, ...needles); await shot('tab-' + tab);
    }
    await go(`/m/coach/player/${K1}`); await has('player: rating with history and medical info', 'שליטה בכדור', 'היסטוריה', 'אלרגיה', 'בוטנים'); await shot('player');
    await go(`/m/coach/event/${E_MATCH}`); await has('match: attendance, statistics and format', 'אישורי הגעה', 'אירועי משחק', 'שער', 'הפועל', 'מספר שחקנים במגרש'); await shot('match');
    await go(`/m/coach/event/${E_TRAIN}`); await has('training: attendance with the reason', 'לימודים'); await hasNot('training has no match box', 'אירועי משחק');
  });

  await persona(browser, 'P1', async ({ p, go, has, hasNot, shot }) => {
    await go('/'); out(p.url().endsWith('/m/parent/home'), '[P1] parent lands on the children page', p.url());
    await has('own child only', 'דני כהן'); await hasNot('no other child', 'רוני לוי'); await shot('home');
    await go('/m/parent/events'); await has('events with attendance buttons', 'אימון שני', 'משחק ליגה', 'מגיע'); await shot('events');
    await p.locator('.card', { hasText: 'משחק ליגה' }).getByRole('button', { name: 'מגיע', exact: true }).click(); await p.waitForTimeout(1200);
    out(psql(`select status from event_responses where event_id = '${E_MATCH}' and player_id = '${K1}'`) === 'attending', '[P1] clicking "מגיע" saved an answer in the database');
    await go('/m/parent/tasks'); await has('tasks for me and my child', 'מתיחות', '100 הרמות כדור'); await shot('tasks');
    await go('/m/parent/surveys'); await has('survey', 'מי מגיע לטורניר?', 'כן'); await shot('surveys');
    await go('/m/parent/chat'); await has('team channel and the personal chat entry', 'מי מסיע בשבת?', 'שיחות אישיות');
    await p.getByRole('button', { name: 'פתיחה' }).first().click(); await p.waitForTimeout(1000); await has('personal conversation about my child', 'כל הכבוד על האימון'); await shot('chat');
    const before = Number(psql("select count(*) from messages where body = 'הודעה מהממשק'"));
    await p.fill('input[placeholder="כתבו הודעה…"] >> nth=0', 'הודעה מהממשק'); await p.locator('form.composer button').first().click(); await p.waitForTimeout(1200);
    out(Number(psql("select count(*) from messages where body = 'הודעה מהממשק'")) === before + 1, '[P1] a parent posted in the team channel through the UI');
    await go(`/m/parent/player/${K1}`); await has('child page: medical info and rating', 'בוטנים', 'שליטה בכדור', 'הסכמה להצגת תמונה'); await shot('child');
  });

  await persona(browser, 'U2', async ({ p, go, has, hasNot, shot }) => {
    await go('/'); out(p.url().endsWith('/m/player/home'), '[U2] player lands on their profile', p.url());
    await has('own profile', 'רוני לוי'); await go('/m/player/events'); await has('player sees events', 'אימון שני'); await shot('events');
    await go('/m/player/chat'); await has('player reads the channel', 'ברוכים הבאים', 'שחקנים קוראים בלבד'); await go('/m/player/tasks'); await has('player sees only their own task', '100 הרמות כדור'); await hasNot('player does not see a task given to someone else', 'מתיחות');
  });

  await persona(browser, 'A', async ({ p, go, has, shot }) => {
    await go('/'); out(p.url().endsWith('/m/admin/clubs'), '[A] club admin lands on clubs', p.url());
    await has('club list', 'מועדון א'); await p.click('text=מועדון א'); await p.waitForTimeout(1200); await has('club teams', 'ילדים א', 'נוער כדורסל'); await shot('club');
    await go('/m/admin/lists'); await has('lists screen', 'סוגי אירוע', 'אימון', 'גיבוש'); await shot('lists');
  });

  await persona(browser, 'S', async ({ p, go, has, shot }) => {
    await go('/'); out(p.url().endsWith('/m/sysadmin/clubs'), '[S] system admin lands on clubs', p.url());
    await has('club creation form', 'מועדון חדש', 'מועדון א'); await shot('clubs');
  });

  await persona(browser, 'O', async ({ go, has, hasNot }) => {
    await go('/'); await has('outsider is told they have no membership', 'עדיין אין לכם שיוך'); await hasNot('outsider sees no club data', 'דני כהן', 'ילדים א');
  });

  await browser.close(); gateway.close();
  console.log(fails ? `${fails} E2E CHECKS FAILED` : 'ALL E2E CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})();
