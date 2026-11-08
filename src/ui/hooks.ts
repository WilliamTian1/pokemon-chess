import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && 'matchMedia' in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** Portrait phones get the board rotated a quarter turn so tiles stay tappable. */
export const usePortraitBoard = (): boolean => useMediaQuery('(max-width: 700px) and (orientation: portrait)');

/** Touch screens confirm aimed moves with a second tap instead of hover-then-click. */
export const useTouch = (): boolean => useMediaQuery('(hover: none), (pointer: coarse)');

/** Laptop-sized screens and up get the one-screen layouts (everything visible without scrolling). */
export const useWideLayout = (): boolean => useMediaQuery('(min-width: 1024px) and (min-height: 560px)');

export interface FitGrid {
  cols: number;
  /** Card width in px (0 until the box has been measured). */
  width: number;
}

/**
 * Largest card width at which `n` cards (height = width × `aspect` + `extra`) fit inside the box
 * `el`, trying every column count. Re-runs whenever the box resizes, including on browser zoom.
 */
/** Content size of `el`, kept up to date as it resizes (including on browser zoom). */
export function useBoxSize(el: HTMLElement | null): { w: number; h: number } {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return box;
}

export function useFitGrid(el: HTMLElement | null, n: number, opts: { aspect: number; gap: number; extra?: number }): FitGrid {
  const box = useBoxSize(el);
  const extra = opts.extra ?? 0;
  let best: FitGrid = { cols: 1, width: 0 };
  if (box.w > 0 && box.h > 0 && n > 0) {
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const byW = (box.w - (cols - 1) * opts.gap) / cols;
      const byH = ((box.h - (rows - 1) * opts.gap) / rows - extra) / opts.aspect;
      const width = Math.floor(Math.min(byW, byH));
      if (width > best.width) best = { cols, width };
    }
  }
  return best;
}
