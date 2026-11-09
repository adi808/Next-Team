import { useId } from 'react';
import { useSignedUrl } from './Picture';
import { inkOn, initials } from '../lib/share';
import { shade, type Colors } from '../lib/brand';

/**
 * The team bus: a coach painted in the event's kit colours (body in the shirt colour, a swoosh in the second
 * colour), with the club logo (or the initials) and the team name on its side.
 */
export function TeamBus({ teamName, clubName, logoPath, colors, count }: {
  teamName: string; clubName?: string; logoPath?: string | null; colors: Colors;
  /** passengers so far, shown in the windows */
  count?: number;
}) {
  const id = useId().replace(/:/g, '');
  const logo = useSignedUrl('club-media', logoPath);
  const { primary, secondary } = colors;
  const ink = inkOn(primary);
  const glass = '#13203d';
  const name = teamName.trim() || clubName?.trim() || '';
  const sub = clubName && !name.includes(clubName.trim()) ? clubName.trim() : '';
  const size = Math.max(14, Math.min(30, 300 / Math.max(1, name.length * 0.56)));
  const subSize = Math.max(11, Math.min(16, 260 / Math.max(1, sub.length * 0.56)));
  return (
    <svg className="team-bus" viewBox="0 0 640 250" role="img" aria-label={`אוטובוס ההסעה של ${name}`}>
      <defs>
        <clipPath id={`${id}-body`}>
          <path d="M28 40Q28 28 42 28H520Q560 28 580 50L606 110Q612 124 612 140V196Q612 208 600 208H40Q28 208 28 196Z" />
        </clipPath>
        <clipPath id={`${id}-logo`}><circle cx="96" cy="140" r="29" /></clipPath>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" /><stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <ellipse cx="320" cy="234" rx="300" ry="9" fill="#000" opacity="0.14" />
      <g clipPath={`url(#${id}-body)`}>
        <rect x="20" y="20" width="600" height="200" fill={primary} />
        <path d="M28 182C180 150 330 216 470 162S600 126 612 132V210H28Z" fill={secondary} />
        <path d="M28 174C180 142 330 208 470 154S600 118 612 124" fill="none" stroke={shade(secondary, 0.55)} strokeWidth="4" opacity="0.8" />
        <rect x="20" y="20" width="600" height="200" fill={`url(#${id}-shine)`} />
      </g>
      <path d="M28 40Q28 28 42 28H520Q560 28 580 50L606 110Q612 124 612 140V196Q612 208 600 208H40Q28 208 28 196Z" fill="none" stroke="rgba(0,0,0,0.25)" strokeWidth="2" />
      {/* side windows */}
      <rect x="44" y="44" width="396" height="58" rx="10" fill={glass} />
      {[1, 2, 3, 4, 5].map((i) => <rect key={i} x={44 + i * 66 - 3} y="44" width="6" height="58" fill={primary} />)}
      <path d="M52 50h120l-30 46H52z" fill="#fff" opacity="0.08" />
      {/* door and windscreen */}
      <rect x="452" y="44" width="40" height="154" rx="6" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="2.5" />
      <rect x="457" y="49" width="30" height="74" rx="4" fill={glass} />
      <path d="M506 44H540Q560 46 572 66L596 118Q598 128 588 128H506Z" fill={glass} />
      <path d="M512 50h26l-18 70h-8z" fill="#fff" opacity="0.1" />
      {/* mirror, lights, bumper */}
      <path d="M560 40q24-6 34 14l-4 2q-8-12-28-10z" fill="#1b1f2a" />
      <rect x="586" y="54" width="10" height="22" rx="3" fill="#1b1f2a" />
      <path d="M590 158h18v12q-8 3-18 0z" fill="#fff7d1" stroke="rgba(0,0,0,0.2)" />
      <rect x="560" y="186" width="52" height="12" rx="4" fill={shade(secondary, -0.3)} />
      {/* wheels */}
      {[120, 520].map((x) => (
        <g key={x}>
          <circle cx={x} cy="208" r="32" fill="rgba(0,0,0,0.55)" />
          <circle cx={x} cy="208" r="25" fill="#1b1f2a" />
          <circle cx={x} cy="208" r="12" fill="#cbd5e1" />
          <circle cx={x} cy="208" r="4" fill="#64748b" />
        </g>
      ))}
      {/* club crest */}
      <circle cx="96" cy="140" r="34" fill="#fff" stroke={secondary} strokeWidth="3" />
      {logo ? (
        <image href={logo} x="67" y="111" width="58" height="58" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id}-logo)`} />
      ) : (
        <>
          <circle cx="96" cy="140" r="27" fill={secondary} />
          <text x="96" y="149" textAnchor="middle" fontSize="24" fontWeight="900" fill={inkOn(secondary)}>{initials(sub || name)}</text>
        </>
      )}
      {/* name on the side */}
      <text x="290" y="140" textAnchor="middle" direction="rtl" fontSize={size} fontWeight="900" fill={ink}>{name}</text>
      {sub && <text x="290" y="162" textAnchor="middle" direction="rtl" fontSize={subSize} fontWeight="700" fill={ink} opacity="0.85">{sub}</text>}
      {count !== undefined && count > 0 && (
        <g>
          <rect x="300" y="56" width="128" height="34" rx="17" fill="#fff" />
          <text x="364" y="79" textAnchor="middle" direction="rtl" fontSize="17" fontWeight="800" fill={glass}>{`${count} נוסעים`}</text>
        </g>
      )}
    </svg>
  );
}
