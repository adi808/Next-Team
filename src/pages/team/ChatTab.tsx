import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { useAuth } from '../../auth/AuthProvider';
import { Card, Empty, ErrorText, Tabs } from '../../components/ui';
import { Conversation, TeamChannel } from '../../components/Chat';
import type { TeamTabProps } from './TeamPage';

interface Conv { id: string; player_id: string; team_id: string }

export default function ChatTab({ team, players, canManage }: TeamTabProps) {
  const { coachTeamIds } = useAuth();
  const isCoach = coachTeamIds.includes(team.id);
  const convs = useLoad(() => (isCoach ? q<Conv[]>(supabase.from('conversations').select('id, player_id, team_id').eq('team_id', team.id)) : Promise.resolve<Conv[]>([])), [team.id, isCoach]);
  const [open, setOpen] = useState<string | null>(null);
  const act = useAction();
  const nameOf = (id: string) => players.find((p) => p.id === id)?.full_name ?? '';

  async function start(playerId: string) {
    await act.run(async () => {
      const id = await rpc<string>('start_conversation', { p_team: team.id, p_player: playerId });
      convs.reload(); setOpen(id);
    });
  }

  return (
    <Tabs tabs={[
      { id: 'channel', label: 'ערוץ הקבוצה', render: () => <TeamChannel teamId={team.id} canPost={canManage} /> },
      ...(isCoach ? [{
        id: 'personal', label: 'שיחות אישיות', render: () => (
          <>
            <p className="muted">שיחה אישית עם שחקן. ההורים של השחקן רואים כל שיחה, ומנהל המועדון אינו רואה שיחות אישיות.</p>
            {!players.length && <Empty>אין שחקנים בקבוצה.</Empty>}
            <ul className="list">
              {players.map((p) => {
                const c = convs.data?.find((x) => x.player_id === p.id);
                return (
                  <li key={p.id} className="row">
                    <span>{p.full_name}</span>
                    <button className="small" disabled={act.busy} onClick={() => (c ? setOpen(c.id) : start(p.id))}>{c ? 'פתיחה' : 'התחלת שיחה'}</button>
                  </li>
                );
              })}
            </ul>
            <ErrorText error={act.error} />
            {open && <Card title={nameOf(convs.data?.find((c) => c.id === open)?.player_id ?? '')}><Conversation id={open} /></Card>}
          </>
        ),
      }] : []),
    ]} />
  );
}
