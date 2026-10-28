import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Celebrate } from '../../components/Celebrate';
import { q, rpc, useAction, useLoad, fmtDate, ageOf } from '../../lib/db';
import { teamAllowsPlayerAnswers } from '../../lib/team';
import { normEmail } from '../../lib/email';
import { useAuth } from '../../auth/AuthProvider';
import { Badge, Card, Empty, ErrorText, Field, Loading, PageHero } from '../../components/ui';
import { AttendanceWidget } from '../../components/Attendance';
import { Conversation, TeamChannel } from '../../components/Chat';
import { useLookupName } from '../../components/Lookups';
import { PlayerAvatar } from '../../components/People';
import type { EventResponse, EventRow, Player, Team } from '../../lib/types';

/** The children a parent follows, or the player's own profile. */
function useKids() {
  const { mode } = useParams();
  const { children, me } = useAuth();
  const asParent = mode === 'parent';
  const kids: Player[] = asParent ? children : me ? [me] : [];
  const ids = kids.map((k) => k.id).join(',');
  const teams = useLoad(async () => {
    if (!kids.length) return { links: [] as { team_id: string; player_id: string }[], teams: [] as Team[] };
    const links = await q<{ team_id: string; player_id: string }[]>(supabase.from('team_players').select('team_id, player_id').in('player_id', kids.map((k) => k.id)));
    const tids = [...new Set(links.map((l) => l.team_id))];
    const ts = tids.length ? await q<Team[]>(supabase.from('teams').select('id, club_id, name, sport_id, photo_path').in('id', tids)) : [];
    return { links, teams: ts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  return { kids, asParent, links: teams.data?.links ?? [], teams: teams.data?.teams ?? [], loading: teams.loading, error: teams.error };
}

export function FamilyHome() {
  const { reload } = useAuth();
  const { kids, asParent, links, teams, loading, error } = useKids();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const act = useAction();
  useEffect(() => { reload(); }, [reload]);

  async function request() {
    const addr = normEmail(email);
    if (!addr) return act.setError('כתובת מייל לא תקינה');
    await act.run(async () => {
      await rpc('request_guardianship', { p_other_email: addr, p_as_parent: asParent });
      setEmail(''); setSent(true);
    });
  }

  return (
    <>
      <PageHero kicker={asParent ? 'הורה' : 'שחקן'} title={asParent ? 'הילדים שלי' : 'הפרופיל שלי'} />
      <Loading loading={loading} error={error} />
      {!kids.length && !loading && <Empty>עדיין אין ילדים מקושרים.</Empty>}
      <ul className="list">
        {kids.map((k) => (
          <li key={k.id} className="row">
            <PlayerAvatar player={k} />
            <Link to={`../player/${k.id}`}>{k.full_name}</Link>
            <small className="muted">
              {k.birth_date ? `גיל ${ageOf(k.birth_date)}` : ''} {links.filter((l) => l.player_id === k.id).map((l) => teams.find((t) => t.id === l.team_id)?.name).filter(Boolean).join(', ')}
            </small>
          </li>
        ))}
      </ul>
      <Card title={asParent ? 'קישור ילד נוסף' : 'קישור להורה'}>
        <p className="muted">
          {asParent ? 'אם לילד יש כניסה משלו, הזינו את המייל שלו. ' : 'הזינו את המייל של ההורה. '}
          הבקשה תמתין לאישור המאמן של הקבוצה.
        </p>
        <Field label="מייל"><input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></Field>
        <ErrorText error={act.error} />
        {sent && <p className="ok">הבקשה נשלחה וממתינה לאישור המאמן.</p>}
        <button disabled={!email.trim() || act.busy} onClick={request}>שליחת בקשה</button>
      </Card>
    </>
  );
}

function KidAttendance({ event, kid, response, asParent, onSaved }: { event: EventRow; kid: Player; response?: EventResponse; asParent: boolean; onSaved: () => void }) {
  const allowed = useLoad(() => (asParent ? Promise.resolve(true) : teamAllowsPlayerAnswers(event.team_id, kid.birth_date)), [event.team_id, kid.id, asParent]);
  return <AttendanceWidget eventId={event.id} playerId={kid.id} playerName={asParent ? kid.full_name : undefined} response={response} canAnswer={allowed.data === true} onSaved={onSaved} />;
}

export function FamilyEvents() {
  const { kids, asParent, links, teams, loading, error } = useKids();
  const typeName = useLookupName('event_type');
  const tids = teams.map((t) => t.id).join(',');
  const { data, reload, loading: l2, error: e2 } = useLoad(async () => {
    if (!teams.length) return { events: [] as EventRow[], responses: [] as EventResponse[] };
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const events = await q<EventRow[]>(supabase.from('events').select('*').in('team_id', teams.map((t) => t.id)).gte('starts_at', since).order('starts_at'));
    const responses = events.length ? await q<EventResponse[]>(supabase.from('event_responses').select('*').in('event_id', events.map((e) => e.id))) : [];
    return { events, responses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tids]);

  return (
    <>
      <PageHero kicker={asParent ? 'הורה' : 'שחקן'} title="אירועים קרובים" />
      <Loading loading={loading || l2} error={error || e2} />
      {data && !data.events.length && <Empty>אין אירועים קרובים.</Empty>}
      {data?.events.map((e) => (
        <Card key={e.id} title={e.title || typeName(e.type_id)}>
          <p>
            <Badge>{typeName(e.type_id)}</Badge> {fmtDate(e.starts_at)} {e.location && `· ${e.location}`}
            {e.opponent && ` · נגד ${e.opponent}`} <small className="muted">· {teams.find((t) => t.id === e.team_id)?.name}</small>
          </p>
          <Link to={`../event/${e.id}`}>פרטים</Link>
          {kids.filter((k) => links.some((l) => l.team_id === e.team_id && l.player_id === k.id)).map((k) => (
            <KidAttendance key={k.id} event={e} kid={k} asParent={asParent} response={data.responses.find((r) => r.event_id === e.id && r.player_id === k.id)} onSaved={reload} />
          ))}
        </Card>
      ))}
    </>
  );
}

interface TaskRow { id: string; team_id: string; title: string; description: string; due_at: string | null }
interface Assign { id: string; task_id: string; player_id: string; kind: 'player' | 'parent'; done_at: string | null }

export function FamilyTasks() {
  const { kids } = useKids();
  const { data, loading, error, reload } = useLoad(async () => {
    const assignments = await q<Assign[]>(supabase.from('task_assignments').select('id, task_id, player_id, kind, done_at'));
    const ids = [...new Set(assignments.map((a) => a.task_id))];
    const tasks = ids.length ? await q<TaskRow[]>(supabase.from('tasks').select('id, team_id, title, description, due_at').in('id', ids)) : [];
    return { assignments, tasks };
  }, []);
  const act = useAction();
  const [party, setParty] = useState<{ n: number; medal: boolean }>({ n: 0, medal: false });
  async function setDone(a: Assign, done: boolean) {
    await act.run(async () => {
      await rpc('complete_assignment', { p_assignment: a.id, p_done: done });
      if (done) setParty((p) => ({ n: p.n + 1, medal: a.kind === 'player' }));
      reload();
    });
  }
  // A player's completed task earns a medal; a parent's task a like and a trophy.
  const medals = (data?.assignments ?? []).filter((a) => a.done_at && a.kind === 'player').length;
  const trophies = (data?.assignments ?? []).filter((a) => a.done_at && a.kind === 'parent').length;
  const open = (data?.assignments ?? []).filter((a) => !a.done_at);
  const done = (data?.assignments ?? []).filter((a) => a.done_at);
  const card = (a: Assign) => {
    const t = data!.tasks.find((x) => x.id === a.task_id);
    const kid = kids.find((k) => k.id === a.player_id);
    return (
      <Card key={a.id} title={t?.title}>
        {t?.description && <p>{t.description}</p>}
        <small className="muted">{kid?.full_name} · {a.kind === 'parent' ? 'משימה להורה' : 'משימה לשחקן'}{t?.due_at ? ` · עד ${fmtDate(t.due_at)}` : ''}</small>
        {a.done_at ? (
          <div className="task-reward">
            <span className={`reward${a.kind === 'player' ? ' medal' : ''}`}>{a.kind === 'player' ? <><span className="medal-icon">🏅</span> קיבלת מדליה!</> : '👍 🏆 בוצע!'}</span>
            <button className="link" disabled={act.busy} onClick={() => setDone(a, false)}>ביטול</button>
          </div>
        ) : (
          <button className="done-btn" disabled={act.busy} onClick={() => setDone(a, true)}>✓ סיימתי</button>
        )}
      </Card>
    );
  };
  return (
    <>
      {party.n > 0 && (party.medal
        ? <Celebrate key={party.n} icon="🏅" note="קיבלת מדליה על המשימה" />
        : <Celebrate key={party.n} />)}
      <PageHero kicker="משימות" title="המשימות שלי">
        {(medals > 0 || trophies > 0) && (
          <span className="row hero-chip">
            {medals > 0 && <span className="trophies" title="מדליות">🏅 {medals}</span>}
            {trophies > 0 && <span className="trophies" title="גביעים">🏆 {trophies}</span>}
          </span>
        )}
      </PageHero>
      <Loading loading={loading} error={error} />
      <ErrorText error={act.error} />
      {data && !data.assignments.length && <Empty>אין משימות.</Empty>}
      {open.map(card)}
      {done.length > 0 && <h3 className="section-title">בוצעו</h3>}
      {done.map(card)}
    </>
  );
}

interface Survey { id: string; team_id: string; title: string; description: string; closes_at: string | null }
interface Question { id: string; survey_id: string; text: string; kind: 'single' | 'multi' | 'text' }
interface Option { id: string; question_id: string; label: string }
interface MyAnswer { question_id: string; option_id: string | null; text_answer: string | null }

export function FamilySurveys() {
  const { teams } = useKids();
  const tids = teams.map((t) => t.id).join(',');
  const { data, loading, error, reload } = useLoad(async () => {
    if (!teams.length) return null;
    const surveys = await q<Survey[]>(supabase.from('surveys').select('id, team_id, title, description, closes_at').in('team_id', teams.map((t) => t.id)).order('created_at', { ascending: false }));
    const sid = surveys.map((s) => s.id);
    const questions = sid.length ? await q<Question[]>(supabase.from('survey_questions').select('id, survey_id, text, kind').in('survey_id', sid).order('position')) : [];
    const qid = questions.map((x) => x.id);
    const options = qid.length ? await q<Option[]>(supabase.from('survey_options').select('id, question_id, label').in('question_id', qid).order('position')) : [];
    const mine = qid.length ? await q<MyAnswer[]>(supabase.from('survey_answers').select('question_id, option_id, text_answer').in('question_id', qid)) : [];
    return { surveys, questions, options, mine };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tids]);
  return (
    <>
      <PageHero kicker="סקרים" title="מה דעתכם?" />
      <Loading loading={loading} error={error} />
      {data && !data.surveys.length && <Empty>אין סקרים.</Empty>}
      {data?.surveys.map((s) => (
        <SurveyForm key={s.id} survey={s} questions={data.questions.filter((x) => x.survey_id === s.id)} options={data.options} mine={data.mine} onDone={reload} />
      ))}
    </>
  );
}

function SurveyForm({ survey, questions, options, mine, onDone }: { survey: Survey; questions: Question[]; options: Option[]; mine: MyAnswer[]; onDone: () => void }) {
  const initial: Record<string, string[]> = {};
  questions.forEach((qn) => {
    const mineHere = mine.filter((m) => m.question_id === qn.id);
    initial[qn.id] = qn.kind === 'text' ? [mineHere[0]?.text_answer ?? ''] : mineHere.map((m) => m.option_id as string);
  });
  const [vals, setVals] = useState(initial);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  const answered = mine.some((m) => questions.some((qn) => qn.id === m.question_id));

  async function submit() {
    await act.run(async () => {
      const answers = questions.map((qn) => qn.kind === 'text'
        ? { question_id: qn.id, text: vals[qn.id]?.[0] ?? '' }
        : { question_id: qn.id, option_ids: vals[qn.id] ?? [] });
      await rpc('submit_survey', { p_survey: survey.id, p_answers: answers });
      setSaved(true); onDone();
    });
  }
  return (
    <Card title={survey.title}>
      {survey.description && <p>{survey.description}</p>}
      {answered && <Badge tone="ok">כבר ענית, אפשר לעדכן</Badge>}
      {questions.map((qn) => (
        <div key={qn.id} className="question">
          <strong>{qn.text}</strong>
          {qn.kind === 'text' ? (
            <textarea value={vals[qn.id]?.[0] ?? ''} onChange={(e) => setVals({ ...vals, [qn.id]: [e.target.value] })} />
          ) : (
            options.filter((o) => o.question_id === qn.id).map((o) => (
              <label key={o.id} className="check">
                <input type={qn.kind === 'single' ? 'radio' : 'checkbox'} name={qn.id} checked={vals[qn.id]?.includes(o.id) ?? false}
                  onChange={(e) => setVals({
                    ...vals,
                    [qn.id]: qn.kind === 'single' ? [o.id] : e.target.checked ? [...(vals[qn.id] ?? []), o.id] : (vals[qn.id] ?? []).filter((x) => x !== o.id),
                  })} /> {o.label}
              </label>
            ))
          )}
        </div>
      ))}
      <ErrorText error={act.error} />
      {saved && <p className="ok">התשובות נשמרו.</p>}
      <button disabled={act.busy} onClick={submit}>שליחה</button>
    </Card>
  );
}

interface Conv { id: string; player_id: string; team_id: string }

export function FamilyChat() {
  const { kids, asParent, teams, loading, error } = useKids();
  const convs = useLoad(() => q<Conv[]>(supabase.from('conversations').select('id, player_id, team_id')), []);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <PageHero kicker="הודעות" title="שיחות" />
      <Loading loading={loading || convs.loading} error={error || convs.error} />
      {teams.map((t) => (
        <Card key={t.id} title={`ערוץ ${t.name}`}>
          <TeamChannel teamId={t.id} canPost={asParent} />
        </Card>
      ))}
      {!!convs.data?.length && (
        <Card title="שיחות אישיות עם המאמן">
          <p className="muted">{asParent ? 'כאן מופיעות כל השיחות האישיות של המאמן עם הילדים שלך.' : ''}</p>
          <ul className="list">
            {convs.data.map((c) => (
              <li key={c.id} className="row">
                <span>{kids.find((k) => k.id === c.player_id)?.full_name}</span>
                <button className="small" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? 'סגירה' : 'פתיחה'}</button>
              </li>
            ))}
          </ul>
          {open && <Conversation id={open} />}
        </Card>
      )}
    </>
  );
}
