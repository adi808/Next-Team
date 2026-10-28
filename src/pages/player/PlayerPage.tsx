import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, ageOf, fmtDay } from '../../lib/db';
import { normEmail } from '../../lib/email';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { Badge, Card, ErrorText, Field, Loading } from '../../components/ui';
import { AttributesPanel } from '../../components/Attributes';
import { useLookups } from '../../components/Lookups';
import { PersonAvatar, PlayerAvatar, useNames } from '../../components/People';
import type { EntityRole, EventStat, Player, Team } from '../../lib/types';

export default function PlayerPage() {
  const { playerId = '' } = useParams();
  const auth = useAuth();
  const acting = useActingRole();
  const statTypes = useLookups('stat_type', { includeInactive: true });
  const { data, loading, error, reload } = useLoad(async () => {
    const player = await q<Player>(supabase.from('v_players').select('*').eq('id', playerId).single());
    const links = await q<{ team_id: string }[]>(supabase.from('team_players').select('team_id').eq('player_id', playerId));
    const teams = links.length ? await q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').in('id', links.map((l) => l.team_id))) : [];
    const guardians = await q<{ parent_id: string }[]>(supabase.from('guardianships').select('parent_id').eq('player_id', playerId).eq('status', 'approved'));
    const stats = await q<EventStat[]>(supabase.from('event_stats').select('*').eq('player_id', playerId));
    return { player, teams, guardians, stats };
  }, [playerId]);
  const names = useNames((data?.guardians ?? []).map((g) => g.parent_id));
  const act = useAction();
  const [name, setName] = useState<string | null>(null);
  const [birth, setBirth] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [parentEmail, setParentEmail] = useState('');

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  const { player, teams, guardians, stats } = data;
  const isSys = acting === 'system_admin' && !!auth.profile?.is_system_admin;
  const isAdmin = acting === 'club_admin' && auth.adminClubIds.includes(player.club_id);
  const isCoach = acting === 'coach' && teams.some((t) => auth.coachTeamIds.includes(t.id));
  const isParent = acting === 'parent' && auth.children.some((c) => c.id === player.id);
  const isSelf = acting === 'player' && auth.me?.id === player.id;
  const manage = isSys || isAdmin || isCoach;
  const roles: EntityRole[] = [];
  if (isSys) roles.push('system_admin');
  if (isAdmin) roles.push('club_admin');
  if (isCoach) roles.push('coach');
  if (isParent) roles.push('parent');
  if (isSelf) roles.push('player');

  async function saveProfile() {
    await act.run(async () => {
      await rpc('update_player', { p_player: player.id, p_full_name: name, p_birth_date: birth });
      setName(null); setBirth(null); reload();
    });
  }
  async function upload(file: File) {
    await act.run(async () => {
      const path = `${player.id}/${Date.now()}.${file.name.split('.').pop() || 'jpg'}`;
      const { error: err } = await supabase.storage.from('player-photos').upload(path, file, { upsert: true });
      if (err) throw err;
      await rpc('update_player', { p_player: player.id, p_photo_path: path });
      reload();
    });
  }
  const statName = (id: string) => statTypes.find((s) => s.id === id)?.name_he ?? '';
  const totals = new Map<string, number>();
  stats.forEach((s) => totals.set(s.stat_type_id, (totals.get(s.stat_type_id) ?? 0) + 1));

  return (
    <>
      <div className="row profile-head">
        <PlayerAvatar player={player} size={64} />
        <div>
          <h2>{player.full_name}</h2>
          <small className="muted">
            {player.birth_date ? `גיל ${ageOf(player.birth_date)} · נולד/ה ${fmtDay(player.birth_date)}` : ''}
            {teams.map((t) => <span key={t.id}> · <Link to={`../team/${t.id}`}>{t.name}</Link></span>)}
          </small>
        </div>
      </div>

      {(manage || isParent) && (
        <Card title="פרטי שחקן">
          <Field label="שם מלא"><input value={name ?? player.full_name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="תאריך לידה"><input type="date" value={birth ?? player.birth_date ?? ''} onChange={(e) => setBirth(e.target.value)} /></Field>
          <Field label="תמונה"><input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></Field>
          <ErrorText error={act.error} />
          <button disabled={(name === null && birth === null) || act.busy} onClick={saveProfile}>שמירה</button>
        </Card>
      )}

      {isParent && (
        <Card title="הסכמה להצגת תמונה">
          <label className="check">
            <input type="checkbox" checked={player.photo_consent} disabled={act.busy}
              onChange={(e) => act.run(async () => { await rpc('set_photo_consent', { p_player: player.id, p_consent: e.target.checked }); reload(); })} />
            אני מסכים/ה שתמונת הילד תוצג לחברי הקבוצה
          </label>
          <small className="muted">בלי הסכמה התמונה גלויה רק להורים ולצוות.</small>
        </Card>
      )}

      <AttributesPanel scope="player" entityId={player.id} myRoles={roles} clubId={player.club_id}
        teamIds={teams.map((t) => t.id)} sportIds={teams.map((t) => t.sport_id)} title="פרמטרים" />

      {totals.size > 0 && (
        <Card title="סטטיסטיקות">
          <div className="row wrap">{[...totals].map(([id, n]) => <Badge key={id}>{statName(id)}: {n}</Badge>)}</div>
        </Card>
      )}

      <Card title="הורים וגישה">
        <ul className="list compact">
          {guardians.map((g) => <li key={g.parent_id} className="row"><PersonAvatar id={g.parent_id} />{names(g.parent_id)}</li>)}
          {!guardians.length && <li className="muted">אין הורים מקושרים.</li>}
        </ul>
        {manage && (
          <>
            <Field label="הזמנת הורה לפי מייל">
              <div className="row">
                <input type="email" dir="ltr" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="name@example.com" />
                <button className="small" disabled={!normEmail(parentEmail) || act.busy}
                  onClick={() => act.run(async () => { await rpc('invite_parent', { p_player: player.id, p_email: normEmail(parentEmail) }); setParentEmail(''); reload(); })}>הוספה</button>
              </div>
            </Field>
          </>
        )}
        {(manage || isParent) && !player.has_account && (
          <Field label="כניסה עצמאית לשחקן (מייל של השחקן)">
            <div className="row">
              <input type="email" dir="ltr" value={accountEmail} onChange={(e) => setAccountEmail(e.target.value)} />
              <button className="small" disabled={!normEmail(accountEmail) || act.busy}
                onClick={() => act.run(async () => { await rpc('link_player_email', { p_player: player.id, p_email: normEmail(accountEmail) }); setAccountEmail(''); reload(); })}>חיבור</button>
            </div>
          </Field>
        )}
        {player.has_account && <small className="muted">לשחקן יש כניסה משלו. ילד בלי מייל מנוהל על ידי ההורה.</small>}
      </Card>
    </>
  );
}
