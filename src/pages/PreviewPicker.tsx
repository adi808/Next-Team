import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { q, useLoad } from '../lib/db';
import { useAuth } from '../auth/AuthProvider';
import { startPreview } from '../auth/preview';
import { Card, Empty, Loading, PageHero } from '../components/ui';
import { PlayerAvatar } from '../components/People';
import { homeOf } from '../components/Shell';
import type { Player, Team } from '../lib/types';

/** A club admin (or the system admin) chooses a team, then looks at the app as its coach or as one of its players. */
export default function PreviewPicker() {
  const { profile, adminClubIds, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [teamId, setTeamId] = useState<string | null>(null);
  const allowed = !!profile?.is_system_admin || adminClubIds.length > 0;
  const teams = useLoad(async () => {
    if (!allowed) return [] as Team[];
    let query = supabase.from('teams').select('id, club_id, name, sport_id, photo_path').order('name');
    if (!profile?.is_system_admin) query = query.in('club_id', adminClubIds);
    return q<Team[]>(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, adminClubIds.join(',')]);
  const squad = useLoad(async () => {
    if (!teamId) return [] as Player[];
    const links = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', teamId));
    const ids = links.map((l) => l.player_id);
    return ids.length ? q<Player[]>(supabase.from('v_players').select('*').in('id', ids).order('full_name')) : [];
  }, [teamId]);

  if (authLoading) return <p className="center">טוען…</p>;
  if (!allowed) return <Navigate to="/pick" replace />;
  const team = teams.data?.find((t) => t.id === teamId);

  const go = (p: Parameters<typeof startPreview>[0], mode: 'coach' | 'player') => {
    startPreview(p);
    navigate(homeOf(mode));
  };

  return (
    <div className="picker-page">
      <PageHero kicker="מנהל" title="צפייה כמאמן או כשחקן" />
      <div className="overlap">
        <Card title="1. בוחרים קבוצה">
          <Loading loading={teams.loading} error={teams.error} />
          {teams.data && !teams.data.length && <Empty>אין קבוצות.</Empty>}
          <div className="row wrap">
            {teams.data?.map((t) => (
              <button key={t.id} className={t.id === teamId ? '' : 'secondary'} onClick={() => setTeamId(t.id)}>{t.name}</button>
            ))}
          </div>
        </Card>
        {team && (
          <Card title={`2. איך לצפות ב${team.name}?`}>
            <button className="role-card" onClick={() => go({ kind: 'coach', teamId: team.id }, 'coach')}>
              <span><strong>כמאמן של {team.name}</strong><small>הבית, האירועים, הסגל וההרכב, כפי שהמאמן רואה</small></span>
              <span className="chev" aria-hidden="true">‹</span>
            </button>
            <h4 className="section-title">או כשחקן:</h4>
            <Loading loading={squad.loading} error={squad.error} />
            {squad.data && !squad.data.length && <Empty>אין שחקנים בקבוצה.</Empty>}
            <ul className="list">
              {squad.data?.map((p) => (
                <li key={p.id}>
                  <button className="link row" onClick={() => go({ kind: 'player', playerId: p.id }, 'player')}>
                    <PlayerAvatar player={p} size={30} /> {p.full_name}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="muted center">במצב צפייה רואים את מה שהם רואים, בלי להופיע בסגל ובלי אפשרות לשמור שינויים.</p>
        <p className="center-link"><Link to="/pick">חזרה</Link></p>
      </div>
    </div>
  );
}
