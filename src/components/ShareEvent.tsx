import { useEffect, useRef, useState } from 'react';
import { Card, ErrorText, Field } from './ui';
import { BANNER_H, BANNER_STYLES, BANNER_W, TEMPLATES, canvasBlob, drawBanner, shareText, type BannerStyle, type ShareData, type ShareTemplate } from '../lib/share';

/**
 * A ready-made WhatsApp post for an event: a poster image (optionally with the team photo on top) and a formatted
 * message, with a choice of invitation, reminder, update or cancellation. Shared through the phone's share sheet,
 * or copied and downloaded when the device cannot share files.
 */
export function ShareEvent({ data, link, onClose }: { data: ShareData; link: string; onClose: () => void }) {
  const [template, setTemplate] = useState<ShareTemplate>('invite');
  const [style, setStyle] = useState<BannerStyle>('dark');
  const [withLink, setWithLink] = useState(false);
  const [text, setText] = useState(() => shareText(data, 'invite', null));
  const [hero, setHero] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => { setText(shareText(data, template, withLink ? link : null)); }, [data, template, withLink, link]);
  useEffect(() => {
    const c = canvas.current ?? (canvas.current = document.createElement('canvas'));
    drawBanner(c, data, template, hero, style);
    setPreview(c.toDataURL('image/png'));
  }, [data, template, hero, style]);

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
        <span className="muted">עיצוב:</span>
        {BANNER_STYLES.map((t) => (
          <button key={t.id} className={`small ${style === t.id ? '' : 'secondary'}`} aria-pressed={style === t.id} onClick={() => setStyle(t.id)}>{t.label}</button>
        ))}
      </div>
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
