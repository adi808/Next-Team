// Reads league tables and fixture lists out of a football association page (football.org.il).
// The site lays its tables out as div rows (".table_row" with ".table_col" cells, each cell carrying a
// hidden ".sr-only" label) and sometimes as plain <table>s; both are read, and the columns keep the
// site's own Hebrew labels, so nothing here depends on the exact column set.

export interface LeagueTable { title: string; columns: string[]; rows: { cells: string[]; href: string | null }[] }
export interface LeaguePage { title: string; tables: LeagueTable[]; leagueLinks: string[] }

// deno-lint-ignore no-explicit-any
type El = any;

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function absolute(href: string | null | undefined, base: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return null;
  try { return new URL(href, base).toString(); } catch { return null; }
}

/** The text of a cell without its hidden label, and the label itself. */
function cell(el: El): { label: string; value: string } {
  const labels: El[] = [...el.querySelectorAll('.sr-only, .visually-hidden')];
  const label = clean(labels.map((l) => l.textContent).join(' '));
  let value = clean(el.textContent);
  for (const l of labels) {
    const t = clean(l.textContent);
    if (t && value.startsWith(t)) value = clean(value.slice(t.length));
    else if (t) value = clean(value.replace(t, ''));
  }
  if (!value) value = clean(el.querySelector('img')?.getAttribute('alt'));
  return { label, value };
}

/** The nearest heading above a block of rows. */
function headingFor(el: El): string {
  let node = el;
  for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
    let sib = node.previousElementSibling;
    for (let n = 0; sib && n < 4; n++, sib = sib.previousElementSibling) {
      const h = sib.matches?.('h1, h2, h3, h4, h5, .title, .section-title') ? sib : sib.querySelector?.('h1, h2, h3, h4, h5');
      const t = clean(h?.textContent);
      if (t && t.length < 80) return t;
    }
  }
  return '';
}

function divTables(doc: El, base: string): LeagueTable[] {
  const groups = new Map<El, El[]>();
  for (const row of doc.querySelectorAll('.table_row')) {
    const parent = row.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent)!.push(row);
  }
  const out: LeagueTable[] = [];
  for (const [parent, rows] of groups) {
    let headerCols: string[] = [];
    let labelCols: string[] = [];
    const header = parent.querySelector?.('.table_header, .table_row_header');
    if (header) headerCols = [...header.querySelectorAll('.table_col')].map((c: El) => clean(c.textContent));
    const data: LeagueTable['rows'] = [];
    for (const row of rows) {
      const cells = [...row.querySelectorAll('.table_col')].map(cell);
      if (!cells.length) continue;
      if (/head/.test(row.getAttribute('class') ?? '')) { headerCols = cells.map((c) => c.value || c.label); continue; }
      if (!labelCols.length && cells.some((c) => c.label)) labelCols = cells.map((c) => c.label);
      const href = absolute(row.getAttribute('href') ?? row.querySelector('a[href]')?.getAttribute('href'), base);
      data.push({ cells: cells.map((c) => c.value), href });
    }
    // the hidden per-cell labels are the most reliable names; a header row is used when they are missing
    const width = data[0]?.cells.length ?? 0;
    const columns = labelCols.length === width ? labelCols : headerCols.length === width ? headerCols : labelCols.length ? labelCols : headerCols;
    if (data.length) out.push({ title: headingFor(parent), columns, rows: data });
  }
  return out;
}

function htmlTables(doc: El, base: string): LeagueTable[] {
  const out: LeagueTable[] = [];
  for (const table of doc.querySelectorAll('table')) {
    const head = [...table.querySelectorAll('thead th, thead td')];
    const trs = [...table.querySelectorAll('tr')];
    const first = trs[0];
    const columns = (head.length ? head : first ? [...first.querySelectorAll('th')] : []).map((c: El) => clean(c.textContent));
    const rows: LeagueTable['rows'] = [];
    for (const tr of trs) {
      const tds = [...tr.querySelectorAll('td')];
      if (!tds.length) continue;
      rows.push({ cells: tds.map((td: El) => cell(td).value), href: absolute(tr.querySelector('a[href]')?.getAttribute('href'), base) });
    }
    const caption = clean(table.querySelector('caption')?.textContent);
    if (rows.length) out.push({ title: caption || headingFor(table), columns, rows });
  }
  return out;
}

export function extract(doc: El, base: string): LeaguePage {
  const title = clean(doc.querySelector('h1')?.textContent) || clean(doc.querySelector('title')?.textContent);
  const tables = [...divTables(doc, base), ...htmlTables(doc, base)];
  const leagueLinks = [...new Set([...doc.querySelectorAll('a[href*="league_id="]')]
    .map((a: El) => absolute(a.getAttribute('href'), base)).filter((u: string | null): u is string => !!u))];
  return { title, tables, leagueLinks };
}

const DATE = /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/;
const isNum = (s: string) => /^\d+$/.test(s);

/** A league table: a "points" column, or rows that start with a position and end with a number. */
export function isStandings(t: LeagueTable) {
  if (t.rows.length < 3) return false;
  if (t.columns.some((c) => /נקוד|נק'|^נק/.test(c))) return true;
  const shaped = t.rows.filter((r) => r.cells.length >= 4 && isNum(r.cells[0]) && isNum(r.cells[r.cells.length - 1]));
  return shaped.length >= t.rows.length * 0.8 && !t.rows.some((r) => r.cells.some((c) => DATE.test(c)));
}

/** A fixture list: a date column, or dates in most rows. */
export function isGames(t: LeagueTable) {
  if (!t.rows.length || isStandings(t)) return false;
  if (t.columns.some((c) => /תאריך|מועד/.test(c))) return true;
  return t.rows.filter((r) => r.cells.some((c) => DATE.test(c))).length >= Math.max(1, t.rows.length * 0.6);
}
