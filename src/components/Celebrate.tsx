import { useEffect, useState } from 'react';

const COLOURS = ['#2563eb', '#60a5fa', '#f59e0b', '#22c55e', '#ef4444', '#a855f7'];

/** A trophy with confetti for a moment; render it with a changing key to replay. */
export function Celebrate({ text = 'כל הכבוד!' }: { text?: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShown(false), 2400); return () => clearTimeout(t); }, []);
  if (!shown) return null;
  return (
    <div className="celebrate" role="status" onClick={() => setShown(false)}>
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} className="confetti" style={{
          insetInlineStart: `${(i * 37) % 100}%`, background: COLOURS[i % COLOURS.length],
          animationDelay: `${(i % 7) * 0.08}s`, animationDuration: `${1.6 + (i % 5) * 0.2}s`,
        }} />
      ))}
      <div className="celebrate-card"><span className="celebrate-trophy">🏆</span><strong>{text}</strong><span>👍 קיבלת לייק וגביע</span></div>
    </div>
  );
}
