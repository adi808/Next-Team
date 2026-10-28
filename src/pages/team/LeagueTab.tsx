import { useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad } from '../../lib/db';
import { Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import type { TeamTabProps } from './TeamPage';

interface LeagueTable { title: string; columns: string[]; rows: { cells: string[]; href: string | null }[] }
interface League {
  title: string; sourceUrl: string; leagueUrl: string | null; teamId: string | null;
  standings: LeagueTable | null; games: LeagueTable | null; fetchedAt: string;
}

const teamIdOf = (href: string | null) => (href ? new URL(href).searchParams.get('team_id') : null);

async function loadLeague(url: string): Promise<League> {
  const { data, error } = await supabase.functions.invoke('league', { body: { url } });
  if (error) {
    const body = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
    throw { message: body?.error ?? 'טבלת הליגה לא זמינה כרגע' };
  }
  return data as League;
}

function Table({ table, ourTeam }: { table: LeagueTable; ourTeam: string | null }) {
  const width = Math.max(table.columns.length, ...table.rows.map((r) => r.cells.length));
  return (
    <div className="table-scroll">
      <table className="league-table">
        {table.columns.some(Boolean) && (
          <thead><tr>{Array.from({ length: width }, (_, i) => <th key={i}>{table.columns[i] ?? ''}</th>)}</tr></thead>
        )}
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i} className={ourTeam && teamIdOf(r.href) === ourTeam ? 'ours' : ''}>
              {Array.from({ length: width }, (_, j) => <td key={j}>{r.cells[j] ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The league table and the team's games, read from the team's page on the football association site. */
export default function LeagueTab({ team, canManage }: TeamTabProps) {
  const param = useLoad(async () => {
    const [url, defs] = await Promise.all([
      rpc<unknown>('team_param', { p_team: team.id, p_key: 'league_url' }),
      q<{ id: string; team_id: string | null }[]>(supabase.from('attribute_defs').select('id, team_id').eq('scope', 'team').eq('key', 'league_url').eq('active', true)),
    ]);
    const def = defs.find((d) => d.team_id === team.id) ?? defs.find((d) => !d.team_id);
    return { url: typeof url === 'string' ? url.trim() : '', defId: def?.id ?? null };
  }, [team.id]);
  const url = param.data?.url ?? '';
  const league = useLoad(() => (url ? loadLeague(url) : Promise.resolve(null)), [url]);
  const [draft, setDraft] = useState<string | null>(null);
  const act = useAction();

  async function saveUrl() {
    if (!param.data?.defId || draft === null) return;
    const value = draft.trim();
    if (value && !/^https:\/\/([a-z0-9-]+\.)*football\.org\.il\//i.test(value)) return act.setError('צריך קישור לאתר ההתאחדות (https://www.football.org.il/...)');
    await act.run(async () => {
      await rpc('set_attribute', { p_def: param.data!.defId, p_entity: team.id, p_value: value });
      setDraft(null); param.reload();
    });
  }

  const editor = canManage && param.data?.defId && (
    draft === null ? (
      <button className="small secondary" onClick={() => setDraft(url)}>{url ? 'החלפת הקישור' : 'הוספת קישור'}</button>
    ) : (
      <div className="stack">
        <Field label="קישור לדף הקבוצה באתר ההתאחדות">
          <input dir="ltr" type="url" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://www.football.org.il/team-details/?team_id=...&season_id=..." />
        </Field>
        <ErrorText error={act.error} />
        <div className="row">
          <button disabled={act.busy} onClick={saveUrl}>שמירה</button>
          <button className="secondary" onClick={() => setDraft(null)}>ביטול</button>
        </div>
      </div>
    )
  );

  if (param.loading || param.error) return <Loading loading={param.loading} error={param.error} />;
  if (!url) {
    return (
      <Card title="טבלה וקבוצות בליגה">
        <Empty>{canManage
          ? 'מדביקים כאן את הקישור לדף הקבוצה באתר ההתאחדות לכדורגל, והטבלה והמשחקים יוצגו כאן לכל הקבוצה.'
          : 'הצוות עוד לא חיבר את הקבוצה לטבלת הליגה.'}</Empty>
        {editor}
      </Card>
    );
  }
  const ours = new URL(url).searchParams.get('team_id');
  const data = league.data;
  return (
    <>
      <Loading loading={league.loading} error={league.error} />
      {data && (
        <>
          <Card title={data.standings?.title || 'טבלת הליגה'}>
            {data.standings ? <Table table={data.standings} ourTeam={ours} /> : <Empty>לא נמצאה טבלת ליגה בדף.</Empty>}
            {data.standings && <small className="muted">{data.standings.rows.length} קבוצות משתתפות. השורה המודגשת היא הקבוצה שלנו.</small>}
          </Card>
          {data.games && (
            <Card title={data.games.title || 'משחקי הקבוצה'}>
              <Table table={data.games} ourTeam={null} />
            </Card>
          )}
        </>
      )}
      <Card>
        <div className="row wrap">
          <a href={url} target="_blank" rel="noreferrer">לדף הקבוצה באתר ההתאחדות ↗</a>
          {data?.leagueUrl && <a href={data.leagueUrl} target="_blank" rel="noreferrer">לדף הליגה ↗</a>}
          <span className="grow" />
          {data && <small className="muted">עודכן {new Date(data.fetchedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</small>}
        </div>
        {editor}
      </Card>
    </>
  );
}
