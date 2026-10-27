import type { Sport } from '../lib/types';

export default function SportIcon({ sport, size = 24 }: { sport: Pick<Sport, 'icon_path' | 'name_he'>; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={sport.name_he}
    >
      <path d={sport.icon_path} />
    </svg>
  );
}
