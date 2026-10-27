import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDate } from '../lib/db';
import { useAuth } from '../auth/AuthProvider';
import { ErrorText, Loading, Empty } from './ui';
import { useNames } from './People';

interface Msg { id: string; author_id: string; body: string; created_at: string }

function MessageList({ messages, names }: { messages: Msg[]; names: (id: string) => string }) {
  const { profile } = useAuth();
  if (!messages.length) return <Empty>עדיין אין הודעות.</Empty>;
  return (
    <ul className="chat">
      {messages.map((m) => (
        <li key={m.id} className={m.author_id === profile?.id ? 'mine' : ''}>
          <small>{names(m.author_id)} · {fmtDate(m.created_at)}</small>
          <p>{m.body}</p>
        </li>
      ))}
    </ul>
  );
}

function Composer({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [body, setBody] = useState('');
  const act = useAction();
  return (
    <form className="composer" onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; await act.run(async () => { await onSend(body); setBody(''); }); }}>
      <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="כתבו הודעה…" />
      <button disabled={act.busy}>שליחה</button>
      <ErrorText error={act.error} />
    </form>
  );
}

/** The one channel of a team. Staff and parents write; players only read. */
export function TeamChannel({ teamId, canPost }: { teamId: string; canPost: boolean }) {
  const { data, loading, error, reload } = useLoad(
    () => q<Msg[]>(supabase.from('messages').select('id, author_id, body, created_at').eq('team_id', teamId).order('created_at')),
    [teamId],
  );
  const names = useNames((data ?? []).map((m) => m.author_id));
  return (
    <>
      <Loading loading={loading} error={error} />
      <MessageList messages={data ?? []} names={names} />
      {canPost ? <Composer onSend={async (b) => { await rpc('post_message', { p_team: teamId, p_body: b }); reload(); }} /> : <small className="muted">שחקנים קוראים בלבד.</small>}
    </>
  );
}

/** A personal coach <-> player conversation; the player's parents see all of it. */
export function Conversation({ id }: { id: string }) {
  const { data, loading, error, reload } = useLoad(
    () => q<Msg[]>(supabase.from('direct_messages').select('id, author_id, body, created_at').eq('conversation_id', id).order('created_at')),
    [id],
  );
  const names = useNames((data ?? []).map((m) => m.author_id));
  return (
    <>
      <Loading loading={loading} error={error} />
      <MessageList messages={data ?? []} names={names} />
      <Composer onSend={async (b) => { await rpc('post_direct_message', { p_conversation: id, p_body: b }); reload(); }} />
    </>
  );
}
