import { useEffect, useState } from 'react';
import { KitAvatar } from './Kit';
import { useEquipmentNames } from './Equipment';
import { isDemo } from '../lib/supabase';
import { dayName, israelDow, israelTime } from '../lib/events';
import type { EventRow, TeamKit } from '../lib/types';

const TZ = 'Asia/Jerusalem';
const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('he-IL', { timeZone: TZ, ...opts });

/** "בעוד 2 ימים ו־4 שעות", "מתקיים עכשיו", "הסתיים". */
export function countdown(startIso: string, endIso: string | null, now: number): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : start + 90 * 60_000;
  if (now >= end) return 'הסתיים';
  if (now >= start) return 'מתקיים עכשיו';
  const mins = Math.round((start - now) / 60_000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  const part = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);
  if (d > 0) return `בעוד ${part(d, 'יום', 'ימים')}${h ? ` ו־${part(h, 'שעה', 'שעות')}` : ''}`;
  if (h > 0) return `בעוד ${part(h, 'שעה', 'שעות')}${m ? ` ו־${part(m, 'דקה', 'דקות')}` : ''}`;
  return `בעוד ${part(m, 'דקה', 'דקות')}`;
}

export function useNow(everyMs = 60_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

// ---- weather (Open-Meteo: free, no key; forecasts reach 16 days ahead)
interface Weather { temp: number; rain: number; code: number }
const WEATHER: [number[], string, string][] = [
  [[0], '☀️', 'בהיר'], [[1, 2], '🌤️', 'מעונן חלקית'], [[3], '☁️', 'מעונן'], [[45, 48], '🌫️', 'ערפל'],
  [[51, 53, 55, 56, 57], '🌦️', 'טפטוף'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'גשם'],
  [[71, 73, 75, 77, 85, 86], '❄️', 'שלג'], [[95, 96, 99], '⛈️', 'סופת רעמים'],
];
const describe = (code: number) => WEATHER.find(([codes]) => codes.includes(code)) ?? WEATHER[2];
const places = new Map<string, Promise<{ lat: number; lon: number } | null>>();

async function geocode(location: string) {
  // Try the whole text, then each comma-separated part from the end (the town is usually last).
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  for (const name of [location.trim(), ...parts.reverse()]) {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=he&format=json&name=${encodeURIComponent(name)}`);
    const hit = (await r.json())?.results?.[0];
    if (hit) return { lat: hit.latitude as number, lon: hit.longitude as number };
  }
  return null;
}

function useWeather(location: string, startIso: string) {
  const [w, setW] = useState<Weather | null>(null);
  useEffect(() => {
    setW(null);
    const ahead = new Date(startIso).getTime() - Date.now();
    // The demo's places are made up, so it skips the forecast (and works offline).
    if (isDemo || !location.trim() || ahead < -3 * 3600_000 || ahead > 15 * 86400_000) return;
    let cancelled = false;
    const key = location.trim();
    if (!places.has(key)) places.set(key, geocode(key).catch(() => null));
    places.get(key)!.then(async (pos) => {
      if (!pos || cancelled) return;
      const date = day(startIso, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('.').reverse().join('-');
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}`
        + `&hourly=temperature_2m,precipitation_probability,weather_code&timezone=${encodeURIComponent(TZ)}&start_date=${date}&end_date=${date}`);
      const h = (await r.json())?.hourly;
      if (!h || cancelled) return;
      const hour = Number(day(startIso, { hour: '2-digit', hourCycle: 'h23' }));
      setW({ temp: Math.round(h.temperature_2m[hour]), rain: h.precipitation_probability[hour] ?? 0, code: h.weather_code[hour] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [location, startIso]);
  return w;
}

// ---- attendance ring
function Donut({ yes, no, pending }: { yes: number; no: number; pending: number }) {
  const total = yes + no + pending || 1;
  const r = 30, c = 2 * Math.PI * r;
  const seg = (n: number, offset: number, colour: string) => (
    <circle r={r} cx="40" cy="40" fill="none" stroke={colour} strokeWidth="11"
      strokeDasharray={`${(n / total) * c} ${c}`} strokeDashoffset={-offset * c / total} transform="rotate(-90 40 40)" />
  );
  return (
    <div className="donut">
      <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
        <circle r={r} cx="40" cy="40" fill="none" stroke="#e9edf3" strokeWidth="11" />
        {seg(yes, 0, '#16a34a')}{seg(no, yes, '#ef4444')}
        <text x="40" y="45" textAnchor="middle" className="donut-num">{yes}</text>
      </svg>
      <ul>
        <li><i style={{ background: '#16a34a' }} />מגיעים {yes}</li>
        <li><i style={{ background: '#ef4444' }} />לא מגיעים {no}</li>
        <li><i style={{ background: '#cbd3df' }} />טרם ענו {pending}</li>
      </ul>
    </div>
  );
}

const initials = (name: string) => {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '?').slice(0, 2)).toUpperCase();
};

