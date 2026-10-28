import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad } from '../lib/db';
import { joinUrl } from '../lib/join';
import { Card, ErrorText } from './ui';

/** The team's join link, for staff: make, copy, share, replace or turn off. */
export function JoinLinkCard({ teamId, teamName }: { teamId: string; teamName: string }) {
  const link = useLoad(async () => {
    const rows = await q<{ code: string }[]>(supabase.from('join_links').select('code').eq('team_id', teamId).eq('active', true));
    return rows[0]?.code ?? null;
  }, [teamId]);
  const act = useAction();
  const [copied, setCopied] = useState(false);
  const url = link.data ? joinUrl(link.data) : '';
  const text = `הצטרפות לקבוצה ${teamName} ב־Next Team: ${url}`;

  const make = () => act.run(async () => { await rpc('create_join_link', { p_team: teamId }); link.reload(); });
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { prompt('העתיקו את הקישור:', url); }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ title: teamName, text, url }); } catch { /* cancelled */ } return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noreferrer');
  }

  return (
    <Card title="🔗 לינק הצטרפות לקבוצה">
      <p className="muted">שלחו את הלינק למאמן, למנהל הקבוצה או להורים. מי שכבר רשום מזוהה אוטומטית; מי שלא, בוחר תפקיד ושולח בקשה, ומי שמאשר מקבל הודעה ומייל.</p>
      {link.data ? (
        <>
          <input readOnly value={url} onFocus={(e) => e.target.select()} dir="ltr" />
          <div className="row wrap">
            <button className="small" onClick={copy}>{copied ? 'הועתק ✓' : 'העתקה'}</button>
            <button className="small secondary" onClick={share}>שיתוף</button>
            <button className="small secondary" disabled={act.busy} onClick={() => { if (confirm('ליצור לינק חדש? הלינק הנוכחי יפסיק לעבוד.')) make(); }}>לינק חדש</button>
            <button className="small danger" disabled={act.busy}
              onClick={() => { if (confirm('לבטל את הלינק?')) act.run(async () => { await rpc('disable_join_link', { p_team: teamId }); link.reload(); }); }}>ביטול</button>
          </div>
        </>
      ) : (
        !link.loading && <button disabled={act.busy} onClick={make}>יצירת לינק הצטרפות</button>
      )}
      <ErrorText error={act.error ?? link.error} />
    </Card>
  );
}
