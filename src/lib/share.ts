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

const TITLES: Record<ShareTemplate, (d: ShareData) => string> = {
  invite: (d) => (d.isMatch ? 'MATCH DAY' : 'TRAINING DAY'),
  reminder: (d) => (d.isMatch ? 'MATCH DAY' : 'TRAINING DAY'),
  change: () => 'UPDATE',
  cancel: () => 'CANCELLED',
};

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 800, family = 'system-ui, -apple-system, "Segoe UI", "Heebo", sans-serif') {
  let s = size;
  do { ctx.font = `${weight} ${s}px ${family}`; s -= 2; } while (ctx.measureText(text).width > maxW && s > 18);
}

const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '?').slice(0, 2)).toUpperCase();
};

/** A round crest stand-in: the club colour with the name's initials. */
function crest(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, fill: string, text: string, ink: string) {
  ctx.fillStyle = fill; ctx.strokeStyle = NAVY; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = ink; fit(ctx, text, r * 1.3, r * 0.9, 900); ctx.fillText(text, cx, cy + r * 0.3);
}

export const BANNER_W = 1080;
export const BANNER_H = 1350;

/**
 * Draws the event poster (4:5) in the "match day" style: white with stripes in the team colour, an optional photo
 * on top, a big title, and a row with the team, the time and place, and the opponent.
 */
export function drawBanner(canvas: HTMLCanvasElement, d: ShareData, template: ShareTemplate, hero?: CanvasImageSource | null) {
  canvas.width = BANNER_W; canvas.height = BANNER_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const mid = BANNER_W / 2;
  const color = d.kit?.shirt ?? '#2563eb';
  const accent = template === 'cancel' ? '#b91c1c' : template === 'change' ? '#c2410c' : NAVY;
  ctx.direction = 'rtl';
  ctx.textAlign = 'center';

  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, BANNER_W, BANNER_H);
  ctx.fillStyle = color; ctx.globalAlpha = 0.35;
  for (let x = 40; x < BANNER_W; x += 62) ctx.fillRect(x, 0, 5, BANNER_H);
  ctx.globalAlpha = 1;

  // photo (cover, fading into the white) or a big ball
  const heroH = 700;
  if (hero) {
    const w = (hero as HTMLImageElement).naturalWidth ?? BANNER_W;
    const h = (hero as HTMLImageElement).naturalHeight ?? heroH;
    const scale = Math.max(BANNER_W / w, heroH / h);
    ctx.drawImage(hero, (BANNER_W - w * scale) / 2, 0, w * scale, h * scale);
    const fade = ctx.createLinearGradient(0, heroH - 260, 0, heroH + 40);
    fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(1, '#fff');
    ctx.fillStyle = fade; ctx.fillRect(0, heroH - 260, BANNER_W, 300);
  } else {
    ctx.font = '430px system-ui, sans-serif'; ctx.globalAlpha = 0.9;
    ctx.fillText(d.isMatch ? '🏆' : '⚽', mid, 570);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = accent; fit(ctx, d.teamName, 940, 64, 800); ctx.fillText(d.teamName, mid, 82);

  // title
  const title = TITLES[template](d);
  ctx.fillStyle = accent; ctx.direction = 'ltr';
  fit(ctx, title, 900, 190, 900, 'Georgia, "Times New Roman", serif');
  const lines = title.length > 10 && ctx.measureText(title).width > 700 ? title.split(' ') : [title];
  lines.forEach((ln, i) => { ctx.fillText(ln, mid, 790 + i * 150); });
  ctx.direction = 'rtl';
  const rowY = 790 + (lines.length - 1) * 150 + 130;
  if (template === 'cancel') { ctx.fillStyle = '#b91c1c'; ctx.fillRect(160, 740, BANNER_W - 320, 12); }

  // row: our team | time and place | opponent
  const x1 = BANNER_W - 190; const x2 = 190;
  const light = (() => { const n = parseInt(color.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150; })();
  crest(ctx, x1, rowY + 90, 95, color, initials(d.teamName), light ? NAVY : '#fff');
  if (d.isMatch && d.opponent) crest(ctx, x2, rowY + 90, 95, '#fff', initials(d.opponent), NAVY);
  else { ctx.fillStyle = '#fff'; ctx.strokeStyle = NAVY; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(x2, rowY + 90, 95, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.font = '110px system-ui, sans-serif'; ctx.fillText('⚽', x2, rowY + 128); }
  const day = when(d.startsAt) || dateLabel(d.startsAt);
  ctx.fillStyle = accent;
  fit(ctx, day, 420, 56, 800); ctx.fillText(day, mid, rowY + 40);
  ctx.direction = 'ltr'; fit(ctx, timeLabel(d), 420, 76, 900); ctx.fillText(timeLabel(d), mid, rowY + 120); ctx.direction = 'rtl';
  if (d.location.trim()) { fit(ctx, d.location.trim(), 420, 48, 800); ctx.fillText(d.location.trim(), mid, rowY + 185); }
  if (d.isMatch && d.opponent) { ctx.fillStyle = '#44506f'; fit(ctx, d.opponent, 250, 30, 700); ctx.fillText(d.opponent, x2, rowY + 235); }

  // kit and things to bring
  const extra = [d.kit && template !== 'cancel' ? `👕 ${d.kit.name}` : '', d.items.length && template !== 'cancel' ? `🎒 ${d.items.join(', ')}` : ''].filter(Boolean).join('   ');
  if (extra) { ctx.fillStyle = '#44506f'; fit(ctx, extra, 940, 38, 700); ctx.fillText(extra, mid, rowY + 300); }
  ctx.fillStyle = 'rgba(26,26,140,0.55)'; ctx.font = '700 30px system-ui, sans-serif'; ctx.fillText('Next Team', mid, BANNER_H - 36);
}

export const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