/** "היום", "מחר", or "יום ראשון, 2.11". */
function dayLabel(iso: string): string {
  const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  const d = ymd(new Date(iso));
  if (d === ymd(new Date())) return 'היום';
  if (d === ymd(new Date(Date.now() + 86_400_000))) return 'מחר';
  return `יום ${dayName(israelDow(iso))}, ${day(iso, { day: 'numeric', month: 'numeric' })}`;
}

/**
 * The event as a poster: team and kind, the two sides of a match with VS (or the score), the day, a big start time,
 * the place and the countdown. The accent follows the team's kit colour. Same look as the shareable banner.
 */
export function EventPoster({ event, typeLabel, isMatch, teamName, kit, heading }: {
  event: EventRow; typeLabel: string; isMatch: boolean; teamName?: string; kit?: TeamKit; heading?: string;
}) {
  const now = useNow();
  // a white or very light shirt would vanish on the dark poster: fall back to the app blue
  const shirt = kit?.shirt ?? '';
  const light = /^#[0-9a-f]{6}$/i.test(shirt) && (0.299 * parseInt(shirt.slice(1, 3), 16) + 0.587 * parseInt(shirt.slice(3, 5), 16) + 0.114 * parseInt(shirt.slice(5, 7), 16)) > 185;
  const team = shirt && !light ? shirt : '#2563eb';
  const both = isMatch && !!event.opponent;
  const score = isMatch && event.our_score !== null && event.their_score !== null;
  const time = `${israelTime(event.starts_at)}${event.ends_at ? `–${israelTime(event.ends_at)}` : ''}`;
  const name = teamName || typeLabel;
  return (
    <section className="poster" style={{ ['--team' as string]: team }}>
      <div className="poster-top">
        <div>
          <strong className="poster-team">{name}</strong>
          <small>{heading ? `${heading} · ${typeLabel}` : typeLabel}</small>
        </div>
        <span className="poster-count">{countdown(event.starts_at, event.ends_at, now)}</span>
      </div>
      <span className="poster-tag">{isMatch ? 'יום משחק' : typeLabel}</span>
      {both && (
        <div className="poster-vs">
          <div><i className="crest" style={{ background: team }}>{initials(name)}</i><small>{name}</small></div>
          <b dir="ltr">{score ? `${event.our_score}:${event.their_score}` : 'VS'}</b>
          <div><i className="crest light">{initials(event.opponent ?? '')}</i><small>{event.opponent}</small></div>
        </div>
      )}
      <div className="poster-day">{dayLabel(event.starts_at)}</div>
      <div className="poster-time" dir="ltr">{time}</div>
      {event.location && (
        <div className="poster-loc">
          <svg width="18" height="22" viewBox="0 0 18 22" aria-hidden="true"><path d="M9 0C4 0 0 4 0 9c0 6.5 9 13 9 13s9-6.5 9-13c0-5-4-9-9-9zm0 12.5A3.5 3.5 0 1 1 9 5.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" /></svg>
          {event.location}
        </div>
      )}
    </section>
  );
}

export function EventDashboard({ event, typeLabel, isMatch, kit, attendance, teamName }: {
  event: EventRow; typeLabel: string; isMatch: boolean; kit?: TeamKit; teamName?: string;
  attendance?: { yes: number; no: number; pending: number };
}) {
  const equipment = useEquipmentNames()(event.equipment);
  const weather = useWeather(event.location, event.starts_at);
  const q = encodeURIComponent(event.location);
  const [icon, label] = weather ? describe(weather.code).slice(1) as [string, string] : ['', ''];
  return (
    <section className={`event-hero ${isMatch ? 'match' : ''}`}>
      <EventPoster event={event} typeLabel={typeLabel} isMatch={isMatch} teamName={teamName} kit={kit} />
      <div className="event-tiles">
        {attendance && <div className="tile"><h4>הגעה</h4><Donut {...attendance} /></div>}
        {kit && (
          <div className="tile kit-tile"><h4>תלבושת</h4><KitAvatar kit={kit} size={84} /><strong>{kit.name}</strong></div>
        )}
        {equipment.length > 0 && (
          <div className="tile bring"><h4>מה להביא</h4>
            <ul>{equipment.map((n) => <li key={n}>✓ {n}</li>)}</ul>
          </div>
        )}
        {weather && (
          <div className="tile weather"><h4>מזג אוויר</h4><span className="weather-icon">{icon}</span>
            <strong>{weather.temp}°</strong><small>{label} · גשם {weather.rain}%</small></div>
        )}
        {event.location && (
          <div className="tile nav"><h4>ניווט</h4>
            <a className="nav-btn waze" href={`https://waze.com/ul?q=${q}&navigate=yes`} target="_blank" rel="noreferrer">Waze</a>
            <a className="nav-btn" href={`https://www.google.com/maps/search/?api=1&query=${q}`} target="_blank" rel="noreferrer">Google Maps</a>
          </div>
        )}
      </div>
    </section>
  );
}
