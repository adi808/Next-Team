import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, ageOf, fmtDay } from '../../lib/db';
import { toE164 } from '../../lib/phone';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, Card, ErrorText, Field, Loading } from '../../components/ui';
import { AttributesPanel } from '../../components/Attributes';
import { useLookups } from '../../components/Lookups';
import { PlayerAvatar, useNames } from '../../components/People';
import type { EntityRole, EventStat, Player, Team } from '../../lib/types';

export default function PlayerPage() {
  const { playerId = '' } = useParams();
  const auth = useAuth();
  const statTypes = useLookups('stat_type', { includeInactive: true });
  const { data, loading, error, reload } = useLoad(async () => {
    const player = await q<Player>(supabase.from('v_players').select('*').eq('id', playerId).single());
    const links = await q<{ team_id: string }[]>(supabase.from('team_players').select('team_id').eq('player_id', playerId));
    const teams = links.length ? await q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id').in('id', links.map((l) => l.team_id))) : [];
    const guardians = await q<{ parent_id: string }[]>(supabase.from('guardianships').select('parent_id').eq('player_id', playerId).eq('status', 'approved'));
    const stats = await q<EventStat[]>(supabase.from('event_stats').select('*').eq('player_id', playerId));
    return { player, teams, guardians, stats };
  }, [playerId]);
  const names = useNames((data?.guardians ?? []).map((g) => g.parent_id));
  const act = useAction();
  const [name, setName] = useState<string | null>(null);
  const [birth, setBirth] = useState<string | null>(null);
  const [accountPhone, setAccountPhone] = useState('');
  const [parentPhone, setParentPhone] = useState('');

  if (loading || error || !data) return <Loading loading={loading} error={error} />;
  const { player, teams, guardians, stats } = data;
  const isSys = !!auth.profile?.is_system_admin;
  const isAdmin = auth.adminClubIds.includes(player.club_id);
  const isCoach = teams.some((t) => auth.coachTeamIds.includes(t.id));
  const isParent = auth.children.some((c) => c.id === player.id);
  const isSelf = auth.me?.id === player.id;
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
          {guardians.map((g) => <li key={g.parent_id}>{names(g.parent_id)}</li>)}
          {!guardians.length && <li className="muted">אין הורים מקושרים.</li>}
        </ul>
        {manage && (
          <>
            <Field label="הזמנת הורה לפי טלפון">
              <div className="row">
                <input type="tel" dir="ltr" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} placeholder="050-0000000" />
                <button className="small" disabled={!toE164(parentPhone) || act.busy}
                  onClick={() => act.run(async () => { await rpc('invite_parent', { p_player: player.id, p_phone: toE164(parentPhone) }); setParentPhone(''); reload(); })}>הוספה</button>
              </div>
            </Field>
          </>
        )}
        {(manage || isParent) && !player.has_account && (
          <Field label="כניסה עצמאית לשחקן (טלפון של השחקן)">
            <div className="row">
              <input type="tel" dir="ltr" value={accountPhone} onChange={(e) => setAccountPhone(e.target.value)} />
              <button className="small" disabled={!toE164(accountPhone) || act.busy}
                onClick={() => act.run(async () => { await rpc('link_player_phone', { p_player: player.id, p_phone: toE164(accountPhone) }); setAccountPhone(''); reload(); })}>חיבור</button>
            </div>
          </Field>
        )}
        {player.has_account && <small className="muted">לשחקן יש כניסה משלו. ילד בלי טלפון מנוהל על ידי ההורה.</small>}
      </Card>
    </>
  );
}
