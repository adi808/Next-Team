import { useEffect, useState } from 'react';
import { speak, stopSpeaking, useCanSpeak, useDictation } from '../lib/speech';

/** 🎤 next to a text field: speak instead of typing (Hebrew). Not shown where the browser cannot dictate. */
export function MicButton({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled?: boolean }) {
  const d = useDictation(onChange);
  if (!d.supported) return null;
  return (
    <>
      <button type="button" className={`mic-btn${d.listening ? ' on' : ''}`} disabled={disabled}
        aria-pressed={d.listening} aria-label={d.listening ? 'עצירת ההקלטה' : 'דיבור במקום כתיבה'} title={d.listening ? 'מקשיב… לחיצה לעצירה' : 'דיבור'}
        onClick={() => (d.listening ? d.stop() : d.start(value))}>
        {d.listening ? <span className="mic-pulse" aria-hidden="true" /> : '🎤'}
      </button>
      {d.error && <small className="error mic-error">{d.error}</small>}
    </>
  );
}

/** 🔊 reads a text aloud; pressing again stops. Not shown where the device has no Hebrew voice. */
export function SpeakButton({ text, label = 'הקראה' }: { text: string; label?: string }) {
  const can = useCanSpeak();
  const [on, setOn] = useState(false);
  useEffect(() => () => { if (on) stopSpeaking(); }, [on]);
  if (!can || !text.trim()) return null;
  return (
    <button type="button" className="small secondary speak-btn" aria-pressed={on}
      onClick={() => { if (on) { stopSpeaking(); setOn(false); } else { setOn(true); speak(text, () => setOn(false)); } }}>
      {on ? '⏹ עצירה' : `🔊 ${label}`}
    </button>
  );
}
