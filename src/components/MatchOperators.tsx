import { rpc, useAction, useLoad } from '../lib/db';
import { Card, Empty, ErrorText, Loading } from './ui';

interface Row { parent_id: string; full_name: string; children: string; is_operator: boolean }

/** Staff choose which parents may run the match clock (start / stop, goals, cards) in this team's matches. */
export function MatchOperatorsCard({ teamId }: { teamId: string }) {
  const { data, loading, error, reload } = useLoad(() => rpc<Row[]>('team_match_operators', { p_team: teamId }), [teamId]);
  const act = useAction();
  const toggle = (r: Row) => act.run(async () => {
    await rpc('set_match_operator', { p_team: teamId, p_parent: r.parent_id, p_on: !r.is_operator });
    reload();
  });
  return (
    <Card title="⏱ הורים שמפעילים את שעון המשחק">
      <p className="muted">הורה מסומן יכול להפעיל במשחקים של הקבוצה את מתג "המשחק התחיל", את הסטופר של כל שחקן ולרשום שערים, בישולים וכרטיסים. ההרשאה נשארת עד שמבטלים אותה. מינימום הדקות ואורך המשחק נקבעים בהגדרות הקבוצה.</p>
      <Loading loading={loading} error={error} />
      {data && !data.length && <Empty>אין עדיין הורים עם חשבון בקבוצה.</Empty>}
      <ul className="list compact">
        {data?.map((r) => (
          <li key={r.parent_id} className="row">
            <label className="check grow">
              <input type="checkbox" checked={r.is_operator} disabled={act.busy} onChange={() => toggle(r)} />
              <span>{r.full_name || 'הורה'} <small className="muted">· {r.children}</small></span>
            </label>
          </li>
        ))}
      </ul>
      <ErrorText error={act.error} />
    </Card>
  );
}
