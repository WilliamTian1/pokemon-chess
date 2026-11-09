// Small inline SVG illustrations for map features (kept simple so they read at tile size).

export function FlowerIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-[78%] w-[78%] drop-shadow" aria-hidden>
      {[
        [12, 15],
        [27, 12],
        [21, 25],
      ].map(([cx, cy], i) => (
        <g key={i}>
          <path d={`M${cx} ${cy + 3} Q${cx - 1} ${cy + 10} ${cx + 1} ${cy + 14}`} stroke="#2f7d32" strokeWidth="2" fill="none" />
          {[0, 72, 144, 216, 288].map((a) => (
            <circle key={a} cx={cx + 4 * Math.cos((a * Math.PI) / 180)} cy={cy + 4 * Math.sin((a * Math.PI) / 180)} r="3.2" fill={i === 1 ? '#f9a8d4' : '#fde047'} />
          ))}
          <circle cx={cx} cy={cy} r="2.4" fill="#f97316" />
        </g>
      ))}
    </svg>
  );
}

export function BushIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-[86%] w-[86%] drop-shadow" aria-hidden>
      <path
        d="M6 28c-3-6 2-12 7-11 0-6 8-9 12-5 5-3 11 1 10 7 4 3 3 10-2 11-2 4-9 5-12 2-4 3-11 2-15-4z"
        fill="#3f8f3a"
        stroke="#1f5c22"
        strokeWidth="1.5"
      />
      {[
        [13, 22],
        [20, 17],
        [27, 23],
        [18, 28],
        [25, 30],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.6" fill="#ef4444" stroke="#7f1d1d" strokeWidth="0.8" />
      ))}
    </svg>
  );
}

export function TrebuchetIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-[82%] w-[82%] drop-shadow" aria-hidden>
      <rect x="6" y="30" width="28" height="4" rx="1.5" fill="#6b4423" />
      <path d="M12 30 L20 12 L28 30" stroke="#7c4a24" strokeWidth="3" fill="none" strokeLinejoin="round" />
      <path d="M9 21 L33 9" stroke="#a16207" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="33" cy="9" r="3.4" fill="#57534e" stroke="#292524" />
      <rect x="6" y="19" width="6" height="6" rx="1" fill="#44403c" />
      <circle cx="11" cy="34" r="2.5" fill="#3f2a17" />
      <circle cx="29" cy="34" r="2.5" fill="#3f2a17" />
    </svg>
  );
}

export function SpikesIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-[70%] w-[70%]" aria-hidden>
      {[
        [12, 14],
        [27, 15],
        [19, 27],
      ].map(([x, y], i) => (
        <g key={i} stroke="#1f2937" strokeWidth="2.6" strokeLinecap="round">
          <path d={`M${x} ${y} l0 -6 M${x} ${y} l5 4 M${x} ${y} l-5 4`} />
        </g>
      ))}
    </svg>
  );
}

export function WebIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-[86%] w-[86%] opacity-90" aria-hidden>
      <g stroke="#f8fafc" strokeWidth="1.1" fill="none">
        {[0, 45, 90, 135].map((a) => (
          <line key={a} x1={20 - 17 * Math.cos((a * Math.PI) / 180)} y1={20 - 17 * Math.sin((a * Math.PI) / 180)} x2={20 + 17 * Math.cos((a * Math.PI) / 180)} y2={20 + 17 * Math.sin((a * Math.PI) / 180)} />
        ))}
        {[5, 10, 15].map((r) => (
          <polygon key={r} points={Array.from({ length: 8 }, (_, i) => `${20 + r * Math.cos((i * Math.PI) / 4)},${20 + r * Math.sin((i * Math.PI) / 4)}`).join(' ')} />
        ))}
      </g>
    </svg>
  );
}

