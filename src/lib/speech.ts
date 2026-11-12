import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech in Hebrew with the browser's own engines (free, nothing is sent to our servers by us):
 *   * dictation: SpeechRecognition (Chrome / Android / Edge, Safari on iPhone); hidden where the browser lacks it;
 *   * reading aloud: speechSynthesis with a Hebrew voice; hidden where the device has none.
 */

// The Web Speech recognition API is not in TypeScript's DOM types.
interface RecognitionResult { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export const canDictate = () => !!recognitionCtor();

const ERRORS: Record<string, string> = {
  'not-allowed': 'אין הרשאה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן.',
  'service-not-allowed': 'הדפדפן לא מאפשר הכתבה כאן.',
  'no-speech': 'לא שמעתי כלום. נסו שוב ודברו קרוב לטלפון.',
  'audio-capture': 'לא נמצא מיקרופון.',
  network: 'ההכתבה צריכה חיבור לאינטרנט.',
};

/**
 * Dictation into a text field: `start` listens in Hebrew and calls `onText` with the words so far (appended to
 * what was in the field when it started); it stops by itself after a pause, or with `stop`.
 */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onText);
  cb.current = onText;

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback((base: string) => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    stopSpeaking();
    setError(null);
    const r = new Ctor();
    r.lang = 'he-IL'; r.continuous = false; r.interimResults = true;
    const prefix = base.trim() ? `${base.trim()} ` : '';
    r.onresult = (e) => {
      let said = '';
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      cb.current(prefix + said.trim());
    };
    r.onerror = (e) => { if (e.error !== 'aborted') setError(ERRORS[e.error] ?? 'ההכתבה לא הצליחה. נסו שוב.'); };
    r.onend = () => { setListening(false); rec.current = null; };
    rec.current = r;
    try { r.start(); setListening(true); } catch { setListening(false); }
  }, []);
  const stop = useCallback(() => rec.current?.stop(), []);
  return { supported: canDictate(), listening, error, start, stop };
}

// ---- reading aloud

let voices: SpeechSynthesisVoice[] = [];
const synth = () => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);
function hebrewVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  if (!voices.length) voices = s.getVoices();
  return voices.find((v) => v.lang?.toLowerCase().startsWith('he') || v.lang?.toLowerCase().startsWith('iw')) ?? null;
}

/** Whether the device can read Hebrew aloud (voices load late on some browsers, so this updates). */
export function useCanSpeak() {
  const [ok, setOk] = useState(() => !!hebrewVoice());
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const update = () => { voices = s.getVoices(); setOk(!!hebrewVoice()); };
    update();
    s.addEventListener?.('voiceschanged', update);
    return () => s.removeEventListener?.('voiceschanged', update);
  }, []);
  return ok;
}

/** Reads the text aloud in Hebrew (emoji and list bullets are skipped); a new call replaces the one speaking. */
export function speak(text: string, onEnd?: () => void) {
  const s = synth();
  const voice = hebrewVoice();
  if (!s || !voice) return;
  s.cancel();
  const clean = text.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}•✓✦]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return;
  const u = new SpeechSynthesisUtterance(clean);
  u.voice = voice; u.lang = voice.lang; u.rate = 1;
  if (onEnd) { u.onend = onEnd; u.onerror = onEnd; }
  s.speak(u);
}

export function stopSpeaking() { synth()?.cancel(); }
