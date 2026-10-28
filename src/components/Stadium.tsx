/** Background of a match header: a modern stadium at night, packed stands under floodlights, seen from the side. */
export function StadiumArt() {
  // points on the touchlines of the pitch, far edge (y 215) to near edge (y 400)
  const box = 'M112 261 H207 L87 354 H-62 Z M688 261 H593 L713 354 H862 Z';
  return (
    <svg className="stadium-art" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="st-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#040814" /><stop offset="1" stopColor="#0d1a3a" />
        </linearGradient>
        <radialGradient id="st-glow">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" /><stop offset="0.25" stopColor="#dbeafe" stopOpacity="0.45" />
          <stop offset="1" stopColor="#dbeafe" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="st-haze" cx="0.5" cy="0.35" r="0.6">
          <stop offset="0" stopColor="#e0f2fe" stopOpacity="0.28" /><stop offset="1" stopColor="#e0f2fe" stopOpacity="0" />
        </radialGradient>
        <pattern id="st-crowd" width="7" height="6" patternUnits="userSpaceOnUse">
          <rect width="7" height="6" fill="#141a2b" />
          <circle cx="1.2" cy="1.3" r="1.1" fill="#facc15" /><circle cx="4.6" cy="1" r="1" fill="#e5e7eb" />
          <circle cx="2.8" cy="4.2" r="1.1" fill="#dc2626" /><circle cx="6" cy="4.4" r="1" fill="#facc15" />
          <circle cx="0.2" cy="4.6" r="0.9" fill="#3b82f6" />
        </pattern>
        <pattern id="st-crowd-near" href="#st-crowd" patternTransform="scale(2.2)" />
        <linearGradient id="st-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#040814" stopOpacity="0.4" /><stop offset="1" stopColor="#040814" stopOpacity="0" />
        </linearGradient>
        <clipPath id="st-pitch"><path d="M200 215 H600 L950 400 H-150 Z" /></clipPath>
      </defs>
      <rect width="800" height="400" fill="url(#st-sky)" />
      {/* far stands, two tiers */}
      <path d="M-20 70 Q400 140 820 70 V250 Q400 205 -20 250 Z" fill="url(#st-crowd)" />
      <path d="M-20 70 Q400 140 820 70 V250 Q400 205 -20 250 Z" fill="url(#st-fade)" />
      <path d="M-20 158 Q400 196 820 158" fill="none" stroke="#0b1020" strokeWidth="7" />
      {/* roof with floodlights along its edge */}
      <path d="M-20 0 H820 V60 Q400 128 -20 60 Z" fill="#070b16" />
      <path d="M-20 60 Q400 128 820 60" fill="none" stroke="#1e293b" strokeWidth="3" />
      <g fill="#fff">
        {[140, 215, 290, 365, 435, 510, 585, 660].map((x, i) => {
          const t = (x + 20) / 840, y = 60 + 136 * t * (1 - t) - 3;
          return <g key={i}><circle cx={x} cy={y} r="36" fill="url(#st-glow)" /><rect x={x - 9} y={y - 2.5} width="18" height="5" rx="2" /></g>;
        })}
      </g>
      {/* pitch with mowing stripes and lines */}
      <g clipPath="url(#st-pitch)">
        <rect y="215" width="800" height="185" fill="#2f8f3a" />
        {[[215, 20], [255, 35], [325, 45]].map(([y, h]) => <rect key={y} y={y} width="800" height={h} fill="#3aa346" />)}
        <rect y="385" width="800" height="15" fill="#3aa346" />
      </g>
      <g fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="2">
        <path d="M212 221 H588 L900 392 H-100 Z" />
        <path d="M400 221 V392" />
        <ellipse cx="400" cy="290" rx="92" ry="30" />
        <path d={box} />
      </g>
      <rect y="200" width="800" height="200" fill="url(#st-haze)" />
      {/* near stands in the corners */}
      <path d="M-20 300 L120 400 H-20 Z M820 300 L680 400 H820 Z" fill="url(#st-crowd-near)" />
    </svg>
  );
}
