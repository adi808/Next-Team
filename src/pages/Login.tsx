import { useEffect, useState, type FormEvent } from 'react';
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

// The address a code was sent to, kept so that switching to the mail app (which can reload the page on a phone)
// lands back on the code screen. Supabase's codes expire after an hour, so an older entry is dropped.
const PENDING_KEY = 'nt-login-pending';
const PENDING_TTL_MS = 60 * 60 * 1000;
// Supabase lets one address request a new code once a minute.
const RESEND_SECONDS = 60;

function loadPending(): { email: string; at: number } | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { email?: string; at?: number };
    if (!p.email || !p.at || Date.now() - p.at > PENDING_TTL_MS) return null;
    return { email: p.email, at: p.at };
  } catch { return null; }
}
function savePending(email: string | null) {
  try {
    if (email) localStorage.setItem(PENDING_KEY, JSON.stringify({ email, at: Date.now() }));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage blocked: the code screen just won't survive a reload */ }
}

function secondsLeft(at: number | null): number {
  if (!at) return 0;
  return Math.max(0, RESEND_SECONDS - Math.floor((Date.now() - at) / 1000));
}

/** Hebrew message for a failed send, telling a rate limit (wait) apart from a delivery failure. */
function sendError(err: { status?: number; code?: string; message?: string }): string {
  const msg = err.message ?? '';
  if (err.status === 429 || err.code === 'over_email_send_rate_limit' || /rate limit|security purposes/i.test(msg)) {
    const m = msg.match(/after (\d+) seconds?/i);
    return m ? `נשלחו יותר מדי בקשות. נסו שוב בעוד ${m[1]} שניות.` : 'נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.';
  }
  if (/signups? not allowed/i.test(msg)) return 'הרשמה של משתמשים חדשים סגורה כרגע.';
  return 'שליחת הקוד נכשלה. נסו שוב בעוד דקה.';
}

export default function Login() {
  const pending = loadPending();
  const [email, setEmail] = useState(pending?.email ?? '');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(pending?.email ?? null);
  const [sentAt, setSentAt] = useState<number | null>(pending?.at ?? null);
  const [wait, setWait] = useState(() => secondsLeft(pending?.at ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const embedded = inAppBrowser();

  // Countdown until "send again" is allowed.
  useEffect(() => {
    if (!sentAt) return;
    setWait(secondsLeft(sentAt));
    const t = window.setInterval(() => {
      const left = secondsLeft(sentAt);
      setWait(left);
      if (left === 0) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [sentAt]);

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

  // The email carries a code and a sign-in link; either one works. A new address gets a sign-up email,
  // an existing one a magic-link email; both carry the code, and verifyOtp type 'email' accepts both.
  async function requestCode(addr: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
    });
    setBusy(false);
    if (err) { setError(sendError(err)); return false; }
    setSentTo(addr);
    setSentAt(Date.now());
    savePending(addr);
    return true;
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const addr = normEmail(email);
    if (!addr) return setError('כתובת מייל לא תקינה');
    await requestCode(addr);
  }

  async function resend() {
    if (!sentTo || wait > 0) return;
    setCode('');
    if (await requestCode(sentTo)) setInfo('שלחנו קוד חדש. הקוד הקודם כבר לא תקף.');
  }

  function changeAddress() {
    setSentTo(null);
    setSentAt(null);
    setCode('');
    setError(null);
    setInfo(null);
    savePending(null);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    const token = code.replace(/\D/g, '');
    if (token.length < 6) return setError('הקוד מורכב מ־6 ספרות לפחות');
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: err } = await supabase.auth.verifyOtp({ email: sentTo, token, type: 'email' });
    setBusy(false);
    if (err) return setError(err.status === 429 ? 'יותר מדי ניסיונות. חכו כמה דקות ונסו שוב.' : 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');
    savePending(null);
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
          <p className="muted hint">שלחנו מייל מ־Next Team אל <bdi dir="ltr">{sentTo}</bdi>. הזינו את הקוד שבמייל, או לחצו על הקישור שבו.</p>
          <label htmlFor="code">קוד אימות</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            dir="ltr"
            maxLength={10}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button disabled={busy || code.length < 6}>כניסה</button>
          <p className="muted hint">לא הגיע תוך דקה? בדקו בתיקיות ספאם, קידומי מכירות ועדכונים.</p>
          <button type="button" className="link" disabled={busy || wait > 0} onClick={resend}>
            {wait > 0 ? `שליחת קוד חדש (${wait})` : 'שליחת קוד חדש'}
          </button>
          <button type="button" className="link" onClick={changeAddress}>
            החלפת כתובת
          </button>
        </form>
      )}
      {info && <p role="status" className="muted">{info}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
    </div>
  );
}
