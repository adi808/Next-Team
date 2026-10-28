import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, ageOf, fmtDate, fmtDay } from '../../lib/db';
import { normEmail } from '../../lib/email';
import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { Badge, Card, Empty, ErrorText, Field, Loading, PageHero, ScoreBar, Tabs } from '../../components/ui';
import { AttributesPanel } from '../../components/Attributes';
import { useLookupName, useLookups } from '../../components/Lookups';
import { Picture } from '../../components/Picture';
import { PlayerAvatar, ShirtNo, useShirtNumbers } from '../../components/People';
import { average, defsFor, latestRatings } from '../../lib/scores';
import type { AttrDef, AttrValue, EntityRole, EventStat, Player, Team } from '../../lib/types';

interface Guardian { parent_id: string; full_name: string; avatar_path: string | null; relation_id: string | null }

export default function PlayerPage() {
  const { playerId = '' } = useParams();
  const auth = useAuth();
  const acting = useActingRole();
  const statTypes = useLookups('stat_type', { includeInactive: true });
  const { data, loading, error, reload } = useLoad(async () => {
    const player = await q<Player>(supabase.from('v_players').select('*').eq('id', playerId).single());
    const links = await q<{ team_id: string }[]>(supabase.from('team_players').select('team_id').eq('player_id', playerId));
    const teams = links.length ? await q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').in('id', links.map((l) => l.team_id))) : [];
    const guardians = await rpc<Guardian[]>('player_guardians', { p_player: playerId });
    const stats = await q<EventStat[]>(supabase.from('event_stats').select('*').eq('player_id', playerId));
    return { player, teams, guardians, stats };
  }, [playerId]);
  const shirt = useShirtNumbers(playerId ? [playerId] : []);
  const relations = useLookups('guardian_relation');
  const relationName = useLookupName('guardian_relation');
  const act = useAction();
  const [name, setName] = useState<string | null>(null);
  const [birth, setBirth] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [parentEmail, setParentEmail] = useState('');

  if (!data) return <Loading loading={loading} error={error} />; // on reload, keep showing the page (and its open tab)
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

  const scope = { clubId: player.club_id, teamIds: teams.map((t) => t.id), sportIds: teams.map((t) => t.sport_id), roles };
  const tabs = [
    {
      id: 'details', label: 'פרטים', render: () => (
        <>
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
        teamIds={teams.map((t) => t.id)} sportIds={teams.map((t) => t.sport_id)} title="פרמטרים" skipTypes={['scale']} />

      <Card title="הורים וגישה">
        <ul className="list compact">
          {guardians.map((g) => {
            const canSet = manage || (isParent && g.parent_id === auth.profile?.id);
            return (
              <li key={g.parent_id} className="row">
                <Picture bucket="avatars" path={g.avatar_path} name={g.full_name || '?'} size={28} />
                <span>{g.full_name || 'הורה'}{g.parent_id === auth.profile?.id ? ' (אני)' : ''}</span>
                <span className="grow" />
                {canSet ? (
                  <select className="inline-select" aria-label="קרבה לילד" value={g.relation_id ?? ''} disabled={act.busy}
                    onChange={(e) => act.run(async () => { await rpc('set_guardian_relation', { p_player: player.id, p_parent: g.parent_id, p_relation: e.target.value || null }); reload(); })}>
                    <option value="">אמא / אבא?</option>
                    {relations.map((l) => <option key={l.id} value={l.id}>{l.name_he}</option>)}
                  </select>
                ) : g.relation_id && <Badge>{relationName(g.relation_id)}</Badge>}
              </li>
            );
          })}
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
      ),
    },
    { id: 'rating', label: 'הערכה', render: () => <RatingTab player={player} scope={scope} /> },
    ...(manage || isParent || isSelf ? [{ id: 'goals', label: 'יעדים', render: () => <GoalsTab playerId={player.id} canEdit={manage} /> }] : []),
    {
      id: 'history', label: 'היסטוריה', render: () => (
        <>
      {totals.size > 0 && (
        <Card title="סטטיסטיקות">
          <div className="row wrap">{[...totals].map(([id, n]) => <Badge key={id}>{statName(id)}: {n}</Badge>)}</div>
        </Card>
      )}

          <HistoryCard playerId={player.id} scope={scope} />
        </>
      ),
    },
  ];

  return (
    <>
      <PageHero kicker="פרופיל שחקן" title={player.full_name} />
      <div className="card overlap profile-head row">
        <PlayerAvatar player={player} size={64} />
        <div>
          <strong className="profile-name row">{player.full_name} <ShirtNo n={shirt(player.id)} /></strong>
          <small className="muted" style={{ display: 'block' }}>
            {player.birth_date ? `גיל ${ageOf(player.birth_date)} · נולד/ה ${fmtDay(player.birth_date)}` : ''}
            {teams.map((t, i) => <span key={t.id}>{i || player.birth_date ? ' · ' : ''}<Link to={`../team/${t.id}`}>{t.name}</Link></span>)}
          </small>
        </div>
      </div>
      <Tabs tabs={tabs} />
    </>
  );
}

type Scope = { clubId: string; teamIds: string[]; sportIds: string[]; roles: EntityRole[] };

function usePlayerValues(playerId: string, tick = 0) {
  return useLoad(async () => {
    const [defs, values] = await Promise.all([
      q<AttrDef[]>(supabase.from('attribute_defs').select('*').eq('scope', 'player').eq('active', true).order('sort_order')),
      q<(AttrValue & { seq: number })[]>(supabase.from('attribute_values').select('*').eq('entity_id', playerId).order('seq', { ascending: false })),
    ]);
    return { defs, values };
  }, [playerId, tick]);
}

