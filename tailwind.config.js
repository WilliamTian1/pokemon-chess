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
        // Trainer Special Move cut-in.
        cutinBg: { '0%': { opacity: '0' }, '12%, 80%': { opacity: '1' }, '100%': { opacity: '0' } },
        cutinStripe: { '0%': { transform: 'translate(-30%, -50%)', opacity: '0' }, '15%, 80%': { opacity: '1' }, '100%': { transform: 'translate(10%, -50%)', opacity: '0' } },
        cutinLeft: {
          '0%': { transform: 'translateX(-120vw)', opacity: '0' }, '15%': { transform: 'translateX(2vw)', opacity: '1' },
          '22%, 82%': { transform: 'translateX(0)', opacity: '1' }, '100%': { transform: 'translateX(60vw)', opacity: '0' },
        },
        cutinRight: {
          '0%': { transform: 'translateX(120vw)', opacity: '0' }, '15%': { transform: 'translateX(-2vw)', opacity: '1' },
          '22%, 82%': { transform: 'translateX(0)', opacity: '1' }, '100%': { transform: 'translateX(-60vw)', opacity: '0' },
        },
        // Field moves: weather and friends.
        fieldFade: { '0%': { opacity: '0' }, '15%, 75%': { opacity: '1' }, '100%': { opacity: '0' } },
        fieldText: { '0%': { transform: 'scale(0.6)', opacity: '0' }, '20%, 80%': { transform: 'scale(1)', opacity: '1' }, '100%': { transform: 'scale(1.1)', opacity: '0' } },
        rainDrop: { '0%': { transform: 'translate(0, 0) rotate(15deg)' }, '100%': { transform: 'translate(-25vh, 115vh) rotate(15deg)' } },
        hailDrop: { '0%': { transform: 'translateY(0)' }, '100%': { transform: 'translateY(115vh)' } },
        sandDrift: { '0%': { transform: 'translateX(-20vw)', opacity: '0' }, '20%, 80%': { opacity: '1' }, '100%': { transform: 'translateX(60vw)', opacity: '0' } },
        screenSweep: { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(100%)' } },
        tauntPulse: { '0%, 100%': { opacity: '0' }, '25%, 60%': { opacity: '1' } },
        // New turn banner.
        turnSweep: {
          '0%': { transform: 'translateX(-60vw) skewX(-12deg)', opacity: '0' }, '18%': { transform: 'translateX(0) skewX(-12deg)', opacity: '1' },
          '78%': { transform: 'translateX(0) skewX(-12deg)', opacity: '1' }, '100%': { transform: 'translateX(60vw) skewX(-12deg)', opacity: '0' },
        },
        confetti: { '0%': { transform: 'translateY(0) rotate(0deg)' }, '100%': { transform: 'translateY(110vh) rotate(720deg)' } },
        // Draft → battle versus screen.
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        vsOut: { '0%': { opacity: '1', transform: 'scale(1)' }, '100%': { opacity: '0', transform: 'scale(1.08)' } },
        vsLeft: { '0%': { transform: 'translateX(-60vw)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        vsRight: { '0%': { transform: 'translateX(60vw)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
        countPop: { '0%': { transform: 'scale(2.2)', opacity: '0' }, '30%': { transform: 'scale(1)', opacity: '1' }, '100%': { transform: 'scale(0.9)', opacity: '0.85' } },
        // Board: a fainted Pokémon's puff of smoke, and the trebuchet's boulder.
        poof: { '0%': { transform: 'scale(0.4)', opacity: '0.9' }, '100%': { transform: 'scale(1.8)', opacity: '0' } },
        boulderX: { '0%': { left: 'var(--x0)' }, '100%': { left: 'var(--x1)' } },
        boulderY: { '0%': { top: 'var(--y0)' }, '45%': { top: 'calc(min(var(--y0), var(--y1)) - 18%)' }, '100%': { top: 'var(--y1)' } },
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
        cutinBg: 'cutinBg 2.6s ease-out forwards',
        cutinStripe: 'cutinStripe 2.6s linear forwards',
        cutinLeft: 'cutinLeft 2.6s cubic-bezier(.2,.8,.3,1) forwards',
        cutinRight: 'cutinRight 2.6s cubic-bezier(.2,.8,.3,1) forwards',
        fieldFade: 'fieldFade 2s ease-out forwards',
        fieldText: 'fieldText 2s ease-out forwards',
        rainDrop: 'rainDrop 0.7s linear infinite',
        hailDrop: 'hailDrop 1.1s ease-in infinite',
        sandDrift: 'sandDrift 1.2s linear infinite',
        screenSweep: 'screenSweep 1.2s ease-in-out 2',
        tauntPulse: 'tauntPulse 0.9s ease-out 2',
        turnSweep: 'turnSweep 1.4s cubic-bezier(.2,.8,.3,1) forwards',
        confetti: 'confetti 3s linear infinite',
        fadeIn: 'fadeIn 0.4s ease-out forwards',
        vsOut: 'vsOut 0.9s ease-in forwards',
        vsLeft: 'vsLeft 0.7s cubic-bezier(.2,.8,.3,1) both',
        vsRight: 'vsRight 0.7s cubic-bezier(.2,.8,.3,1) both',
        countPop: 'countPop 0.8s ease-out both',
        poof: 'poof 0.7s ease-out forwards',
        boulderX: 'boulderX 0.55s linear forwards',
        boulderY: 'boulderY 0.55s ease-in-out forwards',
      },
    },
  },
  plugins: [],
};
