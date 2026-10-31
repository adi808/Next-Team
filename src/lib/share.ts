import { dayName, israelDow, israelTime } from './events';

export type ShareTemplate = 'invite' | 'reminder' | 'change' | 'cancel';

export const TEMPLATES: { id: ShareTemplate; label: string }[] = [
  { id: 'invite', label: 'הזמנה' },
  { id: 'reminder', label: 'תזכורת' },
  { id: 'change', label: 'עדכון' },
  { id: 'cancel', label: 'ביטול' },
];

export interface ShareData {
  teamName: string;
  typeLabel: string;
  isMatch: boolean;
  opponent: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  notes: string;
  kit: { name: string; shirt: string; shorts: string; socks: string } | null;
  items: string[];
}

const ZONE = 'Asia/Jerusalem';
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: ZONE });
const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: ZONE });

/** "יום ראשון, 2.11" */
export const dateLabel = (iso: string) => `יום ${dayName(israelDow(iso))}, ${dayMonth(iso)}`;

/** "17:00–18:30", or just the start. */
export const timeLabel = (d: Pick<ShareData, 'startsAt' | 'endsAt'>) =>
  d.endsAt ? `${israelTime(d.startsAt)}–${israelTime(d.endsAt)}` : israelTime(d.startsAt);

function when(iso: string): string {
  const day = ymd(new Date(iso));
  if (day === ymd(new Date())) return 'היום';
  if (day === ymd(new Date(Date.now() + 86_400_000))) return 'מחר';
  return '';
}

const title = (d: ShareData) => (d.isMatch && d.opponent ? `${d.typeLabel} – ${d.teamName} נגד ${d.opponent}` : `${d.typeLabel} – ${d.teamName}`);

/** The WhatsApp message (WhatsApp's *bold* formatting and emoji), ready to edit and send. */
export function shareText(d: ShareData, template: ShareTemplate, link: string | null): string {
  const icon = d.isMatch ? '🏆' : '⚽';
  const head = {
    invite: `${icon} *${title(d)}*`,
    reminder: `⏰ *תזכורת${when(d.startsAt) ? ` ${when(d.startsAt)}` : ''}: ${title(d)}*`,
    change: `⚠️ *עדכון: ${title(d)}*`,
    cancel: `❌ *בוטל: ${title(d)}*`,
  }[template];
  const lines = [head];
  lines.push(`📅 ${dateLabel(d.startsAt)}  |  🕔 ${timeLabel(d)}`);
  if (d.location.trim()) lines.push(`📍 ${d.location.trim()}`);
  if (template !== 'cancel') {
    if (d.kit) lines.push(`👕 תלבושת: ${d.kit.name}`);
    if (d.items.length) lines.push(`🎒 להביא: ${d.items.join(', ')}`);
    if (d.notes.trim()) lines.push(`📝 ${d.notes.trim()}`);
    if (link) lines.push(`✅ אישור הגעה: ${link}`);
  } else if (d.notes.trim()) {
    lines.push(`📝 ${d.notes.trim()}`);
  }
  return lines.join('\n');
}

const NAVY = '#1a1a8c';
const FONT = 'system-ui, -apple-system, "Segoe UI", "Heebo", "Arial", sans-serif';

export type BannerStyle = 'dark' | 'color' | 'classic';
export const BANNER_STYLES: { id: BannerStyle; label: string }[] = [
  { id: 'dark', label: 'כחול' },
  { id: 'color', label: 'צבע הקבוצה' },
  { id: 'classic', label: 'קלאסי' },
];

