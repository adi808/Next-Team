import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { uploadImage } from '../../lib/images';
import { Picture, PicturePicker } from '../../components/Picture';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { ErrorText, Loading, Tabs } from '../../components/ui';
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
    const team = await q<Team>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').eq('id', teamId).single());
    const links = await q<{ player_id: string }[]>(supabase.from('team_players').select('player_id').eq('team_id', teamId));
    const ids = links.map((l) => l.player_id);
    const players = ids.length ? await q<Player[]>(supabase.from('v_players').select('*').in('id', ids).order('full_name')) : [];
    return { team, players };
  }, [teamId]);
  const act = useAction();
  const acting = useActingRole();

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  const { team, players } = data;
  const canManage = (acting === 'system_admin' && !!auth.profile?.is_system_admin) || (acting === 'coach' && auth.coachTeamIds.includes(team.id))
    || (acting === 'club_admin' && auth.adminClubIds.includes(team.club_id));
  const sport = sports.find((s) => s.id === team.sport_id);
  const props: TeamTabProps = { team, players, canManage, reload };

  const tabs = [
    { id: 'events', label: 'אירועים', render: () => <EventsTab {...props} /> },
    { id: 'squad', label: 'סגל', render: () => <SquadTab {...props} /> },
    { id: 'tasks', label: 'משימות', render: () => <TasksTab {...props} /> },
    { id: 'surveys', label: 'סקרים', render: () => <SurveysTab {...props} /> },
    { id: 'chat', label: 'הודעות', render: () => <ChatTab {...props} /> },
    ...(canManage ? [{ id: 'settings', label: 'הגדרות', render: () => <SettingsTab {...props} /> }] : []),
  ];
  async function setPhoto(file: File) {
    await act.run(async () => {
      const path = await uploadImage('club-media', `teams/${team.id}`, file);
      await rpc('set_team_photo', { p_team: team.id, p_path: path });
      reload();
    });
  }
  return (
    <>
      <div className="title-row">
        <Picture bucket="club-media" path={team.photo_path} name={team.name} size={56} square />
        <h2 className="row">{sport && <SportIcon sport={sport} size={24} />} {team.name}</h2>
        {canManage && <PicturePicker label={team.photo_path ? 'החלפת תמונה' : 'הוספת תמונה'} busy={act.busy} onPick={setPhoto} />}
      </div>
      <ErrorText error={act.error} />
      <Tabs tabs={tabs} />
    </>
  );
}
