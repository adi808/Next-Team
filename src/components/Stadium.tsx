/** Background of a match header: the pitch from above, striped, with its lines, a ball and a floodlit glow. */
export function StadiumArt() {
  return (
    <svg className="stadium-art" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="pa-vignette" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0.35" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#03120a" stopOpacity="0.78" />
        </radialGradient>
        <radialGradient id="pa-spot" cx="0.5" cy="0.45" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="pa-shade" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.28" />
        </radialGradient>
      </defs>
      {Array.from({ length: 8 }, (_, i) => <rect key={i} x={i * 100} width="100" height="400" fill={i % 2 ? '#1f8f45' : '#27a653'} />)}
      <g fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="4">
        <rect x="30" y="30" width="740" height="340" />
        <line x1="400" y1="30" x2="400" y2="370" />
        <circle cx="400" cy="200" r="62" />
        <rect x="30" y="110" width="110" height="180" />
        <rect x="660" y="110" width="110" height="180" />
        <rect x="30" y="152" width="44" height="96" />
        <rect x="726" y="152" width="44" height="96" />
        <path d="M140 160a52 52 0 0 1 0 80M660 160a52 52 0 0 0 0 80" />
      </g>
      <circle cx="400" cy="200" r="6" fill="#fff" />
      <g transform="translate(250 120) rotate(20)">
        <circle r="15" fill="#fff" />
        <path d="M0-5.1 4.8-1.6 2.9 4.1h-5.8l-1.9-5.7z" fill="#0b1f4d" />
        <circle r="15" fill="url(#pa-shade)" />
      </g>
      <rect width="800" height="400" fill="url(#pa-spot)" />
      <rect width="800" height="400" fill="url(#pa-vignette)" />
    </svg>
  );
}
