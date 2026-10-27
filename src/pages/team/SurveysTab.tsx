import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDate } from '../../lib/db';
import { Card, Empty, ErrorText, Field, Loading } from '../../components/ui';
import { useNames } from '../../components/People';
import type { TeamTabProps } from './TeamPage';

interface Survey { id: string; title: string; description: string; closes_at: string | null }
interface Question { id: string; survey_id: string; text: string; kind: 'single' | 'multi' | 'text'; position: number }
interface Option { id: string; question_id: string; label: string; position: number }
interface Answer { id: string; question_id: string; respondent_id: string; option_id: string | null; text_answer: string | null }
interface Draft { text: string; kind: 'single' | 'multi' | 'text'; options: string }

export default function SurveysTab({ team, canManage }: TeamTabProps) {
  const { data, loading, error, reload } = useLoad(async () => {
    const surveys = await q<Survey[]>(supabase.from('surveys').select('id, title, description, closes_at').eq('team_id', team.id).order('created_at', { ascending: false }));
    const sid = surveys.map((s) => s.id);
    const questions = sid.length ? await q<Question[]>(supabase.from('survey_questions').select('*').in('survey_id', sid).order('position')) : [];
    const qid = questions.map((x) => x.id);
    const options = qid.length ? await q<Option[]>(supabase.from('survey_options').select('*').in('question_id', qid).order('position')) : [];
    const answers = qid.length && canManage ? await q<Answer[]>(supabase.from('survey_answers').select('*').in('question_id', qid)) : [];
    return { surveys, questions, options, answers };
  }, [team.id, canManage]);
  const names = useNames((data?.answers ?? []).map((a) => a.respondent_id));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([{ text: '', kind: 'single', options: '' }]);
  const act = useAction();
  const setDraft = (i: number, patch: Partial<Draft>) => setDrafts((l) => l.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  async function create() {
    const questions = drafts.filter((d) => d.text.trim()).map((d) => ({
      text: d.text.trim(), kind: d.kind, options: d.kind === 'text' ? [] : d.options.split('\n').map((o) => o.trim()).filter(Boolean),
    }));
    await act.run(async () => {
      await rpc('create_survey', { p_team: team.id, p_title: title, p_description: description, p_closes: null, p_questions: questions });
      setTitle(''); setDescription(''); setDrafts([{ text: '', kind: 'single', options: '' }]); reload();
    });
  }

  return (
    <>
      <Loading loading={loading} error={error} />
      {data && !data.surveys.length && <Empty>אין עדיין סקרים.</Empty>}
      {data?.surveys.map((s) => (
        <Card key={s.id} title={s.title} actions={canManage && (
          <button className="small secondary" onClick={() => { if (confirm('למחוק את הסקר?')) act.run(async () => { await rpc('delete_survey', { p_survey: s.id }); reload(); }); }}>מחיקה</button>
        )}>
          {s.description && <p>{s.description}</p>}
          {s.closes_at && <small className="muted">נסגר ב־{fmtDate(s.closes_at)}</small>}
          {data.questions.filter((x) => x.survey_id === s.id).map((qn) => (
            <div key={qn.id} className="question">
              <strong>{qn.text}</strong>
              {qn.kind === 'text'
                ? data.answers.filter((a) => a.question_id === qn.id).map((a) => <p key={a.id}><small className="muted">{names(a.respondent_id)}:</small> {a.text_answer}</p>)
                : data.options.filter((o) => o.question_id === qn.id).map((o) => {
                    const n = data.answers.filter((a) => a.option_id === o.id).length;
                    return <div key={o.id} className="row"><span>{o.label}</span><strong>{canManage ? n : ''}</strong></div>;
                  })}
            </div>
          ))}
        </Card>
      ))}
      {canManage && (
        <Card title="סקר חדש">
          <Field label="כותרת"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="הסבר"><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          {drafts.map((d, i) => (
            <fieldset key={i}><legend>שאלה {i + 1}</legend>
              <input value={d.text} onChange={(e) => setDraft(i, { text: e.target.value })} placeholder="השאלה" />
              <select value={d.kind} onChange={(e) => setDraft(i, { kind: e.target.value as Draft['kind'] })}>
                <option value="single">בחירה אחת</option><option value="multi">בחירה מרובה</option><option value="text">תשובה חופשית</option>
              </select>
              {d.kind !== 'text' && <textarea value={d.options} onChange={(e) => setDraft(i, { options: e.target.value })} placeholder="אפשרות בכל שורה" />}
            </fieldset>
          ))}
          <button className="secondary small" onClick={() => setDrafts((l) => [...l, { text: '', kind: 'single', options: '' }])}>עוד שאלה</button>
          <ErrorText error={act.error} />
          <button disabled={!title.trim() || !drafts.some((d) => d.text.trim()) || act.busy} onClick={create}>יצירת סקר</button>
        </Card>
      )}
    </>
  );
}