const HEBREW_TITLES: Record<ShareTemplate, (d: ShareData) => string> = {
  invite: (d) => (d.isMatch ? 'יום משחק' : d.typeLabel),
  reminder: (d) => `תזכורת: ${d.isMatch ? 'משחק' : d.typeLabel}`,
  change: (d) => `עדכון: ${d.isMatch ? 'משחק' : d.typeLabel}`,
  cancel: (d) => `בוטל: ${d.isMatch ? 'משחק' : d.typeLabel}`,
};

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800, italic = false) {
  let s = size;
  do { ctx.font = `${italic ? 'italic ' : ''}${weight} ${s}px ${FONT}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 16);
}

const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '?').slice(0, 2)).toUpperCase();
};

const lum = (hex: string) => {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
};
const inkOn = (hex: string) => (lum(hex) > 150 ? '#0b1535' : '#ffffff');

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A drawn football (no emoji): white ball, dark centre patch and five panels. */
function ball(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1b2440'; ctx.lineWidth = r * 0.05;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const pent = (x: number, y: number, rr: number, rot: number) => {
    ctx.beginPath();
    for (let i = 0; i < 5; i++) { const a = rot + (i * 2 * Math.PI) / 5; const px = x + rr * Math.cos(a); const py = y + rr * Math.sin(a); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fillStyle = '#1b2440'; ctx.fill();
  };
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - r * 0.025, 0, Math.PI * 2); ctx.clip();
  pent(cx, cy, r * 0.34, -Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    ctx.strokeStyle = '#1b2440'; ctx.lineWidth = r * 0.04;
    ctx.beginPath(); ctx.moveTo(cx + r * 0.34 * Math.cos(a), cy + r * 0.34 * Math.sin(a)); ctx.lineTo(cx + r * 0.66 * Math.cos(a), cy + r * 0.66 * Math.sin(a)); ctx.stroke();
    pent(cx + r * 0.9 * Math.cos(a), cy + r * 0.9 * Math.sin(a), r * 0.26, a + Math.PI / 2);
  }
  ctx.restore();
  ctx.restore();
}

/** Pitch markings as faint line art. */
function pitch(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, alpha: number) {
  ctx.save(); ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 5;
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(x + w / 2, y + h / 2, h * 0.14, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeRect(x + w * 0.25, y, w * 0.5, h * 0.16); ctx.strokeRect(x + w * 0.25, y + h * 0.84, w * 0.5, h * 0.16);
  ctx.restore();
}

/** A crest stand-in: a ring in `ring` around the club colour with the name's initials. */
function crest(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, ring: string, text: string) {
  ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(cx, cy, r + 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = inkOn(fill); fit(ctx, text, r * 1.25, r * 0.85, 900); ctx.fillText(text, cx, cy + r * 0.29);
}

/** A map pin drawn with paths. */
function pin(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save(); ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y - size * 0.35, size * 0.5, Math.PI, 0); ctx.quadraticCurveTo(x + size * 0.5, y + size * 0.1, x, y + size * 0.62);
  ctx.quadraticCurveTo(x - size * 0.5, y + size * 0.1, x - size * 0.5, y - size * 0.35); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - size * 0.35, size * 0.18, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export const BANNER_W = 1080;
export const BANNER_H = 1350;

const sizeOf = (img: CanvasImageSource) => {
  const i = img as HTMLImageElement & ImageBitmap;
  return { w: i.naturalWidth || i.width || 0, h: i.naturalHeight || i.height || 0 };
};

function heroCover(ctx: CanvasRenderingContext2D, hero: CanvasImageSource, h: number) {
  const w = sizeOf(hero).w || BANNER_W;
  const ih = sizeOf(hero).h || h;
  const scale = Math.max(BANNER_W / w, h / ih);
  ctx.drawImage(hero, (BANNER_W - w * scale) / 2, 0, w * scale, ih * scale);
}

/** Draws the event poster (4:5) in one of three styles. */
/** Panels side by side (the kids), each cropped to fill its slot, the faces kept toward the top. */
function panels(ctx: CanvasRenderingContext2D, imgs: CanvasImageSource[], h: number) {
  const gap = 6;
  const w = (BANNER_W - gap * (imgs.length - 1)) / imgs.length;
  imgs.forEach((img, i) => {
    const iw = sizeOf(img).w || w;
    const ih = sizeOf(img).h || h;
    const scale = Math.max(w / iw, h / ih);
    const sw = w / scale; const sh = h / scale;
    ctx.drawImage(img, (iw - sw) / 2, (ih - sh) * 0.15, sw, sh, i * (w + gap), 0, w, h);
  });
}

export function drawBanner(canvas: HTMLCanvasElement, d: ShareData, template: ShareTemplate, hero?: CanvasImageSource | null, style: BannerStyle = 'dark', kids: CanvasImageSource[] = []) {
  canvas.width = BANNER_W; canvas.height = BANNER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.direction = 'rtl'; ctx.textAlign = 'center';
  const W = BANNER_W; const H = BANNER_H; const mid = W / 2;
  const team = d.kit?.shirt ?? '#2563eb';
  const warn = template === 'cancel' ? '#ef4444' : template === 'change' ? '#f59e0b' : null;
  const accent = warn ?? (lum(team) > 200 ? '#2563eb' : team);
  const isMatch = d.isMatch && !!d.opponent;
  const day = when(d.startsAt) || dateLabel(d.startsAt);
  const time = timeLabel(d);
  const title = HEBREW_TITLES[template](d);

  if (style === 'classic') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = team; ctx.globalAlpha = 0.3;
    for (let x = 40; x < W; x += 62) ctx.fillRect(x, 0, 5, H);
    ctx.globalAlpha = 1;
    if (kids.length) {
      ctx.save(); panels(ctx, kids, 700);
      const fade = ctx.createLinearGradient(0, 440, 0, 740); fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(1, '#fff');
      ctx.fillStyle = fade; ctx.fillRect(0, 440, W, 300); ctx.restore();
    } else if (hero) {
      ctx.save(); heroCover(ctx, hero, 700);
      const fade = ctx.createLinearGradient(0, 440, 0, 740); fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(1, '#fff');
      ctx.fillStyle = fade; ctx.fillRect(0, 440, W, 300); ctx.restore();
    } else ball(ctx, mid, 400, 250);
    const ink = warn ?? NAVY;
    fit(ctx, d.teamName, 880, 64, 800);
    if (kids.length || hero) { const tw = Math.min(ctx.measureText(d.teamName).width + 80, 960); ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.92; rrect(ctx, mid - tw / 2, 28, tw, 100, 50); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = ink; ctx.fillText(d.teamName, mid, 96);
    ctx.direction = 'ltr'; ctx.fillStyle = ink;
    const t = template === 'change' ? 'UPDATE' : template === 'cancel' ? 'CANCELLED' : d.isMatch ? 'MATCH DAY' : 'TRAINING';
    fit(ctx, t, 900, 190, 900, true); ctx.fillText(t, mid, 800); ctx.direction = 'rtl';
    const rowY = 900;
    crest(ctx, W - 190, rowY + 90, 88, team, NAVY, initials(d.teamName));
    if (isMatch) crest(ctx, 190, rowY + 90, 88, '#fff', NAVY, initials(d.opponent)); else ball(ctx, 190, rowY + 90, 90);
    ctx.fillStyle = ink; fit(ctx, day, 420, 56, 800); ctx.fillText(day, mid, rowY + 40);
    ctx.direction = 'ltr'; fit(ctx, time, 420, 84, 900); ctx.fillText(time, mid, rowY + 125); ctx.direction = 'rtl';
    if (d.location.trim()) { fit(ctx, d.location.trim(), 420, 46, 700); ctx.fillText(d.location.trim(), mid, rowY + 190); }
    footer(ctx, d, template, rowY + 280, '#44506f', W);
    return;
  }

  if (style === 'color') {
    const base = team; const inkC = inkOn(base);
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    // darker diagonal blocks for depth
    ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.72, 0); ctx.lineTo(W * 0.32, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(W, H * 0.45); ctx.lineTo(W, H); ctx.lineTo(W * 0.5, H); ctx.fill();
    pitch(ctx, 80, 80, W - 160, H - 160, inkC, 0.12);
    if (kids.length) { ctx.save(); panels(ctx, kids, 640); const g = ctx.createLinearGradient(0, 400, 0, 680); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, base); ctx.fillStyle = g; ctx.fillRect(0, 400, W, 300); ctx.restore(); }
    else if (hero) { ctx.save(); ctx.globalAlpha = 0.9; heroCover(ctx, hero, 640); ctx.restore(); const g = ctx.createLinearGradient(0, 400, 0, 680); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, base); ctx.fillStyle = g; ctx.fillRect(0, 400, W, 300); }
    else ball(ctx, mid, 330, 190, 0.95);
    fit(ctx, d.teamName, 880, 56, 700);
    if (kids.length || hero) { const tw = Math.min(ctx.measureText(d.teamName).width + 80, 960); ctx.fillStyle = base; ctx.globalAlpha = 0.92; rrect(ctx, mid - tw / 2, 50, tw, 90, 45); ctx.fill(); ctx.globalAlpha = 1; }
    ctx.fillStyle = inkC; ctx.fillText(d.teamName, mid, 110);
    fit(ctx, title, 940, 150, 900); ctx.fillText(title, mid, 800);
    if (isMatch) { fit(ctx, `נגד ${d.opponent}`, 900, 64, 700); ctx.fillText(`נגד ${d.opponent}`, mid, 885); }
    ctx.fillStyle = inkC; ctx.fillRect(mid - 70, 925, 140, 8);
    fit(ctx, day, 900, 62, 700); ctx.fillText(day, mid, 1020);
    ctx.direction = 'ltr'; fit(ctx, time, 900, 170, 900); ctx.fillText(time, mid, 1170); ctx.direction = 'rtl';
    if (d.location.trim()) { fit(ctx, d.location.trim(), 760, 46, 600); const lw = ctx.measureText(d.location.trim()).width; pin(ctx, mid + lw / 2 + 50, 1262, 40, inkC); ctx.fillStyle = inkC; ctx.fillText(d.location.trim(), mid - 10, 1275); }
    return;
  }

  // dark
  const km = kids.length > 0;
  const L = km
    ? { hy: 318, sy: 362, bar: 280, tag: 410, crestY: 640, crestR: 85, nameY: 790, y0m: 840, y0: 560, tsize: 170, tdy: 205, locdy: 290, cancel: 130 }
    : { hy: 138, sy: 182, bar: 100, tag: 330, crestY: 600, crestR: 100, nameY: 760, y0m: 800, y0: 560, tsize: 210, tdy: 235, locdy: 335, cancel: 150 };
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H); bg.addColorStop(0, '#3d68cf'); bg.addColorStop(1, '#2447a8');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W, 760); ctx.lineTo(W * 0.35, 0); ctx.fill(); ctx.globalAlpha = 1;
  pitch(ctx, 70, 640, W - 140, 640, '#fff', 0.1);
  if (km) {
    ctx.save(); panels(ctx, kids, 400);
    const g = ctx.createLinearGradient(0, 180, 0, 405); g.addColorStop(0, 'rgba(53,92,189,0)'); g.addColorStop(1, '#355cbd');
    ctx.fillStyle = g; ctx.fillRect(0, 180, W, 225); ctx.restore();
  } else if (hero) {
    ctx.save(); heroCover(ctx, hero, 560); const g = ctx.createLinearGradient(0, 260, 0, 580); g.addColorStop(0, 'rgba(53,92,189,0)'); g.addColorStop(1, '#355cbd'); ctx.fillStyle = g; ctx.fillRect(0, 260, W, 320); ctx.restore();
  }
  ctx.fillStyle = accent; ctx.fillRect(W - 110, L.bar, 6, 70);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; fit(ctx, d.teamName, 780, 54, 800); ctx.fillText(d.teamName, W - 135, L.hy);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; fit(ctx, d.typeLabel, 600, 34, 600); ctx.fillText(d.typeLabel, W - 135, L.sy);
  ctx.textAlign = 'center';
  if (!hero && !km) ball(ctx, 190, 190, 80, 0.16);

  const tagW = 520;
  ctx.fillStyle = accent; rrect(ctx, mid - tagW / 2, L.tag, tagW, 96, 48); ctx.fill();
  ctx.fillStyle = inkOn(accent); fit(ctx, title, tagW - 60, 52, 900); ctx.fillText(title, mid, L.tag + 66);

  if (isMatch) {
    crest(ctx, W - 260, L.crestY, L.crestR, team, '#fff', initials(d.teamName));
    crest(ctx, 260, L.crestY, L.crestR, '#e5e7eb', 'rgba(255,255,255,0.4)', initials(d.opponent));
    ctx.fillStyle = '#fff'; fit(ctx, 'VS', 200, 70, 900, true); ctx.direction = 'ltr'; ctx.fillText('VS', mid, L.crestY + 25); ctx.direction = 'rtl';
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; fit(ctx, d.teamName, 300, 32, 700); ctx.fillText(d.teamName, W - 260, L.nameY);
    fit(ctx, d.opponent, 300, 32, 700); ctx.fillText(d.opponent, 260, L.nameY);
  }
  const y0 = isMatch ? L.y0m : L.y0;
  ctx.fillStyle = accent; fit(ctx, day, 900, 64, 800); ctx.fillText(day, mid, y0 + 40);
  ctx.fillStyle = '#fff'; ctx.direction = 'ltr'; fit(ctx, time, 920, L.tsize, 900); ctx.fillText(time, mid, y0 + L.tdy); ctx.direction = 'rtl';
  if (template === 'cancel') { ctx.fillStyle = '#ef4444'; ctx.fillRect(140, y0 + L.cancel, W - 280, 12); }
  if (d.location.trim()) {
    fit(ctx, d.location.trim(), 760, 48, 600); const lw = ctx.measureText(d.location.trim()).width;
    pin(ctx, mid + lw / 2 + 50, y0 + L.locdy - 15, 40, accent); ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(d.location.trim(), mid - 10, y0 + L.locdy);
  }
  footer(ctx, d, template, H - 125, 'rgba(255,255,255,0.75)', W);
}

/** Kit colours and what to bring, as one quiet line near the bottom. */
function footer(ctx: CanvasRenderingContext2D, d: ShareData, template: ShareTemplate, y: number, ink: string, W: number) {
  const parts: string[] = [];
  if (d.kit && template !== 'cancel') parts.push(`תלבושת: ${d.kit.name}`);
  if (d.items.length && template !== 'cancel') parts.push(`להביא: ${d.items.join(', ')}`);
  if (parts.length) { ctx.fillStyle = ink; fit(ctx, parts.join('   |   '), 940, 38, 600); ctx.fillText(parts.join('   |   '), W / 2, y); }
  ctx.fillStyle = ink; ctx.globalAlpha = 0.6; ctx.font = `700 28px ${FONT}`; ctx.fillText('Next Team', W / 2, BANNER_H - 44); ctx.globalAlpha = 1;
}

export const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
