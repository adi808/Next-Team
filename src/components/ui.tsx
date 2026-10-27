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

export function Tabs({ tabs }: { tabs: { id: string; label: string; render: () => ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
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
