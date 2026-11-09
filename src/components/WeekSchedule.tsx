import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { q, useLoad } from '../lib/db';
import { eventHeading, israelTime } from '../lib/events';
import { canvasBlob } from '../lib/share';
import { kitColors, kitFor, useTeamBrand } from '../lib/brand';
import { dayTitle, drawWeek, shortDate, weekDays, weekLabel, weekWindow, ymdIL, type WeekItem, type WeekPoster } from '../lib/week';
import { useLookups } from './Lookups';
import { KitAvatar } from './Kit';
import { useSignedUrl } from './Picture';
import { TransportChip, useTransportTotals } from './Transport';
import { Badge, ErrorText, Loading } from './ui';
import type { EventResponse, EventRow, Player, TeamKit } from '../lib/types';

const time = (e: EventRow) => `${israelTime(e.starts_at)}${e.ends_at ? `–${israelTime(e.ends_at)}` : ''}`;

/**
 * The week at a glance, Sunday to Saturday with arrows to other weeks: every training and match of the given teams,
 * each in its kit colours. For a parent (or a player) it is personal: each child's answer is shown on the event.
 * Staff can turn the week into a poster and a message to share in WhatsApp.
 */
export function WeekSchedule({ teams, kids = [], links = [], canShare = false }: {
  teams: { id: string; name: string }[];
  /** the children whose answers are shown (a parent's kids, or the player); only those on the event's team */
  kids?: Pick<Player, 'id' | 'full_name'>[];
  links?: { team_id: string; player_id: string }[];
  canShare?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [sharing, setSharing] = useState(false);
  const days = useMemo(() => weekDays(offset), [offset]);
  const types = useLookups('event_type', { includeInactive: true });
  const equipment = useLookups('equipment', { includeInactive: true });
  const tids = teams.map((t) => t.id).join(',');
  const kidIds = kids.map((k) => k.id).join(',');
  const { data, loading, error } = useLoad(async () => {
    if (!teams.length) return { events: [] as EventRow[], kits: [] as TeamKit[], responses: [] as EventResponse[] };
    const { from, to } = weekWindow(days);
    const rows = await q<EventRow[]>(supabase.from('events').select('*').in('team_id', teams.map((t) => t.id))
      .gte('starts_at', from).lte('starts_at', to).order('starts_at'));
    const events = rows.filter((e) => days.includes(ymdIL(e.starts_at)));
    const kits = await q<TeamKit[]>(supabase.from('team_kits').select('*').in('team_id', teams.map((t) => t.id)).order('sort_order'));
    const responses = events.length && kids.length
      ? await q<EventResponse[]>(supabase.from('event_responses').select('*').in('event_id', events.map((e) => e.id)).in('player_id', kids.map((k) => k.id)))
      : [];
    return { events, kits, responses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tids, kidIds, days.join()]);
  const events = data?.events ?? [];
  const transport = useTransportTotals(events);
  const today = ymdIL(new Date());
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? '';
  const kitOf = (e: EventRow) => kitFor(data?.kits ?? [], e.team_id, e.kit_id);
  const eventKit = (e: EventRow) => data?.kits.find((k) => k.id === e.kit_id);
  const byDay = days.map((d) => ({ day: d, events: events.filter((e) => ymdIL(e.starts_at) === d) })).filter((g) => g.events.length);
  const title = offset === 0 ? 'השבוע שלי' : offset === 1 ? 'שבוע הבא' : offset === -1 ? 'שבוע שעבר' : 'לו"ז שבועי';

  const answer = (e: EventRow, kid: Pick<Player, 'id' | 'full_name'>) => {
    const r = data?.responses.find((x) => x.event_id === e.id && x.player_id === kid.id);
    const who = kids.length > 1 ? `${kid.full_name.split(' ')[0]} ` : '';
    if (r?.status === 'attending') return <Badge key={kid.id} tone="ok">✓ {who}מגיע/ה</Badge>;
    if (r?.status === 'not_attending') return <Badge key={kid.id} tone="bad">{who}לא מגיע/ה</Badge>;
    return <Badge key={kid.id} tone="warn">{who}טרם אישר/ה</Badge>;
  };

  return (
    <section className="card week">
      <div className="week-head">
        <button className="small secondary" onClick={() => setOffset(offset - 1)} aria-label="השבוע הקודם">→</button>
        <div className="grow">
          <h3>{title}</h3>
          <small className="muted" dir="ltr">{weekLabel(days)}</small>
        </div>
        <button className="small secondary" onClick={() => setOffset(offset + 1)} aria-label="השבוע הבא">←</button>
      </div>
      {offset !== 0 && <button className="link" onClick={() => setOffset(0)}>חזרה לשבוע הנוכחי</button>}
      <Loading loading={loading} error={error} />
      {data && !byDay.length && <p className="muted">אין אירועים בשבוע הזה.</p>}
      {byDay.map((g) => (
        <div key={g.day} className={`week-day${g.day === today ? ' today' : ''}${g.day < today ? ' past' : ''}`}>
          <div className="week-date">
            <strong>{dayTitle(g.day).replace('יום ', '')}</strong>
            <span dir="ltr">{shortDate(g.day)}</span>
            {g.day === today && <small>היום</small>}
          </div>
          <div className="week-events">
            {g.events.map((e) => {
              const type = typeOf(e.type_id);
              const colors = kitColors(kitOf(e));
              const kit = eventKit(e);
              const head = eventHeading(e, type?.name_he ?? '', teamName(e.team_id));
              const mine = kids.filter((k) => links.some((l) => l.team_id === e.team_id && l.player_id === k.id));
              return (
                <Link key={e.id} to={`../event/${e.id}`} className={`week-event${e.cancelled_at ? ' cancelled' : ''}`}
                  style={{ ['--kit' as string]: colors.primary, ['--kit2' as string]: colors.secondary }}>
                  <div className="week-event-top">
                    <Badge>{type?.name_he ?? 'אירוע'}</Badge>
                    {e.cancelled_at && <Badge tone="bad">בוטל</Badge>}
                    <strong className="grow">{head !== type?.name_he ? head : teams.length > 1 ? teamName(e.team_id) : ''}</strong>
                    <span className="week-time" dir="ltr">{time(e)}</span>
                  </div>
                  <div className="week-event-meta">
                    {e.location && <span>📍 {e.location}</span>}
                    {teams.length > 1 && head !== teamName(e.team_id) && <span className="muted">{teamName(e.team_id)}</span>}
                    {kit && <span className="row"><KitAvatar kit={kit} size={22} />{kit.name}</span>}
                    <TransportChip total={transport.get(e.id)} />
                  </div>
                  {mine.length > 0 && !e.cancelled_at && <div className="row wrap">{mine.map((k) => answer(e, k))}</div>}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {canShare && teams[0] && (
        sharing
          ? <WeekShare teamId={teams[0].id} days={days} events={events} kits={data?.kits ?? []}
              typeName={(id) => typeOf(id)?.name_he ?? ''} equipmentName={(id) => equipment.find((l) => l.id === id)?.name_he ?? ''}
              onClose={() => setSharing(false)} />
          : <button className="secondary" disabled={!events.length} onClick={() => setSharing(true)}>📤 תמונת לו"ז לשיתוף בוואטסאפ</button>
      )}
    </section>
  );
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The week as a poster and a WhatsApp message, for the staff to share with the team. */
function WeekShare({ teamId, days, events, kits, typeName, equipmentName, onClose }: {
  teamId: string; days: string[]; events: EventRow[]; kits: TeamKit[];
  typeName: (id: string) => string; equipmentName: (id: string) => string; onClose: () => void;
}) {
  const brand = useTeamBrand(teamId);
  const logoUrl = useSignedUrl('club-media', brand.data?.logoPath);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!logoUrl) { setLogo(null); return; }
    let cancelled = false;
    loadImage(logoUrl).then((img) => { if (!cancelled) setLogo(img); });
    return () => { cancelled = true; };
  }, [logoUrl]);

  const poster: WeekPoster | null = useMemo(() => {
    if (!brand.data) return null;
    const live = events.filter((e) => !e.cancelled_at);
    const items: WeekItem[] = events.map((e) => {
      const kit = kits.find((k) => k.id === e.kit_id);
      return {
        day: ymdIL(e.starts_at), typeLabel: typeName(e.type_id) || 'אירוע',
        heading: e.opponent ? `נגד ${e.opponent}` : (e.title && e.title !== typeName(e.type_id) ? e.title : ''),
        time: time(e), location: e.location ?? '', kitName: kit?.name ?? '',
        colors: kitColors(kitFor(kits, e.team_id, e.kit_id)), cancelled: !!e.cancelled_at, transport: e.has_transport,
      };
    });
    const equipment = [...new Set(live.flatMap((e) => e.equipment ?? []).map(equipmentName).filter(Boolean))];
    const { clubName, teamName } = brand.data;
    return {
      title: clubName && !teamName.includes(clubName) ? `${clubName} · ${teamName}` : teamName,
      subtitle: 'לו"ז אירועים לשבוע', range: weekLabel(days), items, equipment,
      colors: kitColors(kitFor(kits, teamId, null)),
    };
  }, [brand.data, events, kits, days, teamId, typeName, equipmentName]);

  useEffect(() => {
    if (!poster) return;
    const c = canvas.current ?? (canvas.current = document.createElement('canvas'));
    drawWeek(c, poster, logo);
    try { setPreview(c.toDataURL('image/png')); } catch {
      // a logo the browser will not let us export: draw the poster without it
      drawWeek(c, poster, null);
      setPreview(c.toDataURL('image/png'));
    }
  }, [poster, logo]);

  const text = useMemo(() => {
    if (!poster) return '';
    const lines = [`📅 *${poster.title} · ${poster.subtitle}* (${poster.range})`, ''];
    for (const e of events) {
      const kit = kits.find((k) => k.id === e.kit_id);
      const d = ymdIL(e.starts_at);
      const parts = [`*${dayTitle(d)} ${shortDate(d)}*`, `${typeName(e.type_id)}${e.opponent ? ` נגד ${e.opponent}` : ''}`, time(e)];
      if (e.location) parts.push(`📍 ${e.location}`);
      if (kit) parts.push(`👕 ${kit.name}`);
      if (e.has_transport) parts.push('🚌 הסעה');
      lines.push(e.cancelled_at ? `❌ ~${parts.join(' · ')}~ (בוטל)` : `• ${parts.join(' · ')}`);
    }
    if (poster.equipment.length) lines.push('', `🎒 ציוד: ${poster.equipment.join(', ')}`);
    return lines.join('\n');
  }, [poster, events, kits, typeName]);

  async function file(): Promise<File | null> {
    const blob = canvas.current ? await canvasBlob(canvas.current) : null;
    return blob ? new File([blob], 'week.png', { type: 'image/png' }) : null;
  }
  async function share() {
    setError(null);
    try {
      const f = await file();
      if (f && navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], text });
      else await navigator.share({ text });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('השיתוף לא הצליח. אפשר להוריד את התמונה ולהעתיק את הטקסט.');
    }
  }
  async function download() {
    const f = await file();
    if (!f) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f); a.download = `next-team-week-${days[0]}.png`; a.click();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setMsg('הטקסט הועתק'); } catch { setError('לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית.'); }
  }
  return (
    <div className="stack week-share">
      <div className="row"><strong className="grow">תמונת לו"ז לשבוע {weekLabel(days)}</strong><button className="small secondary" onClick={onClose}>סגירה</button></div>
      <Loading loading={brand.loading} error={brand.error} />
      {preview && <img className="share-preview" src={preview} alt='תצוגה מקדימה של לו"ז השבוע' />}
      <textarea rows={6} readOnly value={text} />
      <div className="row wrap">
        {canShare && <button onClick={share}>שיתוף (תמונה וטקסט)</button>}
        <button className="secondary" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')}>פתיחה בוואטסאפ (טקסט)</button>
        <button className="secondary" onClick={copy}>העתקת טקסט</button>
        <button className="secondary" onClick={download}>הורדת התמונה</button>
      </div>
      {msg && <p className="ok">{msg}</p>}
      <ErrorText error={error} />
    </div>
  );
}
