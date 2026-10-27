import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { Loading, Tabs } from '../../components/ui';
import { useSports } from '../../components/Lookups';
import { SportIcon } from '../../components/SportIcon';
import type { Player, Team } from '../../lib/types';
import SquadTab from './SquadTab';
import EventsTab from './EventsTab';
import TasksTab from './TasksTab';
import SurveysTab from './SurveysTab';
import ChatTab from './ChatTab';
import SettingsTab from './SettingsTab';

export interface TeamTabProps {
  team: Team;
  players: Player[];
  canManage: boolean;
  reload: () => void;
}

export default function TeamPage() {
  const { teamId = '' } = useParams();
  const auth = useAuth();
  const sports = useSports();
  const { data, loading, error, reload } = useLoad(async () => {
    const team = await q<Team>(supabase.from('teams').select('id, club_id, name, sport_id').eq('id', teamId).single());
    const links = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', teamId));
    const ids = links.map((l) => l.player_id);
    const players = ids.length ? await q<Player[]>(supabase.from('v_players').select('*').in('id', ids).order('full_name')) : [];
    return { team, players };
  }, [teamId]);

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  const { team, players } = data;
  const canManage = !!auth.profile?.is_system_admin || auth.coachTeamIds.includes(team.id) || auth.adminClubIds.includes(team.club_id);
  const sport = sports.find((s) => s.id === team.sport_id);
  const props: TeamTabProps = { team, players, canManage, reload };

  const tabs = [
    { id: 'squad', label: 'סגל', render: () => <SquadTab {...props} /> },
    { id: 'events', label: 'אירועים', render: () => <EventsTab {...props} /> },
    { id: 'tasks', label: 'משימות', render: () => <TasksTab {...props} /> },
    { id: 'surveys', label: 'סקרים', render: () => <SurveysTab {...props} /> },
    { id: 'chat', label: 'הודעות', render: () => <ChatTab {...props} /> },
    ...(canManage ? [{ id: 'settings', label: 'הגדרות', render: () => <SettingsTab {...props} /> }] : []),
  ];
  return (
    <>
      <h2 className="row">{sport && <SportIcon sport={sport} size={28} />} {team.name}</h2>
      <Tabs tabs={tabs} />
    </>
  );
}
