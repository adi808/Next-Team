import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDate } from '../../lib/db';
import { Badge, Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import type { TeamTabProps } from './TeamPage';

interface Task { id: string; title: string; description: string; due_at: string | null }
interface Assignment { id: string; task_id: string; player_id: string; kind: 'player' | 'parent'; done_at: string | null }

export default function TasksTab({ team, players, canManage }: TeamTabProps) {
  const { data, loading, error, reload } = useLoad(async () => {
    const tasks = await q<Task[]>(supabase.from('tasks').select('id, title, description, due_at').eq('team_id', team.id).order('created_at', { ascending: false }));
    const assignments = tasks.length
      ? await q<Assignment[]>(supabase.from('task_assignments').select('id, task_id, player_id, kind, done_at').in('task_id', tasks.map((t) => t.id)))
      : [];
    return { tasks, assignments };
  }, [team.id]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [everyone, setEveryone] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [forPlayers, setForPlayers] = useState(true);
  const [forParents, setForParents] = useState(false);
  const act = useAction();
  const nameOf = (id: string) => players.find((p) => p.id === id)?.full_name ?? '';

  async function create() {
    await act.run(async () => {
      await rpc('create_task', {
        p_team: team.id, p_title: title, p_description: description, p_due: due ? new Date(due).toISOString() : null,
        p_player_ids: everyone ? null : picked, p_for_players: forPlayers, p_for_parents: forParents,
      });
      setTitle(''); setDescription(''); setDue(''); reload();
    });
  }

  return (
    <>
      <Loading loading={loading} error={error} />
      {data && !data.tasks.length && <Empty>אין עדיין משימות.</Empty>}
      {data?.tasks.map((t) => {
        const items = data.assignments.filter((a) => a.task_id === t.id);
        const done = items.filter((a) => a.done_at).length;
        return (
          <Card key={t.id} title={t.title} actions={canManage && (
            <button className="small secondary" onClick={() => { if (confirm('למחוק את המשימה?')) act.run(async () => { await rpc('delete_task', { p_task: t.id }); reload(); }); }}>מחיקה</button>
          )}>
            {t.description && <p>{t.description}</p>}
            {t.due_at && <small className="muted">עד {fmtDate(t.due_at)}</small>}
            <p><Badge tone={done === items.length ? 'ok' : undefined}>{done} מתוך {items.length} בוצעו</Badge></p>
            <ul className="list compact">
              {items.map((a) => (
                <li key={a.id} className="row">
                  <span>{a.done_at ? '✓' : '○'}</span>
                  <span>{nameOf(a.player_id)}</span>
                  <small className="muted">{a.kind === 'parent' ? 'הורה' : 'שחקן'}</small>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {canManage && (
        <Card title="משימה חדשה">
          <Field label="כותרת"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="פירוט"><textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="עד מתי (לא חובה)"><input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <fieldset><legend>למי</legend>
            <label className="check"><input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} /> כל הסגל</label>
            {!everyone && players.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked((l) => (l.includes(p.id) ? l.filter((x) => x !== p.id) : [...l, p.id]))} /> {p.full_name}
              </label>
            ))}
            <label className="check"><input type="checkbox" checked={forPlayers} onChange={(e) => setForPlayers(e.target.checked)} /> לשחקנים</label>
            <label className="check"><input type="checkbox" checked={forParents} onChange={(e) => setForParents(e.target.checked)} /> להורים</label>
          </fieldset>
          <ErrorText error={act.error} />
          <button disabled={!title.trim() || (!forPlayers && !forParents) || (!everyone && !picked.length) || act.busy} onClick={create}>יצירת משימה</button>
        </Card>
      )}
    </>
  );
}
