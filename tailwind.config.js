/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // One-screen layouts (draft and battle fit the viewport); must match useWideLayout().
        wide: { raw: '(min-width: 1024px) and (min-height: 560px)' },
      },
      colors: {
        atk: { DEFAULT: '#ef4444', soft: '#fca5a5', deep: '#991b1b' },
        def: { DEFAULT: '#3b82f6', soft: '#93c5fd', deep: '#1e3a8a' },
      },
      keyframes: {
        floatUp: {
          '0%': { opacity: '0', transform: 'translate(-50%, 0) scale(0.8)' },
          '15%': { opacity: '1', transform: 'translate(-50%, -6px) scale(1.1)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -38px) scale(1)' },
        },
        hitFlash: {
          '0%, 100%': { filter: 'none' },
          '30%': { filter: 'brightness(2.2) saturate(0.3)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(250, 204, 21, 0.7)' },
          '100%': { boxShadow: '0 0 0 10px rgba(250, 204, 21, 0)' },
        },
        zoneFlash: {
          '0%': { opacity: '0.85' },
          '100%': { opacity: '0' },
        },
        // A tag dropped onto a card: falls in from above its spot, keeping its tilt (--rot).
        tagDrop: {
          '0%': { opacity: '0', transform: 'rotate(var(--rot)) translateY(-35%) scale(1.5)' },
          '70%': { opacity: '1', transform: 'rotate(var(--rot)) translateY(0) scale(0.94)' },
          '100%': { opacity: '1', transform: 'rotate(var(--rot)) scale(1)' },
        },
        tagBurst: {
          '0%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.3) rotate(-25deg)' },
          '25%': { opacity: '1', transform: 'translate(-50%, -50%) scale(1.15) rotate(6deg)' },
          '70%': { opacity: '1', transform: 'translate(-50%, -50%) scale(1) rotate(0deg)' },
          '100%': { opacity: '0', transform: 'translate(-50%, -50%) scale(0.85) rotate(0deg)' },
        },
        cardHit: {
          '0%': { opacity: '0' },
          '12%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        cardHeal: {
          '0%': { opacity: '0', boxShadow: 'inset 0 0 0 0 rgba(52, 211, 153, 0)' },
          '30%': { opacity: '1', boxShadow: 'inset 0 0 18px 6px rgba(52, 211, 153, 0.9)' },
          '100%': { opacity: '0', boxShadow: 'inset 0 0 0 0 rgba(52, 211, 153, 0)' },
        },
        cardShake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '15%': { transform: 'translateX(-6%) rotate(-2deg)' },
          '35%': { transform: 'translateX(5%) rotate(1.5deg)' },
          '55%': { transform: 'translateX(-3%) rotate(-1deg)' },
          '75%': { transform: 'translateX(2%)' },
        },
      },
      animation: {
        floatUp: 'floatUp 1.3s ease-out forwards',
        hitFlash: 'hitFlash 0.45s ease-in-out',
        pulseRing: 'pulseRing 1.2s ease-out infinite',
        zoneFlash: 'zoneFlash 0.9s ease-out forwards',
        tagDrop: 'tagDrop 0.45s cubic-bezier(.2,.8,.3,1.2) both',
        tagBurst: 'tagBurst 1.3s ease-out forwards',
        cardHit: 'cardHit 0.7s ease-out forwards',
        cardHeal: 'cardHeal 1.1s ease-out forwards',
        cardShake: 'cardShake 0.45s ease-in-out',
      },
    },
  },
  plugins: [],
};
