// Next Team: the "league" tab. Reads the team's page on the football association site (the team's
// "league_url" parameter) and returns its league table and fixtures as JSON. The browser cannot read
// that site itself (no CORS), so this runs server side. Signed-in users only (verify_jwt), and only
// football.org.il addresses, so it is not an open proxy.
import { parseHTML } from 'npm:linkedom@0.18.5';
import { extract, isGames, isStandings, type LeagueTable } from './parse.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ALLOWED = /(^|\.)football\.org\.il$/i;
const TTL = 15 * 60_000;
const cache = new Map<string, { at: number; body: unknown }>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

function allowed(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && ALLOWED.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

async function page(url: URL) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; NextTeam/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'he-IL,he;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!allowed(res.url || url.toString())) throw new Error('redirected away from football.org.il');
  if (!res.ok) throw new Error(`the site answered ${res.status}`);
  const html = (await res.text()).slice(0, 3_000_000);
  return extract(parseHTML(html).document, res.url || url.toString());
}

const first = (tables: LeagueTable[], test: (t: LeagueTable) => boolean) => tables.find(test) ?? null;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  let raw = '';
  try { raw = String((await req.json())?.url ?? ''); } catch { /* empty body */ }
  const url = allowed(raw.trim());
  if (!url) return json(400, { error: 'צריך קישור https לאתר ההתאחדות (football.org.il)' });

  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return json(200, hit.body);

  try {
    // A team is identified by team_id and season_id, whichever of its pages was pasted: the main page
    // (team-details) carries the league table or a link to it, the games page (team-details/team-games)
    // the fixture list. Both are read; a page that fails is skipped as long as the other one answers.
    const teamId = url.searchParams.get('team_id');
    const season = url.searchParams.get('season_id');
    const pages = teamId
      ? ['/team-details/', '/team-details/team-games/'].map((path) => {
          const u = new URL(path, url.origin);
          u.searchParams.set('team_id', teamId);
          if (season) u.searchParams.set('season_id', season);
          return u;
        })
      : [url];
    const read = await Promise.allSettled(pages.map(page));
    const ok = read.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (!ok.length) throw (read[0] as PromiseRejectedResult).reason;
    const tables = ok.flatMap((p) => p.tables);
    let standings = first(tables, isStandings);
    const games = first(ok.map((p) => p.tables).reverse().flat(), isGames); // the games page first
    // The team pages may only link to the league; then the table comes from the league page.
    const leagueUrl = ok.flatMap((p) => p.leagueLinks).map(allowed).find((u): u is URL => !!u) ?? null;
    if (!standings && leagueUrl) standings = first((await page(leagueUrl)).tables, isStandings);
    const body = {
      title: ok[0].title, sourceUrl: pages[0].toString(), leagueUrl: leagueUrl?.toString() ?? null,
      teamId, standings, games, fetchedAt: new Date().toISOString(),
    };
    cache.set(key, { at: Date.now(), body });
    return json(200, body);
  } catch (e) {
    return json(502, { error: `לא הצלחנו לקרוא את דף ההתאחדות: ${(e as Error).message}` });
  }
});
