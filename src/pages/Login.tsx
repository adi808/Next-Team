import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { toE164 } from '../lib/phone';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const e164 = toE164(phone);
    if (!e164) return setError('מספר טלפון לא תקין');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({ phone: e164 });
    setBusy(false);
    if (err) return setError('שליחת הקוד נכשלה. נסו שוב.');
    setSentTo(e164);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.verifyOtp({
      phone: sentTo,
      token: code.trim(),
      type: 'sms',
    });
    setBusy(false);
    if (err) setError('הקוד שגוי או שפג תוקפו');
  }

  return (
    <main className="login">
      <h1>Next Kick</h1>
      {!sentTo ? (
        <form onSubmit={sendCode}>
          <label htmlFor="phone">מספר טלפון</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder="050-0000000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button disabled={busy}>שלחו לי קוד</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <label htmlFor="code">הקוד שנשלח אל {sentTo}</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button disabled={busy}>כניסה</button>
          <button type="button" className="link" onClick={() => setSentTo(null)}>
            החלפת מספר
          </button>
        </form>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </main>
  );
}
