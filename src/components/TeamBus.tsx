import { useEffect, useRef, useState } from 'react';
import { useSignedUrl } from './Picture';
import { BUS_H, BUS_W, drawBus, loadBusAssets } from '../lib/busArt';
import { canvasBlob } from '../lib/share';
import type { Colors } from '../lib/brand';

function loadLogo(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export interface BusArt { teamName: string; clubName?: string; logoPath?: string | null; colors: Colors }

/**
 * Draws the team bus into a canvas once the template (and the club logo) are in, and redraws when the colours or
 * names change. Returns the canvas (for the share banner) and a PNG data URL to show; both null until ready or
 * when the template cannot load.
 */
export function useBusArt(art: BusArt | null) {
  const logoUrl = useSignedUrl('club-media', art?.logoPath);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [state, setState] = useState<{ canvas: HTMLCanvasElement; url: string } | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!logoUrl) { setLogo(null); return; }
    let cancelled = false;
    loadLogo(logoUrl).then((img) => { if (!cancelled) setLogo(img); });
    return () => { cancelled = true; };
  }, [logoUrl]);

  const key = art ? [art.teamName, art.clubName, art.colors.primary, art.colors.secondary].join('|') : '';
  useEffect(() => {
    if (!art) { setState(null); return; }
    let cancelled = false;
    loadBusAssets().then((assets) => {
      if (cancelled) return;
      const c = canvas.current ?? (canvas.current = document.createElement('canvas'));
      drawBus(c, assets, { ...art, logo });
      let url: string;
      try { url = c.toDataURL('image/jpeg', 0.9); } catch {
        // a logo the browser will not let us export: draw the bus without it
        drawBus(c, assets, { ...art, logo: null });
        url = c.toDataURL('image/jpeg', 0.9);
      }
      setState({ canvas: c, url });
    }, () => { if (!cancelled) setState(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, logo]);
  return state;
}

/**
 * The team bus: a photo-like coach on a stadium background, painted in the event's kit colours (body in the shirt
 * colour, swoosh and brush strokes in the second colour), with the club logo and the team name on its side.
 */
export function TeamBus({ teamName, clubName, logoPath, colors, count }: BusArt & {
  /** passengers so far, shown on the picture */
  count?: number;
}) {
  const bus = useBusArt({ teamName, clubName, logoPath, colors });
  const [error, setError] = useState<string | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function file() {
    const blob = bus ? await canvasBlob(bus.canvas) : null;
    return blob ? new File([blob], 'team-bus.png', { type: 'image/png' }) : null;
  }
  async function share() {
    setError(null);
    const f = await file();
    if (!f) return;
    try {
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] });
      else download();
    } catch (e) { if ((e as Error).name !== 'AbortError') setError('השיתוף לא הצליח, אפשר להוריד את התמונה'); }
  }
  async function download() {
    const f = await file();
    if (!f) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = 'next-team-bus.png'; a.click();
  }

  return (
    <figure className="team-bus">
      {bus
        ? <img src={bus.url} width={BUS_W} height={BUS_H} alt={`אוטובוס ההסעה של ${teamName}`} />
        : <div className="team-bus-placeholder" aria-hidden="true" />}
      {count !== undefined && count > 0 && <figcaption className="team-bus-count">🚌 {count} נוסעים</figcaption>}
      {bus && (
        <div className="team-bus-actions">
          {canShare && <button className="small secondary" onClick={share}>שיתוף</button>}
          <button className="small secondary" onClick={download}>הורדה</button>
        </div>
      )}
      {error && <small className="error">{error}</small>}
    </figure>
  );
}
