import { useState } from 'react';
import { rpc, useAction } from '../../lib/db';
import { Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import { KitAvatar, useTeamKits } from '../../components/Kit';
import type { TeamKit } from '../../lib/types';

type Draft = { id: string | null; name: string; shirt: string; shorts: string; socks: string };
const NEW: Draft = { id: null, name: '', shirt: '#2563eb', shorts: '#ffffff', socks: '#2563eb' };

/** The team's colour sets: add, edit and archive. Each is shown as a kid wearing it. */
export function KitsCard({ teamId }: { teamId: string }) {
  const { data, loading, error, reload } = useTeamKits(teamId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const act = useAction();

  async function save() {
    if (!draft) return;
    await act.run(async () => {
      await rpc('save_team_kit', {
        p_id: draft.id, p_team: teamId, p_name: draft.name, p_shirt: draft.shirt, p_shorts: draft.shorts, p_socks: draft.socks,
      });
      setDraft(null); reload();
    });
  }
  async function setActive(k: TeamKit, active: boolean) {
    await act.run(async () => {
      await rpc('save_team_kit', { p_id: k.id, p_team: teamId, p_name: k.name, p_shirt: k.shirt, p_shorts: k.shorts, p_socks: k.socks, p_active: active });
      reload();
    });
  }

  const colour = (key: 'shirt' | 'shorts' | 'socks', label: string) => draft && (
    <label className="colour">
      <input type="color" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      <span>{label}</span>
    </label>
  );

  return (
    <Card title="סטים של צבעים" actions={!draft && <button className="small" onClick={() => setDraft(NEW)}>סט חדש</button>}>
      <p className="muted">למשל "בית" ו"חוץ". באירוע בוחרים סט, וכולם רואים מה ללבוש.</p>
      <Loading loading={loading} error={error} />
      {data && !data.length && !draft && <Empty>אין עדיין סטים.</Empty>}
      <div className="kits">
        {data?.map((k) => (
          <div key={k.id} className={`kit${k.active ? '' : ' archived'}`}>
            <KitAvatar kit={k} size={72} />
            <strong>{k.name}</strong>
            {k.active ? (
              <div className="row">
                <button className="small secondary" onClick={() => setDraft({ id: k.id, name: k.name, shirt: k.shirt, shorts: k.shorts, socks: k.socks })}>עריכה</button>
                <button className="small secondary" disabled={act.busy} onClick={() => setActive(k, false)}>העברה לארכיון</button>
              </div>
            ) : (
              <button className="small secondary" disabled={act.busy} onClick={() => setActive(k, true)}>החזרה</button>
            )}
          </div>
        ))}
      </div>
      {draft && (
        <div className="kit-editor">
          <KitAvatar kit={{ ...draft, name: draft.name || 'חדש' }} size={110} />
          <div className="stack grow">
            <Field label="שם הסט"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="בית / חוץ / אימון" /></Field>
            <div className="row wrap">{colour('shirt', 'חולצה')}{colour('shorts', 'מכנסיים')}{colour('socks', 'גרביים')}</div>
            <div className="row">
              <button disabled={!draft.name.trim() || act.busy} onClick={save}>שמירה</button>
              <button className="secondary" onClick={() => setDraft(null)}>ביטול</button>
            </div>
          </div>
        </div>
      )}
      <ErrorText error={act.error} />
    </Card>
  );
}
