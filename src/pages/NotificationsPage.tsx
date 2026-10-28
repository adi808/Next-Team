import { useEffect } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDate, q, rpc, useLoad } from '../lib/db';
import { Empty, Loading } from '../components/ui';

export interface NotificationRow { id: string; title: string; body: string; url: string; created_at: string; read_at: string | null }

/** The in-app list behind the bell. Opening it marks everything as read. */
export default function NotificationsPage() {
  const { refresh: onRead } = useOutletContext<{ refresh: () => void }>();
  const { data, loading, error } = useLoad(
    () => q<NotificationRow[]>(supabase.from('notifications').select('id, title, body, url, created_at, read_at').order('created_at', { ascending: false }).limit(50)),
    [],
  );
  useEffect(() => {
    if (data?.some((n) => !n.read_at)) rpc('mark_notifications_read').then(onRead, () => {});
  }, [data, onRead]);
  if (!data) return <Loading loading={loading} error={error} />;
  return (
    <>
      <h2>התראות</h2>
      {!data.length && <Empty>אין התראות.</Empty>}
      <ul className="list notif-list">
        {data.map((n) => (
          <li key={n.id} className={n.read_at ? '' : 'unread'}>
            <Link to={n.url}>
              <strong>{n.title}</strong>
              <span>{n.body}</span>
              <small className="muted">{fmtDate(n.created_at)}</small>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
