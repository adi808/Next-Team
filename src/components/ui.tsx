import { useState, type ReactNode } from 'react';

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title && <h3>{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  return error ? <p role="alert" className="error">{error}</p> : null;
}

export function Loading({ loading, error }: { loading: boolean; error?: string | null }) {
  if (error) return <ErrorText error={error} />;
  return loading ? <p className="muted">טוען…</p> : null;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}

export function Tabs({ tabs, initial }: { tabs: { id: string; label: string; render: () => ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <>
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current.id} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {current.render()}
    </>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

/** Dark navy header with pitch lines; the first card after it overlaps its bottom edge. */
export function PageHero({ kicker, title, children, ball }: { kicker?: ReactNode; title: ReactNode; children?: ReactNode; ball?: boolean }) {
  return (
    <section className="hero">
      <svg className="hero-art" viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="2">
          <rect x="-20" y="20" width="440" height="220" rx="4" />
          <line x1="200" y1="20" x2="200" y2="240" />
          <circle cx="200" cy="130" r="46" />
          <rect x="-20" y="80" width="70" height="100" />
          <rect x="350" y="80" width="70" height="100" />
        </g>
        <circle cx="330" cy="40" r="70" fill="rgba(96,165,250,0.12)" />
      </svg>
      <div className="hero-text">
        {kicker && <span className="hero-kicker">{kicker}</span>}
        <h1>{title}</h1>
        {children}
      </div>
      {ball && (
        <svg className="hero-ball" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="47" fill="#fff" />
          <path d="M50 34 65 45 59 63H41L35 45z" fill="#0b1f4d" />
          <path d="M50 34V6M65 45l26-9M59 63l15 23M41 63 26 86M35 45 9 36" stroke="#0b1f4d" strokeWidth="4" strokeLinecap="round" />
        </svg>
      )}
    </section>
  );
}

export interface StatTile { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'muted' | 'info' }

/** Big numbers, for example attendance: coming / not coming / no answer yet. */
export function StatTiles({ items }: { items: StatTile[] }) {
  return (
    <div className="stat-tiles">
      {items.map((t) => (
        <div key={t.label} className={`stat-tile ${t.tone ?? 'info'}`}>
          <strong>{t.value}</strong>
          <span>{t.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Ring with a score in the middle (for example 7.3 out of 10). */
export function ScoreRing({ value, max = 10, size = 120 }: { value: number | null; max?: number; size?: number }) {
  const r = 46, c = 2 * Math.PI * r;
  const part = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  return (
    <svg className="score-ring" width={size} height={size} viewBox="0 0 110 110" role="img" aria-label={value === null ? 'אין ציון' : `${value.toFixed(1)} מתוך ${max}`}>
      <circle r={r} cx="55" cy="55" fill="none" stroke="#e9edf3" strokeWidth="10" />
      <circle r={r} cx="55" cy="55" fill="none" stroke="#2f855a" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${part * c} ${c}`} transform="rotate(-90 55 55)" />
      <text x="55" y="62" textAnchor="middle" className="score-ring-num">{value === null ? '—' : value.toFixed(1)}</text>
    </svg>
  );
}

/** Horizontal bar for a 0..max score. */
export function ScoreBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  return (
    <div className="score-bar">
      <div className="score-bar-head"><span>{label}</span><strong>{Number.isInteger(value) ? value : value.toFixed(1)}/{max}</strong></div>
      <div className="score-bar-track"><i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} /></div>
    </div>
  );
}
