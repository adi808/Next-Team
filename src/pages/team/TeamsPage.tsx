import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { useCoachTeam } from '../../auth/coachTeam';
import { Empty, Loading, PageHero } from '../../components/ui';
import { useSports } from '../../components/Lookups';
import { SportIcon } from '../../components/SportIcon';
import type { Team } from '../../lib/types';
import { Picture } from '../../components/Picture';

export default function TeamsPage() {
  const { coachTeamIds } = useAuth();
  const [, setTeam] = useCoachTeam();
  const sports = useSports();
  const { data, loading, error } = useLoad(
    () => q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').in('id', coachTeamIds).order('name')),
    [coachTeamIds.join(',')],
  );
  return (
    <>
      <PageHero kicker="מאמן" title="הקבוצות שלי" />
      <Loading loading={loading} error={error} />
      {data && !data.length && <Empty>אין לך עדיין קבוצות.</Empty>}
      <ul className="list">
        {data?.map((t) => {
          const sport = sports.find((s) => s.id === t.sport_id);
          return (
            <li key={t.id} className="row" onClick={() => setTeam(t.id)}>
              <Picture bucket="club-media" path={t.photo_path} name={t.name} size={40} square />
              <Link to={`../team/${t.id}`}>{t.name}</Link>
              <small className="muted row">{sport && <SportIcon sport={sport} size={16} />}{sport?.name_he}</small>
            </li>
          );
        })}
      </ul>
    </>
  );
}
