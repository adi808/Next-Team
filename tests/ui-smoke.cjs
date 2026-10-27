// UI smoke test with a mocked Supabase REST API: walks the coach and parent screens and fails on runtime errors.
// Needs the app built with VITE_SUPABASE_URL=http://127.0.0.1:9 and served on :4173 (npx vite preview --port 4173).
// Run: node tests/ui-smoke.cjs coach|parent [screenshot-dir]   (playwright must be resolvable)
const { chromium } = require('playwright');
const UID = '11111111-1111-1111-1111-111111111111', TEAM = '22222222-2222-2222-2222-222222222222', CLUB = '33333333-3333-3333-3333-333333333333',
  SPORT = '44444444-4444-4444-4444-444444444444', P1 = '55555555-5555-5555-5555-555555555555', EV = '66666666-6666-6666-6666-666666666666',
  T_TRAIN = '77777777-7777-7777-7777-777777777771', T_MATCH = '77777777-7777-7777-7777-777777777772', D1 = '88888888-8888-8888-8888-888888888881',
  F11 = '99999999-9999-9999-9999-999999999991';
const mode = process.argv[2] || 'coach';
const fixtures = {
  profiles: [{ id: UID, email: 'coach@test.io', phone: null, full_name: 'מאמן בדיקה', is_system_admin: false }],
  memberships: mode === 'coach' ? [{ id: 'm1', club_id: CLUB, team_id: TEAM, role: 'coach' }] : [],
  guardianships: mode === 'parent' ? [{ player_id: P1, parent_id: UID, status: 'approved' }] : [],
  v_players: [{ id: P1, club_id: CLUB, full_name: 'דני כהן', birth_date: '2014-05-01', photo_path: null, photo_consent: false, has_account: false, is_me: false }],
  teams: [{ id: TEAM, club_id: CLUB, name: 'ילדים א', sport_id: SPORT }],
  sports: [{ id: SPORT, slug: 'football', name_he: 'כדורגל', icon_path: 'M12 2a10 10 0 1 0 0 20', sort_order: 1 }],
  team_players: [{ team_id: TEAM, player_id: P1 }],
  events: [{ id: EV, team_id: TEAM, type_id: T_MATCH, title: 'משחק ליגה', starts_at: new Date(Date.now() + 86400000).toISOString(), ends_at: null, location: 'אצטדיון', notes: '', opponent: 'הפועל', our_score: null, their_score: null }],
  lookups: [
    { id: T_TRAIN, domain: 'event_type', slug: 'training', name_he: 'אימון', parent_id: null, sport_id: null, club_id: null, sort_order: 1, meta: {}, active: true },
    { id: T_MATCH, domain: 'event_type', slug: 'match', name_he: 'משחק', parent_id: null, sport_id: null, club_id: null, sort_order: 2, meta: { is_match: true }, active: true },
    { id: F11, domain: 'match_format', slug: 'f11', name_he: '11 על 11', parent_id: null, sport_id: SPORT, club_id: null, sort_order: 1, meta: {}, active: true },
  ],
  attribute_defs: [
    { id: D1, scope: 'player', key: 'ball', label_he: 'שליטה בכדור', data_type: 'scale', config: { min: 1, max: 10 }, visible_to: ['coach', 'parent'], editable_by: ['coach'], club_id: null, team_id: TEAM, sport_id: null, sort_order: 1, active: true },
    { id: 'd2', scope: 'team', key: 'players_can_respond', label_he: 'פרופיל שחקן רשאי לאשר הגעה', data_type: 'boolean', config: { default: false }, visible_to: ['coach'], editable_by: ['coach'], club_id: null, team_id: null, sport_id: null, sort_order: 2, active: true },
    { id: 'd3', scope: 'event', key: 'match_format', label_he: 'מספר שחקנים במגרש', data_type: 'lookup', config: { domain: 'match_format' }, visible_to: ['coach', 'parent'], editable_by: ['coach'], club_id: null, team_id: null, sport_id: null, sort_order: 1, active: true },
  ],
  attribute_values: [
    { id: 'v1', seq: 1, def_id: D1, entity_id: P1, value: 7, recorded_by: UID, recorded_at: '2026-01-01T10:00:00Z' },
    { id: 'v2', seq: 2, def_id: D1, entity_id: P1, value: 8, recorded_by: UID, recorded_at: '2026-02-01T10:00:00Z' },
  ],
  tasks: [{ id: 't1', team_id: TEAM, title: 'מתיחות', description: '', due_at: null }],
  task_assignments: [{ id: 'a1', task_id: 't1', player_id: P1, kind: 'player', done_at: null }],
  surveys: [{ id: 's1', team_id: TEAM, title: 'טורניר', description: '', closes_at: null }],
  survey_questions: [{ id: 'q1', survey_id: 's1', text: 'מי מגיע?', kind: 'single', position: 1 }],
  survey_options: [{ id: 'o1', question_id: 'q1', label: 'כן', position: 1 }, { id: 'o2', question_id: 'q1', label: 'לא', position: 2 }],
  messages: [{ id: 'm1', author_id: UID, body: 'שלום', created_at: new Date().toISOString() }],
};
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
  const session = { access_token: token, refresh_token: 'r', expires_in: 86400, expires_at: exp, token_type: 'bearer', user: { id: UID, aud: 'authenticated', email: 'coach@test.io', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01' } };
  await ctx.addInitScript(([s]) => { localStorage.setItem('sb-127-auth-token', JSON.stringify(s)); }, [session]);
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('CONSOLE ' + m.text()); });
  await ctx.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url()); const name = url.pathname.split('/').pop();
    if (route.request().method() === 'POST' && url.pathname.includes('/rpc/')) return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    const rows = fixtures[name] || [];
    const single = (route.request().headers()['accept'] || '').includes('pgrst.object');
    if (single) return rows.length ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) }) : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ message: 'none', code: 'PGRST116' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
  });
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session.user) }));
  const text = async () => (await p.locator('body').innerText()).replace(/\s+/g, ' ');
  const out = (label, ok, extra = '') => console.log((ok ? 'OK   ' : 'FAIL ') + label + (extra ? ' | ' + extra : ''));
  const base = 'http://localhost:4173';
  const shot = (n) => p.screenshot({ path: `${process.argv[3] || '.'}/${mode}-${n}.png` });
  await p.goto(base + '/'); await p.waitForTimeout(1500);
  if (mode === 'coach') {
    out('lands on the coach teams page', p.url().endsWith('/m/coach/teams'), p.url());
    out('team listed', (await text()).includes('ילדים א')); await shot('teams');
    await p.click('text=ילדים א'); await p.waitForTimeout(800);
    out('squad tab shows the player', (await text()).includes('דני כהן')); await shot('squad');
    for (const tab of ['אירועים', 'משימות', 'סקרים', 'הודעות', 'הגדרות']) {
      await p.click(`role=tab[name="${tab}"]`); await p.waitForTimeout(700);
      const t = await text();
      const expect = { 'אירועים': 'משחק ליגה', 'משימות': 'מתיחות', 'סקרים': 'טורניר', 'הודעות': 'שלום', 'הגדרות': 'שליטה בכדור' }[tab];
      out(`tab ${tab}`, t.includes(expect) || tab === 'הגדרות', expect); await shot('tab-' + tab);
    }
    await p.goto(base + `/m/coach/player/${P1}`); await p.waitForTimeout(1000);
    out('player page shows rating and history', (await text()).includes('שליטה בכדור') && (await text()).includes('היסטוריה'), (await text()).slice(0, 120)); await shot('player');
    await p.goto(base + `/m/coach/event/${EV}`); await p.waitForTimeout(1000);
    out('event page shows attendance and match box', (await text()).includes('אישורי הגעה') && (await text()).includes('אירועי משחק')); await shot('event');
  } else {
    out('lands on the parent children page', p.url().endsWith('/m/parent/home'), p.url());
    for (const [path, expect] of [['home', 'דני כהן'], ['events', 'משחק ליגה'], ['tasks', 'מתיחות'], ['surveys', 'טורניר'], ['chat', 'שלום']]) {
      await p.goto(base + `/m/parent/${path}`); await p.waitForTimeout(900); out('family ' + path, (await text()).includes(expect)); await shot(path);
    }
  }
  out('no runtime errors', errors.length === 0, errors.slice(0, 3).join(' || '));
  await b.close();
})();
