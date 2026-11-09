import { dayName } from './events';
import { BANNER_H, BANNER_W, FONT, ball, fit, inkOn, lum, pin, pitch, rrect } from './share';
import { shade, type Colors } from './brand';

const ZONE = 'Asia/Jerusalem';

/** "YYYY-MM-DD" of an instant in Israel. */
export const ymdIL = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: ZONE });

/** The seven days (Sunday to Saturday, "YYYY-MM-DD") of this week in Israel, moved by `offset` weeks. */
export function weekDays(offset = 0, now = new Date()): string[] {
  const [y, m, d] = ymdIL(now).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(y, m - 1, d - dow + offset * 7 + i)).toISOString().slice(0, 10));
}

/**
 * A query window around the week, a day wider on each side so that every instant of the Israeli week is in it
 * whatever the offset from UTC; the rows are then kept by their Israeli date.
 */
export function weekWindow(days: string[]): { from: string; to: string } {
  const from = new Date(`${days[0]}T00:00:00Z`); from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${days[6]}T23:59:59Z`); to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** "8/11" */
export const shortDate = (ymd: string) => { const [, m, d] = ymd.split('-').map(Number); return `${d}/${m}`; };
/** "יום ראשון" */
export const dayTitle = (ymd: string) => `יום ${dayName(new Date(`${ymd}T12:00:00Z`).getUTCDay())}`;
/** "8/11–14/11" */
export const weekLabel = (days: string[]) => `\u200E${shortDate(days[0])}–${shortDate(days[6])}`; // LRM: keeps the dates left to right in Hebrew text

export interface WeekItem {
  day: string;
  typeLabel: string;
  /** "נגד מכבי חיפה", a title, or empty */
  heading: string;
  time: string;
  location: string;
  kitName: string;
  colors: Colors;
  cancelled: boolean;
  transport: boolean;
}

export interface WeekPoster {
  title: string;
  subtitle: string;
  range: string;
  items: WeekItem[];
  equipment: string[];
  colors: Colors;
}

const MAX_CARDS = 9;

/** The week as one poster (4:5): a card per event like a printed schedule, the kit, and what to bring. */
export function drawWeek(canvas: HTMLCanvasElement, d: WeekPoster, logo?: CanvasImageSource | null) {
  canvas.width = BANNER_W; canvas.height = BANNER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const W = BANNER_W; const H = BANNER_H; const mid = W / 2;
  ctx.direction = 'rtl'; ctx.textAlign = 'center';
  const main = lum(d.colors.primary) > 185 ? d.colors.secondary : d.colors.primary;
  const accent = d.colors.primary === main ? d.colors.secondary : d.colors.primary;

  // background: the team colour, a lighter diagonal, pitch lines
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H);
  bg.addColorStop(0, shade(main, 0.15)); bg.addColorStop(1, shade(main, -0.35));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.08; ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, 700); ctx.lineTo(W * 0.3, 0); ctx.fill(); ctx.globalAlpha = 1;
  pitch(ctx, 60, 60, W - 120, H - 120, '#fff', 0.06);
  ball(ctx, 120, 150, 70, 0.18);

  // header: logo, team, "this week's schedule", dates
  const ink = inkOn(main);
  if (logo) {
    ctx.save(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W - 130, 140, 86, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 130, 140, 78, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(logo, W - 208, 62, 156, 156); ctx.restore();
  }
  const hx = logo ? mid - 70 : mid;
  const hw = logo ? 760 : 960;
  ctx.fillStyle = ink; fit(ctx, d.title, hw, 74, 900); ctx.fillText(d.title, hx, 120);
  const sub = `${d.subtitle} · ${d.range}`;
  ctx.fillStyle = accent === main ? '#fff' : accent; fit(ctx, sub, hw - 40, 46, 800);
  const sw = Math.min(ctx.measureText(sub).width + 70, hw);
  ctx.save(); ctx.fillStyle = '#0b1535'; ctx.globalAlpha = 0.55; rrect(ctx, hx - sw / 2, 152, sw, 74, 37); ctx.fill(); ctx.restore();
  ctx.fillStyle = lum(accent) > 60 ? accent : '#fff'; ctx.fillText(sub, hx, 204);

  const items = d.items.slice(0, MAX_CARDS);
  const top = 280; const bottom = d.equipment.length ? 1130 : 1220;
  if (!items.length) {
    ctx.fillStyle = ink; fit(ctx, 'אין אירועים השבוע', 900, 70, 800); ctx.fillText('אין אירועים השבוע', mid, (top + bottom) / 2);
  }
  const n = items.length;
  const cols = n <= 3 ? Math.max(n, 1) : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols) || 1;
  const gap = 24; const left = 50; const width = W - 100;
  const cw = (width - gap * (cols - 1)) / cols;
  const ch = Math.min(480, (bottom - top - gap * (rows - 1)) / rows);
  const y0 = top + (bottom - top - (rows * ch + gap * (rows - 1))) / 2;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols); const c = i % cols;
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * cw + (inRow - 1) * gap;
    const x = left + (width - rowW) / 2 + (inRow - 1 - c) * (cw + gap); // right to left
    const y = y0 + r * (ch + gap);
    card(ctx, it, x, y, cw, ch);
  });
  if (d.items.length > MAX_CARDS) {
    ctx.fillStyle = ink; ctx.font = `700 30px ${FONT}`; ctx.fillText(`ועוד ${d.items.length - MAX_CARDS} אירועים באפליקציה`, mid, bottom + 6);
  }

  if (d.equipment.length) {
    const ey = 1170; const text = `ציוד: ${d.equipment.join(' · ')}`;
    ctx.fillStyle = '#fff'; rrect(ctx, 50, ey - 50, W - 100, 92, 30); ctx.fill();
    ctx.fillStyle = '#0b1535'; fit(ctx, text, W - 160, 40, 800); ctx.fillText(text, mid, ey + 8);
  }
  ctx.fillStyle = ink; ctx.globalAlpha = 0.6; ctx.font = `700 28px ${FONT}`; ctx.fillText('Next Team', mid, H - 44); ctx.globalAlpha = 1;
}

/** One event: a band in its kit colour with the day and date, then the kind, the time, the place and the kit. */
function card(ctx: CanvasRenderingContext2D, it: WeekItem, x: number, y: number, w: number, h: number) {
  const s = Math.min(1, h / 480, w / 320);
  const band = Math.max(90, h * 0.26);
  const { primary, secondary } = it.colors;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fff'; rrect(ctx, x, y, w, h, 28); ctx.fill();
  ctx.restore();
  ctx.save(); rrect(ctx, x, y, w, h, 28); ctx.clip();
  ctx.fillStyle = primary; ctx.fillRect(x, y, w, band);
  ctx.fillStyle = secondary; ctx.fillRect(x, y + band - 10, w, 10);
  ctx.restore();
  ctx.strokeStyle = secondary; ctx.lineWidth = 5; rrect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, 26); ctx.stroke();

  const cx = x + w / 2; const bInk = inkOn(primary);
  ctx.fillStyle = bInk;
  fit(ctx, dayTitle(it.day), w - 40, 44 * s + 6, 900); ctx.fillText(dayTitle(it.day), cx, y + band * 0.45);
  ctx.direction = 'ltr'; fit(ctx, shortDate(it.day), w - 40, 50 * s + 8, 900); ctx.fillText(shortDate(it.day), cx, y + band * 0.84); ctx.direction = 'rtl';

  const ph = Math.max(34, 46 * s);
  const pillCount = it.cancelled ? 0 : [it.kitName, it.transport].filter(Boolean).length;
  const sizes = [it.typeLabel && 40, it.heading && 30, 56, it.location && 30].filter((v): v is number => !!v);
  const need = sizes.reduce((a, b) => a + b * 1.3, 0) * s;
  const room = h - band - 24 - pillCount * (ph + 10);
  const k = Math.min(1, room / need) * s;
  let ty = y + band + 6;
  const line = (text: string, size: number, weight: number, color: string) => {
    if (!text) return;
    ty += size * k * 1.3;
    ctx.fillStyle = color; fit(ctx, text, w - 36, Math.round(size * k), weight); ctx.fillText(text, cx, ty - size * k * 0.2);
  };
  line(it.typeLabel, 40, 900, '#0b1535');
  line(it.heading, 30, 700, '#334155');
  ctx.direction = 'ltr'; line(it.time, 56, 900, '#0b1535'); ctx.direction = 'rtl';
  if (it.location) {
    const size = 30 * k; ty += size * 1.3;
    ctx.font = `700 ${Math.round(size)}px ${FONT}`; fit(ctx, it.location, w - 90, Math.round(size), 700);
    const lw = ctx.measureText(it.location).width;
    pin(ctx, cx + lw / 2 + 18, ty - size * 0.55, size * 0.95, lum(primary) > 185 ? secondary : primary);
    ctx.fillStyle = '#334155'; ctx.fillText(it.location, cx - 8, ty - size * 0.2);
  }
  if (it.cancelled) {
    ctx.save(); ctx.translate(cx, y + band + (h - band) / 2); ctx.rotate(-0.25);
    ctx.fillStyle = 'rgba(239,68,68,0.9)'; rrect(ctx, -w * 0.42, -34, w * 0.84, 68, 14); ctx.fill();
    ctx.fillStyle = '#fff'; fit(ctx, 'בוטל', w * 0.7, 46, 900); ctx.fillText('בוטל', 0, 16); ctx.restore();
    return;
  }
  const pills = [it.kitName && { text: it.kitName, bg: primary, fg: inkOn(primary), edge: secondary }, it.transport && { text: '🚌 הסעה', bg: '#0b1535', fg: '#fff', edge: '#0b1535' }]
    .filter((p): p is { text: string; bg: string; fg: string; edge: string } => !!p);
  let py = y + h - 18 - ph;
  for (const p of pills.reverse()) {
    if (py < ty - 4) break;
    ctx.font = `800 ${Math.round(ph * 0.55)}px ${FONT}`;
    const pw = Math.min(w - 40, ctx.measureText(p.text).width + 44);
    ctx.fillStyle = p.bg; rrect(ctx, cx - pw / 2, py, pw, ph, ph / 2); ctx.fill();
    ctx.strokeStyle = p.edge; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = p.fg; fit(ctx, p.text, pw - 24, Math.round(ph * 0.55), 800); ctx.fillText(p.text, cx, py + ph * 0.7);
    py -= ph + 10;
  }
}
