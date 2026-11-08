import { useEffect, useRef } from 'react';
import type { LogEntry } from '../../engine';

const TONE: Record<NonNullable<LogEntry['tone']>, string> = {
  info: 'text-slate-300',
  good: 'text-emerald-300',
  bad: 'text-rose-300',
  system: 'text-amber-200 font-semibold',
};

export function LogPanel({ log, className = '' }: { log: LogEntry[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length]);
  return (
    <div className={`panel flex min-h-0 flex-col p-2 ${className}`}>
      <div className="mb-1 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">Battle log</div>
      <div ref={ref} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 text-xs leading-snug">
        {log.map((l) => (
          <div key={l.n} className={TONE[l.tone ?? 'info']}>
            {l.side && <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${l.side === 'A' ? 'bg-rose-500' : 'bg-sky-500'}`} />}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}
