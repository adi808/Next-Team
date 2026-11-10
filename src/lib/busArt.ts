import { fit, initials, inkOn, lum } from './share';
import type { Colors } from './brand';

/**
 * The team bus picture: a photo-like coach on a stadium background (public/bus, made by
 * scripts/make-bus-template.py), repainted in the kit colours, with the club logo and the team name on its side.
 */
export const BUS_W = 1400;
export const BUS_H = 700;
const K = BUS_W / 1774; // the template's spots are measured on the 1774px reference

const at = (x: number, y: number) => [x * K, y * K] as const;
const LAYOUT = {
  /** the lettering on the side, in perspective: top-left, top-right, bottom-right, bottom-left */
  text: [at(334, 494), at(727, 459), at(729, 632), at(334, 634)],
  /** the crest on the side (an ellipse: the side is seen at an angle) */
  side: { cx: 260 * K, cy: 592 * K, rx: 62 * K, ry: 103 * K },
  /** the big crest in the top corner */
  corner: { cx: 201 * K, cy: 175 * K, r: 164 * K },
};

export interface BusAssets { base: HTMLImageElement; paint: Uint8ClampedArray }

function image(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${src}`));
    img.src = src;
  });
}

let assets: Promise<BusAssets> | null = null;
/** The template, loaded once. */
export function loadBusAssets(): Promise<BusAssets> {
  assets ??= Promise.all([image('/bus/base.webp'), image('/bus/paint.webp')]).then(([base, paintImg]) => {
    const c = document.createElement('canvas');
    c.width = BUS_W; c.height = BUS_H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(paintImg, 0, 0, BUS_W, BUS_H);
    return { base, paint: ctx.getImageData(0, 0, BUS_W, BUS_H).data };
  }).catch((e) => { assets = null; throw e; });
  return assets;
}

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };

export interface BusOptions { colors: Colors; teamName: string; clubName?: string; logo?: CanvasImageSource | null }

/** Draws the bus (BUS_W x BUS_H). */
export function drawBus(canvas: HTMLCanvasElement, a: BusAssets, o: BusOptions) {
  canvas.width = BUS_W; canvas.height = BUS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(a.base, 0, 0, BUS_W, BUS_H);
  repaint(ctx, a.paint, o.colors);
  const { primary, secondary } = o.colors;
  // lettering in the second colour, as on the reference, unless it does not stand out on the body
  const ink = Math.abs(lum(primary) - lum(secondary)) > 60 ? secondary : inkOn(primary);
  lettering(ctx, o, ink);
  sideCrest(ctx, o);
  cornerCrest(ctx, o);
}

/** Main colour where the template was yellow, second colour where it was royal blue, keeping light and shade. */
function repaint(ctx: CanvasRenderingContext2D, paint: Uint8ClampedArray, colors: Colors) {
  const img = ctx.getImageData(0, 0, BUS_W, BUS_H);
  const d = img.data;
  const P = rgb(colors.primary); const S = rgb(colors.secondary);
  for (let i = 0; i < d.length; i += 4) {
    const p = paint[i] / 255; const s = paint[i + 1] / 255;
    if (p + s < 0.004) continue;
    const sh = (paint[i + 2] - 128) / 127;
    const keep = 1 - p - s;
    for (let c = 0; c < 3; c++) {
      const tp = sh >= 0 ? P[c] + (255 - P[c]) * sh : P[c] * (1 + sh);
      const ts = sh >= 0 ? S[c] + (255 - S[c]) * sh : S[c] * (1 + sh);
      d[i + c] = d[i + c] * keep + tp * p + ts * s;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Club name over team name, drawn flat and then laid onto the side in thin vertical strips (perspective). */
function lettering(ctx: CanvasRenderingContext2D, o: BusOptions, ink: string) {
  const club = (o.clubName ?? '').trim();
  const team = o.teamName.trim();
  const lines = club && !team.includes(club) ? [club, team] : [team || club];
  const OW = 900; const OH = 340;
  const off = document.createElement('canvas'); off.width = OW; off.height = OH;
  const c = off.getContext('2d')!;
  c.direction = 'rtl'; c.textAlign = 'center'; c.fillStyle = ink;
  if (lines.length === 2) {
    fit(c, lines[0], OW - 10, 190, 900); c.fillText(lines[0], OW / 2, 160);
    fit(c, lines[1], OW * 0.85, 170, 900); c.fillText(lines[1], OW / 2, 325);
  } else {
    fit(c, lines[0], OW - 10, 250, 900); c.fillText(lines[0], OW / 2, 250);
  }
  const [tl, tr, br, bl] = LAYOUT.text;
  const step = 3; const qw = tr[0] - tl[0];
  ctx.save(); ctx.globalAlpha = 0.95;
  for (let sx = 0; sx < OW; sx += step) {
    const t = sx / OW; const t2 = Math.min(1, (sx + step) / OW);
    const x = tl[0] + qw * t;
    const top = tl[1] + (tr[1] - tl[1]) * t; const bottom = bl[1] + (br[1] - bl[1]) * t;
    ctx.drawImage(off, sx, 0, step, OH, x, top, qw * (t2 - t) + 0.6, bottom - top);
  }
  ctx.restore();
}

/** The logo's centre square, squeezed into the box: on the side the bus is seen at an angle. */
function squeeze(ctx: CanvasRenderingContext2D, img: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const i = img as HTMLImageElement;
  const iw = i.naturalWidth || i.width; const ih = i.naturalHeight || i.height;
  if (!iw || !ih) return;
  const side = Math.min(iw, ih);
  ctx.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, x, y, w, h);
}

function badge(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, o: BusOptions) {
  const { primary, secondary } = o.colors;
  const ring = lum(secondary) > 200 ? primary : secondary;
  const el = (r: number) => { ctx.beginPath(); ctx.ellipse(cx, cy, rx * r, ry * r, 0, 0, Math.PI * 2); };
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 14 * K; ctx.shadowOffsetY = 4 * K;
  ctx.fillStyle = '#fff'; el(1); ctx.fill();
  ctx.restore();
  ctx.fillStyle = ring; el(0.93); ctx.fill();
  ctx.fillStyle = '#fff'; el(0.86); ctx.fill();
  ctx.save(); el(0.84); ctx.clip();
  if (o.logo) {
    squeeze(ctx, o.logo, cx - rx * 0.84, cy - ry * 0.84, rx * 1.68, ry * 1.68);
  } else {
    ctx.fillStyle = primary; ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.fillStyle = inkOn(primary); ctx.textAlign = 'center'; ctx.direction = 'rtl';
    const text = initials(o.clubName?.trim() || o.teamName);
    ctx.translate(cx, cy); ctx.scale(rx / ry, 1);
    fit(ctx, text, ry * 1.3, ry * 0.85, 900); ctx.fillText(text, 0, ry * 0.3);
  }
  ctx.restore();
  // a soft shine so it sits on the painted surface
  ctx.save(); el(1); ctx.clip();
  const g = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
  g.addColorStop(0, 'rgba(255,255,255,0.18)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = g; ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.restore();
}

function sideCrest(ctx: CanvasRenderingContext2D, o: BusOptions) {
  const { cx, cy, rx, ry } = LAYOUT.side;
  badge(ctx, cx, cy, rx, ry, o);
}

function cornerCrest(ctx: CanvasRenderingContext2D, o: BusOptions) {
  const { cx, cy, r } = LAYOUT.corner;
  badge(ctx, cx, cy, r, r, o);
}

