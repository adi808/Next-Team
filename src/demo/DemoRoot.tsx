import { useEffect, useState } from 'react';
import App from '../App';
import { demoServer, demoSignIn } from './client';
import { PERSONAS } from './seed';

/** Wraps the real app: pick a sample person, use the app as them, switch at any time. */
export default function DemoRoot() {
  const [persona, setPersona] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    // the viewer frame shows no confirm dialogs; the demo just agrees
    window.confirm = () => true;
    const exit = () => setPersona(null);
    window.addEventListener('demo-exit', exit);
    return () => window.removeEventListener('demo-exit', exit);
  }, []);

  function choose(id: string) {
    demoSignIn(id);
    try { localStorage.removeItem('mode'); } catch { /* storage may be unavailable */ }
    setPersona(id);
    setVersion((v) => v + 1);
  }
  function reset() {
    demoServer.reset();
    if (persona) choose(persona);
  }

  const current = PERSONAS.find((p) => p.id === persona);
  if (!current) {
    return (
      <main className="demo-picker">
        <h1>Next Team</h1>
        <p className="demo-lead">דמו אינטראקטיבי עם נתוני דוגמה. בחרו מי אתם ותראו את האפליקציה דרך העיניים שלו.</p>
        <div className="stack">
          {PERSONAS.map((p) => (
            <button key={p.id} className="mode-card" onClick={() => choose(p.id)}>
              <strong>{p.title} · {p.role}</strong>
              <small>{p.blurb}</small>
            </button>
          ))}
        </div>
        <p className="muted demo-note">
          השינויים נשמרים רק בדף הזה ונעלמים ברענון. שליחת SMS והעלאת תמונה אינן זמינות בדמו. כדאי לנסות פעולה כמו אישור הגעה כהורה, ואז לעבור למאמן ולראות אותה.
        </p>
      </main>
    );
  }
  return (
    <>
      <div className="demo-bar">
        <span>דמו · {current.title} ({current.role})</span>
        <span className="row">
          <button className="small secondary" onClick={reset}>איפוס נתונים</button>
          <button className="small" onClick={() => setPersona(null)}>החלפת משתמש</button>
        </span>
      </div>
      <App key={`${persona}-${version}`} />
    </>
  );
}
