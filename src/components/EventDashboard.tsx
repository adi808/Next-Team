import { useEffect, useState } from 'react';
import { KitAvatar } from './Kit';
import { StadiumArt } from './Stadium';
import { useEquipmentNames } from './Equipment';
import { isDemo } from '../lib/supabase';
import type { EventRow, TeamKit } from '../lib/types';

const TZ = 'Asia/Jerusalem';
const day = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('he-IL', { timeZone: TZ, ...opts });

/** "בעוד 2 ימים ו־4 שעות", "מתקיים עכשיו", "הסתיים". */
function countdown(startIso: string, endIso: string | null, now: number): string {
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

function useNow(everyMs = 60_000) {
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

export function EventDashboard({ event, typeLabel, isMatch, kit, attendance }: {
  event: EventRow; typeLabel: string; isMatch: boolean; kit?: TeamKit;
  attendance?: { yes: number; no: number; pending: number };
}) {
  const now = useNow();
  const equipment = useEquipmentNames()(event.equipment);
  const weather = useWeather(event.location, event.starts_at);
  const time = (iso: string) => day(iso, { hour: '2-digit', minute: '2-digit' });
  const when = countdown(event.starts_at, event.ends_at, now);
  const q = encodeURIComponent(event.location);
  const [icon, label] = weather ? describe(weather.code).slice(1) as [string, string] : ['', ''];
  return (
    <section className={`event-hero ${isMatch ? 'match' : ''}`}>
      <div className="event-hero-top">
        {isMatch && <StadiumArt />}
        <div className="date-badge">
          <span>{day(event.starts_at, { weekday: 'short' })}</span>
          <strong>{day(event.starts_at, { day: 'numeric' })}</strong>
          <span>{day(event.starts_at, { month: 'short' })}</span>
        </div>
        <div className="event-hero-text">
          <span className="event-type">{typeLabel}</span>
          <h2>{event.title || typeLabel}{event.opponent ? ` נגד ${event.opponent}` : ''}</h2>
          <span>{time(event.starts_at)}{event.ends_at ? `–${time(event.ends_at)}` : ''}{event.location ? ` · ${event.location}` : ''}</span>
          <span className="countdown">{when}</span>
        </div>
        {isMatch && event.our_score !== null && <div className="score">{event.our_score}:{event.their_score}</div>}
      </div>
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
