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
      },
      animation: {
        floatUp: 'floatUp 1.3s ease-out forwards',
        hitFlash: 'hitFlash 0.45s ease-in-out',
        pulseRing: 'pulseRing 1.2s ease-out infinite',
        zoneFlash: 'zoneFlash 0.9s ease-out forwards',
      },
    },
  },
  plugins: [],
};
