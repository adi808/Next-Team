import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { isDemo, supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';

// The in-app assistant: a floating button on every screen that opens a chat with the Next Team assistant
// (the `assistant` Edge Function). It answers from the club's data with the person's own permissions, explains the
// app, and prepares actions that run only after the person confirms them here.

type ApiMessage = { role: 'user' | 'assistant'; content: string | { type: string; text?: string }[] };
interface PendingAction { id: string; name: string; summary: string }
interface Pending { results: unknown[]; actions: PendingAction[] }
interface Reply { messages: ApiMessage[]; reply: string; pending?: Pending; error?: string; reset?: boolean }
interface Saved { messages: ApiMessage[]; pending: Pending | null }

const MAX_MESSAGES = 60;
const SUGGESTIONS: Record<string, string[]> = {
  parent: ['מתי האימון הבא?', 'מי מגיע למשחק הקרוב?', 'יש לי משימות פתוחות?', 'איך מוסיפים הורה שני?'],
  player: ['מתי האימון הבא?', 'מה יש השבוע?', 'יש לי משימות?'],
  coach: ['מי עוד לא ענה לאירוע הקרוב?', 'מה יש השבוע?', 'כמה מקומות בהסעה למשחק הקרוב?', 'איך יוצרים סדרת אימונים?'],
  admin: ['מה יש השבוע בקבוצות?', 'איך מזמינים מאמן?', 'איך מייצאים את רשימת השחקנים?'],
  sysadmin: ['איך יוצרים מועדון?', 'איך מוסיפים ערך לרשימה?'],
};

const keyOf = (uid: string) => `nt-assistant:${uid}`;
function load(uid: string): Saved {
  try {
    const raw = sessionStorage.getItem(keyOf(uid));
    if (raw) return JSON.parse(raw) as Saved;
  } catch { /* storage blocked or bad data */ }
  return { messages: [], pending: null };
}
function save(uid: string, s: Saved) {
  try { sessionStorage.setItem(keyOf(uid), JSON.stringify(s)); } catch { /* storage blocked or full */ }
}

/** The bubbles to show: the person's typed messages and the assistant's text (tool calls and results stay hidden). */
function bubbles(messages: ApiMessage[]): { mine: boolean; text: string }[] {
  const out: { mine: boolean; text: string }[] = [];
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') out.push({ mine: true, text: m.content });
    if (m.role === 'assistant') {
      const parts = typeof m.content === 'string' ? [m.content]
        : m.content.filter((b) => b.type === 'text' && b.text?.trim()).map((b) => b.text as string);
      const text = parts.join('\n').replace(/\*\*(.+?)\*\*/g, '$1').trim();
      if (text) out.push({ mine: false, text });
    }
  }
  return out;
}

async function call(body: Record<string, unknown>): Promise<Reply> {
  const { data, error } = await supabase.functions.invoke('assistant', { body });
  if (error) {
    // the function's own message (in Hebrew) is in the response body
    let msg = 'העוזר לא זמין כרגע. נסו שוב.';
    let reset = false;
    try {
      const b = await (error as { context?: Response }).context?.json();
      if (b?.error) msg = b.error;
      reset = !!b?.reset;
    } catch { /* no body */ }
    return { messages: [], reply: '', error: msg, reset };
  }
  return data as Reply;
}

function Panel({ uid, mode, onClose }: { uid: string; mode: string; onClose: () => void }) {
  const [state, setState] = useState<Saved>(() => load(uid));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // the message on its way, shown until the answer arrives
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { save(uid, state); }, [uid, state]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [state, draft, busy]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shown = bubbles(state.messages);
  const tooLong = state.messages.length >= MAX_MESSAGES - 4;

  async function run(body: Record<string, unknown>, typed?: string) {
    setBusy(true);
    setError(null);
    setDraft(typed ?? null);
    const res = await call({ mode, messages: state.messages, ...body });
    setBusy(false);
    setDraft(null);
    if (res.error) {
      setError(res.error);
      if (res.reset) setState({ messages: [], pending: null });
      else if (typed) setText(typed);
      return;
    }
    setState({ messages: res.messages, pending: res.pending ?? null });
  }

  function send(t: string) {
    const body = t.trim();
    if (!body || busy || state.pending) return;
    setText('');
    void run({ text: body }, body);
  }

  return (
    <div className="assistant-panel" role="dialog" aria-modal="true" aria-label="העוזר של Next Team">
      <header>
        <span className="assistant-avatar" aria-hidden="true">✦</span>
        <div className="grow">
          <strong>העוזר של Next Team</strong>
          <small className="muted">רואה רק את מה שמותר לך לראות</small>
        </div>
        {shown.length > 0 && (
          <button type="button" className="link" disabled={busy} onClick={() => { setState({ messages: [], pending: null }); setError(null); }}>
            שיחה חדשה
          </button>
        )}
        <button type="button" className="assistant-close" aria-label="סגירה" onClick={onClose}>×</button>
      </header>

      <div className="assistant-log" ref={listRef} aria-live="polite">
        {!shown.length && !draft && (
          <div className="assistant-hello">
            <p>שלום! אפשר לשאול אותי על אירועים, אישורי הגעה, הסעות ומשימות, לבקש שאאשר הגעה בשבילך, או לשאול איך עושים משהו באפליקציה.</p>
            <div className="assistant-suggest">
              {(SUGGESTIONS[mode] ?? SUGGESTIONS.parent).map((s) => (
                <button key={s} type="button" className="secondary" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {shown.map((b, i) => <p key={i} className={b.mine ? 'bubble mine' : 'bubble'}>{b.text}</p>)}
        {draft && <p className="bubble mine">{draft}</p>}
        {busy && <p className="bubble typing" aria-label="העוזר כותב"><span /><span /><span /></p>}
        {state.pending && !busy && (
          <div className="assistant-confirm">
            <strong>לאשר את הפעולה?</strong>
            <ul>{state.pending.actions.map((a) => <li key={a.id}>{a.summary}</li>)}</ul>
            <div className="row">
              <button type="button" onClick={() => run({ pending: state.pending, decision: 'confirm' })}>אישור</button>
              <button type="button" className="secondary" onClick={() => run({ pending: state.pending, decision: 'decline' })}>ביטול</button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {tooLong && <p className="muted small">השיחה ארוכה. כדאי להתחיל שיחה חדשה.</p>}
      </div>

      <form className="assistant-compose" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea
          ref={inputRef} rows={1} value={text} maxLength={2000} placeholder={state.pending ? 'קודם אשרו או בטלו את הפעולה' : 'כתבו שאלה…'}
          disabled={!!state.pending || state.messages.length >= MAX_MESSAGES}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
        />
        <button type="submit" disabled={busy || !text.trim() || !!state.pending} aria-label="שליחה">שליחה</button>
      </form>
    </div>
  );
}

/** Floating button + chat panel, shown on every screen of a signed-in mode (not in the offline demo). */
export function Assistant() {
  const { mode = '' } = useParams();
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  if (isDemo || !profile) return null;
  return (
    <>
      {!open && (
        <button type="button" className="assistant-fab" aria-label="העוזר של Next Team" title="העוזר" onClick={() => setOpen(true)}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />
            <path d="M12 8.2l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor" stroke="none" />
          </svg>
        </button>
      )}
      {open && <Panel uid={profile.id} mode={mode} onClose={() => setOpen(false)} />}
    </>
  );
}