/** The latest professional rating: average out of 10, its date, and a bar per skill. Staff edit the ratings below. */
function RatingTab({ player, scope }: { player: Player; scope: Scope }) {
  const [tick, setTick] = useState(0);
  const { data, loading, error } = usePlayerValues(player.id, tick);
  if (!data) return <Loading loading={loading} error={error} />;
  const scaleDefs = defsFor(data.defs, scope).filter((d) => d.data_type === 'scale');
  const ratings = latestRatings(scaleDefs, data.values, player.id);
  const avg = average(ratings.map((r) => r.score));
  const last = ratings.reduce<string | null>((m, r) => (!m || r.at > m ? r.at : m), null);
  return (
    <>
      <Card title="הערכה מקצועית אחרונה" actions={avg !== null && <span className="score-badge">{avg.toFixed(1)}/10</span>}>
        {last && <small className="muted">עודכן {fmtDay(last)}</small>}
        {ratings.length ? (
          <div className="stack">{ratings.map((r) => <ScoreBar key={r.def.id} label={r.def.label_he} value={r.score} />)}</div>
        ) : <Empty>{scaleDefs.length ? 'עדיין אין הערכה.' : 'אין פרמטרי דירוג. המאמן מגדיר אותם בהגדרות הקבוצה.'}</Empty>}
      </Card>
      <AttributesPanel scope="player" entityId={player.id} myRoles={scope.roles} clubId={scope.clubId}
        teamIds={scope.teamIds} sportIds={scope.sportIds} title="עדכון הערכה" onlyTypes={['scale']} onSaved={() => setTick((t) => t + 1)} />
    </>
  );
}

interface Goal { id: string; player_id: string; title: string; target_date: string | null; done_at: string | null; archived: boolean; created_at: string }

/** Personal goals the staff set; the family sees them. */
function GoalsTab({ playerId, canEdit }: { playerId: string; canEdit: boolean }) {
  const { data, loading, error, reload } = useLoad(
    () => q<Goal[]>(supabase.from('player_goals').select('*').eq('player_id', playerId).order('created_at')),
    [playerId],
  );
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('');
  const act = useAction();
  const save = (g: Goal, patch: Partial<Pick<Goal, 'archived'>> & { done?: boolean }) => act.run(async () => {
    await rpc('save_player_goal', {
      p_id: g.id, p_player: playerId, p_title: g.title, p_target: g.target_date,
      p_done: patch.done ?? !!g.done_at, p_archived: patch.archived ?? g.archived,
    });
    reload();
  });
  const open = (data ?? []).filter((g) => !g.archived && !g.done_at);
  const done = (data ?? []).filter((g) => !g.archived && g.done_at);
  return (
    <>
      <Loading loading={loading && !data} error={error} />
      <Card title="יעדים פתוחים">
        {data && !open.length && <Empty>אין יעדים פתוחים.</Empty>}
        <ul className="goals">
          {open.map((g) => (
            <li key={g.id}>
              <span className="goal-dot" />
              <div className="grow">
                <strong>{g.title}</strong>
                {g.target_date && <small className="muted" style={{ display: 'block' }}>עד {fmtDay(g.target_date)}</small>}
              </div>
              {canEdit && (
                <>
                  <button className="small" disabled={act.busy} onClick={() => save(g, { done: true })}>הושג</button>
                  <button className="small secondary" disabled={act.busy} onClick={() => save(g, { archived: true })}>לארכיון</button>
                </>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="row wrap goal-form">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="יעד חדש, למשל: 20 קפיצות בכדור" />
            <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="תאריך יעד" />
            <button disabled={!title.trim() || act.busy}
              onClick={() => act.run(async () => {
                await rpc('save_player_goal', { p_id: null, p_player: playerId, p_title: title, p_target: target || null });
                setTitle(''); setTarget(''); reload();
              })}>הוספה</button>
          </div>
        )}
        <ErrorText error={act.error} />
      </Card>
      {!!done.length && (
        <Card title="יעדים שהושגו 🏆">
          <ul className="goals">
            {done.map((g) => (
              <li key={g.id} className="done">
                <span className="goal-dot" />
                <div className="grow"><strong>{g.title}</strong><small className="muted" style={{ display: 'block' }}>הושג {fmtDay(g.done_at)}</small></div>
                {canEdit && <button className="small secondary" disabled={act.busy} onClick={() => save(g, { done: false })}>החזרה</button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

/** Every change to the player's parameters, newest first. */
function HistoryCard({ playerId, scope }: { playerId: string; scope: Scope }) {
  const { data, loading, error } = usePlayerValues(playerId);
  const positions = [...useLookups('position', { includeInactive: true }), ...useLookups('player_kind', { includeInactive: true })];
  if (!data) return <Loading loading={loading} error={error} />;
  const defs = defsFor(data.defs, scope);
  const rows = data.values.filter((v) => defs.some((d) => d.id === v.def_id));
  const show = (d: AttrDef, v: unknown) => (v === null || v === undefined ? '—'
    : d.data_type === 'boolean' ? (v ? 'כן' : 'לא')
      : d.data_type === 'lookup' ? positions.find((l) => l.id === v)?.name_he ?? '—'
        : String(v));
  return (
    <Card title="שינויים בפרמטרים">
      {!rows.length && <Empty>אין עדיין היסטוריה.</Empty>}
      <ul className="timeline">
        {rows.map((v) => {
          const d = defs.find((x) => x.id === v.def_id)!;
          return (
            <li key={v.id}>
              <small className="muted">{fmtDate(v.recorded_at)}</small>
              <span>{d.label_he}: <strong>{show(d, v.value)}</strong></span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
