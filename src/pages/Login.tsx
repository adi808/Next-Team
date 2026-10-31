import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { normEmail } from '../lib/email';

// Decorative header: a football pitch drawn in light lines over the brand gradient, with a ball in flight.
function LoginHero() {
  return (
    <div className="login-hero">
      <svg className="login-hero-art" viewBox="0 0 400 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="lh-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1e3a8a" /><stop offset="0.55" stopColor="#2563eb" /><stop offset="1" stopColor="#60a5fa" />
          </linearGradient>
          <radialGradient id="lh-glow" cx="0.8" cy="0.15" r="0.6">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" /><stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="260" fill="url(#lh-bg)" />
        <rect width="400" height="260" fill="url(#lh-glow)" />
        <g fill="none" stroke="#fff" strokeOpacity="0.16" strokeWidth="2">
          <rect x="24" y="30" width="352" height="220" rx="6" />
          <line x1="200" y1="30" x2="200" y2="250" />
          <circle cx="200" cy="140" r="38" />
          <rect x="24" y="90" width="56" height="100" />
          <rect x="320" y="90" width="56" height="100" />
          <rect x="24" y="115" width="22" height="50" />
          <rect x="354" y="115" width="22" height="50" />
        </g>
        <circle cx="200" cy="140" r="3" fill="#fff" fillOpacity="0.3" />
        <path d="M70 215 Q 170 40 300 92" fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="2.5" strokeDasharray="2 9" strokeLinecap="round" />
        <g transform="translate(312 88)">
          <circle r="17" fill="#fff" />
          <path d="M0-6.5l6.2 4.5-2.4 7.3h-7.6l-2.4-7.3z" fill="#1e3a8a" />
          <path d="M0-6.5V-17M6.2-2l9.6-3.2M3.8 5.3l6 8.3M-3.8 5.3l-6 8.3M-6.2-2l-9.6-3.2" stroke="#1e3a8a" strokeWidth="1.6" />
        </g>
        <circle cx="52" cy="40" r="60" fill="#fff" fillOpacity="0.05" />
        <circle cx="380" cy="250" r="90" fill="#fff" fillOpacity="0.05" />
      </svg>
      <div className="login-hero-text">
        <span className="login-mark">N</span>
        <strong>Next Team</strong>
        <span>הקבוצה שלך, במקום אחד</span>
      </div>
    </div>
  );
}

/**
 * True inside another app's embedded browser (WhatsApp, Facebook, Instagram, any webview), where Google refuses
 * to sign in. The installed home-screen app is not one of these, and neither are Safari, Chrome or Firefox.
 */
function inAppBrowser(): boolean {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/.test(ua)) return true;
  const ios = /iPhone|iPad|iPod/.test(ua);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone && !/Safari|CriOS|FxiOS|EdgiOS/.test(ua);
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const embedded = inAppBrowser();

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); } catch { setError('לא הצלחנו להעתיק. סמנו את הכתובת והעתיקו ידנית.'); }
  }

  async function google() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (err) {
      setBusy(false);
      setError('הכניסה עם Google נכשלה. נסו שוב.');
    }
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const addr = normEmail(email);
    if (!addr) return setError('כתובת מייל לא תקינה');
    setBusy(true);
    setError(null);
    // The email carries a code and a sign-in link; either one works.
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (err) return setError('שליחת הקוד נכשלה. נסו שוב בעוד דקה.');
    setSentTo(addr);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: sentTo, token: code.trim(), type: 'email' });
    setBusy(false);
    if (err) setError('הקוד שגוי או שפג תוקפו');
  }

  return (
    <div className="login-page">
    <LoginHero />
    <main className="login">
      <h1>כניסה</h1>
      {!sentTo ? (
        <>
          {embedded && (
            <div className="notice">
              <strong>נפתחתם בדפדפן הפנימי של אפליקציה אחרת.</strong>
              <p>כניסה עם Google לא תעבוד כאן. לכניסה עם Google פתחו את הקישור ב־Safari או ב־Chrome (בתפריט שלוש הנקודות או סמל המצפן). אפשר גם להיכנס כאן עם קוד שנשלח למייל.</p>
              <button type="button" className="small secondary" onClick={copyLink}>{copied ? 'הקישור הועתק' : 'העתקת הקישור'}</button>
            </div>
          )}
          {!embedded && <button type="button" className="google" disabled={busy} onClick={google}>
            <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
            </svg>
            כניסה עם Google
          </button>}
          {!embedded && <p className="divider"><span>או קוד למייל</span></p>}
          <form onSubmit={sendCode}>
            <label htmlFor="email">כתובת מייל</label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              dir="ltr"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button disabled={busy}>שלחו לי קוד</button>
          </form>
        </>
      ) : (
        <form onSubmit={verify}>
          <label htmlFor="code">הקוד שנשלח אל <bdi>{sentTo}</bdi></label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button disabled={busy}>כניסה</button>
          <p className="muted hint">לא הגיע? בדקו בתיקיית הספאם. אפשר גם ללחוץ על הקישור שבמייל.</p>
          <button type="button" className="link" onClick={() => { setSentTo(null); setCode(''); }}>
            החלפת כתובת
          </button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
    </div>
  );
}
