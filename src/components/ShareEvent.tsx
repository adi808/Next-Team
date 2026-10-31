import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Card, ErrorText, Field } from './ui';
import { BANNER_H, BANNER_STYLES, BANNER_W, TEMPLATES, canvasBlob, drawBanner, shareText, type BannerStyle, type ShareData, type ShareTemplate } from '../lib/share';

/**
 * A ready-made WhatsApp post for an event: a poster image (optionally with the team photo on top) and a formatted
 * message, with a choice of invitation, reminder, update or cancellation. Shared through the phone's share sheet,
 * or copied and downloaded when the device cannot share files.
 */
const pickOne = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

async function loadPhoto(path: string): Promise<HTMLImageElement | null> {
  const { data } = await supabase.storage.from('player-photos').createSignedUrl(path, 600);
  if (!data) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = data.signedUrl;
  });
}

export function ShareEvent({ data, link, kidPool, onClose }: {
  data: ShareData; link: string; kidPool: { path: string; name: string }[]; onClose: () => void;
}) {
  const [template, setTemplate] = useState<ShareTemplate>('invite');
  const [allowed, setAllowed] = useState<BannerStyle[]>(['dark', 'color']);
  const [style, setStyle] = useState<BannerStyle>(() => pickOne<BannerStyle>(['dark', 'color']));
  const [withKids, setWithKids] = useState(kidPool.length > 0);
  const [kids, setKids] = useState<HTMLImageElement[]>([]);
  const [roll, setRoll] = useState(0);
  const [withLink, setWithLink] = useState(false);
  const [text, setText] = useState(() => shareText(data, 'invite', null));
  const [hero, setHero] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const poolKey = kidPool.map((k) => k.path).join('|');
  useEffect(() => {
    if (!withKids || !kidPool.length) { setKids([]); return; }
    let cancelled = false;
    const chosen = [...kidPool].sort(() => Math.random() - 0.5).slice(0, 3);
    Promise.all(chosen.map((k) => loadPhoto(k.path))).then((imgs) => {
      if (cancelled) return;
      const ok = imgs.filter((i): i is HTMLImageElement => !!i);
      setKids(ok);
      if (!ok.length) setError('לא הצלחנו לטעון תמונות של שחקנים');
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withKids, roll, poolKey]);
  useEffect(() => { setText(shareText(data, template, withLink ? link : null)); }, [data, template, withLink, link]);
  useEffect(() => {
    const c = canvas.current ?? (canvas.current = document.createElement('canvas'));
    drawBanner(c, data, template, hero, style, kids);
    try { setPreview(c.toDataURL('image/png')); } catch { setPreview(''); setError('אי אפשר להציג תמונות שחקנים בבאנר מהמכשיר הזה'); }
  }, [data, template, hero, style, kids]);

  function toggleStyle(id: BannerStyle) {
    const next = allowed.includes(id) ? allowed.filter((x) => x !== id) : [...allowed, id];
    if (!next.length) return;
    setAllowed(next);
    if (!next.includes(style)) setStyle(pickOne(next));
  }
  /** Another random style among the ticked ones, and another three kids. */
  function shuffle() { setStyle(pickOne(allowed)); setRoll(roll + 1); }

  function pickPhoto(file: File | undefined) {
    if (!file) return;
    const img = new Image();
    img.onload = () => setHero(img);
    img.onerror = () => setError('לא הצלחנו לפתוח את התמונה');
    img.src = URL.createObjectURL(file);
  }

  async function file(): Promise<File | null> {
    const c = canvas.current;
    const blob = c ? await canvasBlob(c) : null;
    return blob ? new File([blob], 'event.png', { type: 'image/png' }) : null;
  }

  async function share() {
    setError(null); setMsg(null);
    try {
      const f = await file();
      if (f && navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text });
      else await navigator.share({ text });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('השיתוף לא הצליח. אפשר להוריד את התמונה ולהעתיק את הטקסט.');
    }
  }
  async function copy() {
    setError(null);
    try { await navigator.clipboard.writeText(text); setMsg('הטקסט הועתק'); } catch { setError('לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית.'); }
  }
  async function download() {
    const f = await file();
    if (!f) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = 'next-team-event.png'; a.click();
  }

  return (
    <Card title="שיתוף בוואטסאפ" actions={<button className="small secondary" onClick={onClose}>סגירה</button>}>
      <div className="row wrap">
        {TEMPLATES.map((t) => (
          <button key={t.id} className={`small ${template === t.id ? '' : 'secondary'}`} aria-pressed={template === t.id} onClick={() => setTemplate(t.id)}>{t.label}</button>
        ))}
      </div>
      <div className="row wrap">
        <span className="muted">עיצובים (סמנו כמה ונגריל):</span>
        {BANNER_STYLES.map((t) => (
          <button key={t.id} className={`small ${allowed.includes(t.id) ? '' : 'secondary'}`} aria-pressed={allowed.includes(t.id)} onClick={() => toggleStyle(t.id)}>{t.label}</button>
        ))}
        <button className="small secondary" onClick={shuffle}>🎲 ערבוב</button>
      </div>
      <label className="check"><input type="checkbox" checked={withKids} disabled={!kidPool.length} onChange={(e) => setWithKids(e.target.checked)} /> לשלב תמונות של 3 שחקנים (נבחרים אקראית בכל ערבוב)</label>
      <small className="muted">{kidPool.length ? `רק שחקנים שההורים אישרו הצגת תמונה שלהם (${kidPool.length} בקבוצה).` : 'אין עדיין שחקנים עם תמונה והסכמה להצגה. ההסכמה ניתנת בפרופיל הילד.'}</small>
      {preview && <img className="share-preview" src={preview} width={BANNER_W} height={BANNER_H} alt="תצוגה מקדימה של הבאנר" />}
      <Field label="תמונה לראש הבאנר (לא חובה, למשל תמונת הקבוצה)">
        <input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0])} />
      </Field>
      <label className="check"><input type="checkbox" checked={withLink} onChange={(e) => setWithLink(e.target.checked)} /> להוסיף קישור לאישור הגעה באפליקציה</label>
      <Field label="הטקסט (אפשר לערוך)"><textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="row wrap">
        {canShare && <button onClick={share}>שיתוף (תמונה וטקסט)</button>}
        <button className="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>פתיחה בוואטסאפ (טקסט)</button>
        <button className="secondary" onClick={copy}>העתקת טקסט</button>
        <button className="secondary" onClick={download}>הורדת התמונה</button>
      </div>
      {msg && <p className="ok">{msg}</p>}
      <ErrorText error={error} />
    </Card>
  );
}
