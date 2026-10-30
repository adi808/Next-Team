import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { uploadImage } from '../../lib/images';
import { Picture, PicturePicker } from '../../components/Picture';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { ErrorText, Loading, PageHero, Tabs } from '../../components/ui';
import { useCoachTeam } from '../../auth/coachTeam';
import { useSports } from '../../components/Lookups';
import { SportIcon } from '../../components/SportIcon';
import type { Player, Team } from '../../lib/types';
import SquadTab from './SquadTab';
import EventsTab from './EventsTab';
import TasksTab from './TasksTab';
import SurveysTab from './SurveysTab';
import ChatTab from './ChatTab';
import LeagueTab from './LeagueTab';
import SettingsTab from './SettingsTab';
import { TeamContacts } from '../../components/Contacts';
import { Roster } from '../../components/Roster';

export interface TeamTabProps {
  team: Team;
  players: Player[];
  canManage: boolean;
  reload: () => void;
}

/** Coach shortcut (bottom nav): the current team, opened on a given tab. */
export function CoachTeamTab() {
  const { tab = 'events' } = useParams();
  const [teamId] = useCoachTeam();
  if (!teamId) return <Navigate to="../teams" replace />;
  return <TeamPage key={`${teamId}/${tab}`} teamId={teamId} initialTab={tab} />;
}

export default function TeamPage(opts: { teamId?: string; initialTab?: string }) {
  const params = useParams();
  const [search] = useSearchParams();
  const teamId = opts.teamId ?? params.teamId ?? '';
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

  if (!data) return <Loading loading={loading} error={error} />; // on reload, keep showing the page (and its open tab)
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
    { id: 'contacts', label: 'אנשי קשר', render: () => <TeamContacts teamId={team.id} clubId={team.club_id} /> },
    ...(sport?.slug === 'football' ? [{ id: 'league', label: 'ליגה', render: () => <LeagueTab {...props} /> }] : []),
    ...(canManage ? [{
      id: 'roster', label: 'טבלת הורים',
      render: () => <Roster clubId={team.club_id} teamId={team.id} team={team} title={`שחקנים והורים - ${team.name}`}
        isClubAdmin={(acting === 'system_admin' && !!auth.profile?.is_system_admin) || (acting === 'club_admin' && auth.adminClubIds.includes(team.club_id))} />,
    }] : []),
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
      <PageHero kicker={<span className="row">{sport && <SportIcon sport={sport} size={18} />}{sport?.name_he ?? 'קבוצה'}</span>} title={team.name} />
      <div className="card overlap title-row">
        <Picture bucket="club-media" path={team.photo_path} name={team.name} size={52} square />
        <div className="grow">
          <strong>{team.name}</strong>
          <small className="muted" style={{ display: 'block' }}>{players.length} שחקנים</small>
        </div>
        {canManage && <PicturePicker label={team.photo_path ? 'החלפת תמונה' : 'הוספת תמונה'} busy={act.busy} onPick={setPhoto} />}
      </div>
      <ErrorText error={act.error} />
      <Tabs tabs={tabs} initial={opts.initialTab ?? search.get('tab') ?? undefined} />
    </>
  );
}
