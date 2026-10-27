// Integration test through a real PostgREST (the API Supabase uses): signed JWTs per role, real HTTP.
// Prerequisites: a database prepared as in supabase/tests (stub_auth.sql + migrations + scenario.sql, so users and data exist)
// and PostgREST running on :3000 with the jwt-secret below. Run: node tests/api-integration.cjs
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const API = process.env.API || 'http://localhost:3000';
const psql = (sql) => execFileSync('psql', ['-h', process.env.PGHOST || '/home/pgt', '-p', process.env.PGPORT || '5544', '-U', process.env.PGUSER || 'pgt', '-At', '-F', '|', 'postgres', '-c', sql]).toString().trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (sub) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
};
const ids = Object.fromEntries(psql('select phone, id from profiles').split('\n').map((l) => l.split('|')));
const U = { S: '+972501000001', A: '+972501000002', C: '+972501000003', C2: '+972501000004', P1: '+972501000005', U2: '+972501000006', P2: '+972501000007', O: '+972501000008' };
const tok = Object.fromEntries(Object.entries(U).map(([k, ph]) => [k, sign(ids[ph])]));
async function call(who, method, path, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (who) headers.Authorization = `Bearer ${tok[who]}`;
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
let fails = 0;
const check = (label, ok, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 200) : ''}`); };
const one = (sql) => psql(sql).split('\n')[0];
const K1 = one("select id from players where full_name = 'דני כהן'"), K2 = one("select id from players where full_name = 'רוני לוי'");
const T1 = one("select id from teams where name = 'ילדים א'"), E_TRAIN = one("select id from events where title = 'אימון שני'"), E_MATCH = one("select id from events where title = 'משחק ליגה'");

(async () => {
  // schema exposure and grants
  let r = await call(null, 'GET', '/profiles'); check('anonymous gets no profiles', r.status === 200 && r.json.length === 0 || r.status >= 400, r);
  r = await call(null, 'POST', '/rpc/create_club', { p_name: 'x' }); check('anonymous cannot call RPCs', r.status >= 400, r);
  r = await call('P1', 'GET', '/players?select=*'); check('the base players table is not readable (use v_players)', r.status === 403 || r.status === 401, r);
  r = await call('P1', 'GET', '/team_people?select=*'); check('internal view team_people is not exposed', r.status >= 400, r);
  r = await call('P1', 'POST', '/rpc/claim_invites', { p_user: ids[U.P1], p_phone: U.P1 }); check('internal function claim_invites is not callable', r.status >= 400, r);

  // coach
  r = await call('C', 'GET', '/v_players?select=id,full_name,birth_date&order=full_name'); check('coach lists players with birth dates', r.status === 200 && r.json.length === 2 && r.json.every((p) => p.birth_date), r);
  r = await call('C', 'GET', `/events?team_id=eq.${T1}&select=id,title,type_id`); check('coach lists events', r.status === 200 && r.json.length === 2, r);
  r = await call('C', 'GET', '/lookups?domain=eq.event_type&select=slug,name_he&order=sort_order'); check('lookups readable (event types)', r.status === 200 && r.json.length === 3, r);
  r = await call('C', 'POST', '/rpc/create_event', { p_team: T1, p_type: one("select id from lookups where slug = 'team_building'"), p_title: 'גיבוש עונה', p_starts: new Date(Date.now() + 5 * 864e5).toISOString() });
  check('RPC with named params creates an event (returns the id)', r.status === 200 && typeof r.json === 'string', r);
  r = await call('C', 'POST', '/rpc/create_event', { p_team: T1, p_type: one("select id from lookups where slug = 'illness'"), p_title: 'x', p_starts: new Date().toISOString() });
  check('wrong catalog type is rejected with a clear error', r.status >= 400 && /event type/.test(JSON.stringify(r.json)), r);
  r = await call('C', 'GET', `/attribute_current?entity_id=eq.${K1}&select=def_id,value`); check('current attribute view works for the coach', r.status === 200 && r.json.length >= 1, r);
  r = await call('C', 'GET', `/attribute_values?entity_id=eq.${K1}&select=value,seq&order=seq.desc`); check('rating history is returned newest first', r.status === 200 && r.json.length >= 2, r);

  // parent
  r = await call('P1', 'GET', '/v_players?select=id,full_name,birth_date'); const k1 = r.json.find((p) => p.id === K1), k2 = r.json.find((p) => p.id === K2);
  check('parent sees own child with birth date and a teammate without it', r.status === 200 && k1?.birth_date && k2 && k2.birth_date === null, r.json);
  r = await call('P1', 'POST', '/rpc/respond_event', { p_event: E_TRAIN, p_player: K1, p_status: 'not_attending' }); check('not attending without a reason is rejected', r.status >= 400, r);
  r = await call('P1', 'POST', '/rpc/respond_event', { p_event: E_TRAIN, p_player: K1, p_status: 'not_attending', p_reason: one("select id from lookups where slug = 'school'"), p_note: 'מבחן' }); check('parent answers for their child', r.status === 200 || r.status === 204, r);
  r = await call('P1', 'GET', `/event_responses?event_id=eq.${E_TRAIN}&select=player_id,status,note`); check('parent sees only their own child\'s answer', r.status === 200 && r.json.length === 1 && r.json[0].player_id === K1, r);
  r = await call('P1', 'POST', '/rpc/respond_event', { p_event: E_TRAIN, p_player: K2, p_status: 'attending' }); check('parent cannot answer for another child (403)', r.status === 403, r);
  r = await call('P1', 'GET', `/attribute_values?entity_id=eq.${K2}`); check('parent sees nothing of another child\'s parameters', r.status === 200 && r.json.length === 0, r);
  r = await call('P1', 'GET', '/direct_messages?select=body'); check('parent sees the personal chat about their child', r.status === 200 && r.json.length === 2, r);
  r = await call('P1', 'POST', '/rpc/post_message', { p_team: T1, p_body: 'בדיקה דרך API' }); check('parent writes in the team channel', r.status === 200, r);

  // player
  r = await call('U2', 'POST', '/rpc/post_message', { p_team: T1, p_body: 'x' }); check('player cannot write in the team channel', r.status >= 400, r);
  r = await call('U2', 'GET', `/attribute_values?entity_id=eq.${K2}&select=def_id`); check('player sees own rating but not own medical info', r.status === 200 && r.json.length === 1, r);

  // club admin / system admin / outsiders
  r = await call('A', 'GET', '/conversations'); check('club admin sees no personal conversations', r.status === 200 && r.json.length === 0, r);
  r = await call('A', 'GET', `/event_responses?event_id=eq.${E_TRAIN}`); check('club admin sees attendance answers', r.status === 200 && r.json.length >= 1, r);
  r = await call('S', 'POST', '/rpc/create_club', { p_name: 'מועדון ב', p_admin_phone: null }); check('system admin creates a club through the API', r.status === 200, r);
  r = await call('C2', 'GET', `/events?team_id=eq.${T1}`); check('coach of another team sees no events of this team', r.status === 200 && r.json.length === 0, r);
  r = await call('O', 'GET', '/v_players'); check('outsider sees no players', r.status === 200 && r.json.length === 0, r);
  r = await call('O', 'GET', '/profiles'); check('outsider sees only their own profile', r.status === 200 && r.json.length === 1, r);
  r = await call('O', 'GET', '/messages'); check('outsider reads no messages', r.status === 200 && r.json.length === 0, r);

  console.log(fails ? `${fails} CHECKS FAILED` : 'ALL API CHECKS PASSED');
  process.exit(fails ? 1 : 0);
})();