export function DollIcon() {
  return (
    <svg viewBox="0 0 40 40" className="h-[80%] w-[80%] drop-shadow" aria-hidden>
      <rect x="13" y="12" width="14" height="22" rx="5" fill="#a16207" stroke="#422006" strokeWidth="1.5" />
      <circle cx="20" cy="10" r="6" fill="#4d7c0f" stroke="#1a2e05" strokeWidth="1.5" />
      <circle cx="17.5" cy="19" r="1.4" fill="#1c1917" />
      <circle cx="22.5" cy="19" r="1.4" fill="#1c1917" />
      <path d="M17 24 q3 2 6 0" stroke="#1c1917" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

/** A Poké Ball (decorations and the Play vs Bot button). */
export function PokeBallIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#e3463a" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M2 16a14 14 0 0 0 28 0z" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M2 16h28" stroke="#2a170b" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="4.6" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M8 9.5a9 9 0 0 1 5-3.5" stroke="#fff" strokeOpacity=".55" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Two crossed katanas (hot-seat). */
export function SwordsIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l17 17M26 6L9 23" stroke="#e8e0cc" strokeWidth="2.6" />
      <path d="M6 6l17 17M26 6L9 23" stroke="#2a170b" strokeWidth="0.8" strokeOpacity=".5" />
      <path d="M21 25l4-4M11 25l-4-4" stroke="#d9ab45" strokeWidth="3" />
      <path d="M24.5 26.5l2-2M7.5 26.5l-2-2" stroke="#6e140f" strokeWidth="3" />
    </svg>
  );
}

/** A war banner (online match: rally your friends). */
export function BannerIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M8 3v27" stroke="#2a170b" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M9 5h16l-3 5 3 5H9z" fill="#2f5fb3" stroke="#2a170b" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="16" cy="10" r="2.6" fill="#f2d27a" />
      <circle cx="8" cy="3" r="1.8" fill="#d9ab45" stroke="#2a170b" strokeWidth="1" />
    </svg>
  );
}

/** A Great Ball (medium difficulty). */
export function GreatBallIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#2f6fd6" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M5 11l5-4M27 11l-5-4" stroke="#e3463a" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M2 16a14 14 0 0 0 28 0z" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M2 16h28" stroke="#2a170b" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="4.6" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" />
    </svg>
  );
}

/** An Ultra Ball (hard difficulty). */
export function UltraBallIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="#2b2b2b" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M9.5 3.5v9M22.5 3.5v9" stroke="#f2c94c" strokeWidth="3.6" />
      <path d="M2 16a14 14 0 0 0 28 0z" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" />
      <path d="M2 16h28" stroke="#2a170b" strokeWidth="2.2" />
      <circle cx="16" cy="16" r="4.6" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" />
    </svg>
  );
}

/** A round shield (the Defender). */
export function ShieldIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="#2f62b8" stroke="#2a170b" strokeWidth="2" strokeLinejoin="round" />
      <path d="M16 7l7 2.6V15c0 4.6-3 8-7 9.6z" fill="#5c8de0" />
      <circle cx="16" cy="15" r="3.2" fill="#f2d27a" stroke="#2a170b" strokeWidth="1.2" />
    </svg>
  );
}

/** A spear and pennant (the Attacker). */
export function SpearIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d="M7 27L24 8" stroke="#6b4224" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M22 4l6-1-1 6-3 1-3-3z" fill="#e8e0cc" stroke="#2a170b" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M17 14l-6-2 1 5z" fill="#c73a2e" stroke="#2a170b" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

/** A die (random role). */
export function DiceIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="5" y="5" width="22" height="22" rx="5" fill="#fbf3dc" stroke="#2a170b" strokeWidth="2.2" transform="rotate(-8 16 16)" />
      <g fill="#a8261d" transform="rotate(-8 16 16)">
        <circle cx="11" cy="11" r="2" /><circle cx="21" cy="11" r="2" /><circle cx="16" cy="16" r="2" /><circle cx="11" cy="21" r="2" /><circle cx="21" cy="21" r="2" />
      </g>
    </svg>
  );
}
