import { useEffect, useMemo, useState } from 'react';
import { SIDE_NAME, type Side, decider, getMap, hiddenView, isSimultaneous, liveUnits } from '../../engine';
import { SealedIcon } from '../components/icons';
import { sfx } from '../audio';
import { Modal, SIDE_TEXT } from '../components/bits';
import { Confetti, DraftTransition, SoundButton, useMusic } from '../components/Effects';
import type { Controller } from '../controller';
import { BattleView } from './BattleView';
import { DraftView } from './DraftView';

export function GameScreen({ ctl: raw, onExit, title }: { ctl: Controller; onExit: () => void; title: string }) {
  // Secret draft: while both sides pick and place at the same time, each screen sees only its own side.
  // Hot-seat passes the device between them, behind a cover screen.
  const simultaneous = isSimultaneous(raw.state);
  const hotseat = raw.mySides.length === 2;
  const viewer: Side | null = simultaneous ? (hotseat ? decider(raw.state) : raw.mySides[0] ?? null) : null;
  const [handedTo, setHandedTo] = useState<Side>('A');
  const covered = simultaneous && hotseat && viewer !== null && viewer !== handedTo;
  const ctl = useMemo<Controller>(() => (simultaneous && raw.mode !== 'online' && viewer
    ? { ...raw, state: hiddenView(raw.state, viewer), mySides: hotseat ? [viewer] : raw.mySides }
    : raw), [raw, simultaneous, viewer, hotseat]);
  const s = raw.state;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [dismissedOver, setDismissedOver] = useState<number | null>(null);
  const spectating = ctl.mySides.length === 0;
  const roleText = spectating
    ? 'Spectating'
    : ctl.mySides.length === 2 ? 'Hot-seat · both sides' : `You are the ${SIDE_NAME[ctl.mySides[0]]}`;
  const inProgress = s.phase !== 'over';
  // Victory for the player on this screen (any finished game counts in hot-seat and spectating).
  const won = s.phase === 'over' && (ctl.mySides.length !== 1 || ctl.mySides[0] === s.winner);
  // The boss theme takes over when one side has one Pokémon and the other has two or fewer.
  const aliveA = liveUnits(s, 'A').length;
  const aliveD = liveUnits(s, 'D').length;
  const climax = s.phase === 'battle' && ((aliveA === 1 && aliveD <= 2) || (aliveD === 1 && aliveA <= 2));
  useMusic(s.phase === 'draft' ? 'draft' : s.phase === 'over' ? (won ? 'victory' : 'defeat') : climax ? 'climax' : { file: getMap(s.mapId).music });
  useEffect(() => {
    if (s.phase === 'over') sfx(won ? 'victory' : 'defeat');
  }, [s.phase === 'over']); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex w-full flex-col px-3 pb-8 pt-3 phone:px-2 phone:pt-2 sm:px-4 wide:h-[100dvh] wide:pb-3">
      <header className="lacquer mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-1.5 phone:mb-2 phone:gap-1.5 phone:py-1 wide:mb-2">
        <div className="flex min-w-0 flex-1 items-center gap-3 phone:gap-2 wide:flex-none">
          <button type="button" className="btn-ghost shrink-0 phone:!px-2.5 phone:!py-1.5" aria-label="Menu" onClick={() => (inProgress && !spectating ? setConfirmLeave(true) : onExit())}>
            ←<span className="phone:hidden"> Menu</span>
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight">{title}</div>
            <div className={`truncate text-xs ${spectating ? 'text-slate-400' : ctl.mySides.length === 1 ? SIDE_TEXT[ctl.mySides[0]] : 'text-slate-400'}`}>{roleText}</div>
          </div>
        </div>
        {/* BattleView puts the round, whose turn it is and the chart buttons here on one-screen layouts. */}
        <div id="battle-hud" className="flex min-w-0 flex-1 justify-center empty:hidden" />
        <div className="flex items-center gap-2">
        {(ctl.clock || ctl.rated) && <Clocks ctl={ctl} />}
        <SoundButton />
        {inProgress && !spectating && (s.phase === 'battle' || ctl.rated) && (
          <button
            type="button"
            className="btn-ghost text-xs phone:!px-2 phone:!py-1.5"
            onClick={() => {
              if (confirm('Concede this match?')) ctl.dispatch({ type: 'concede', side: ctl.mySides.length === 1 ? ctl.mySides[0] : s.side });
            }}
          >
            Concede
          </button>
        )}
        </div>
      </header>

      <div className="wide:min-h-0 wide:flex-1">
        {s.phase === 'draft' ? <DraftView ctl={ctl} /> : <BattleView ctl={ctl} />}
      </div>

      {ctl.error && (
        <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-3" role="alert">
          <button type="button" onClick={ctl.clearError} className="max-w-lg rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xl">
            {ctl.error} <span className="ml-2 opacity-70">✕</span>
          </button>
        </div>
      )}

      <DraftTransition state={s} names={ctl.names} />
      {covered && viewer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1b120b]/95 p-4">
          <div className="panel max-w-md space-y-4 p-6 text-center">
            <SealedIcon className="mx-auto h-16 w-16" />
            <h2 className="font-display text-2xl text-lacquer">Pass the device to the {viewer === 'A' ? 'Attacker' : 'Defender'}</h2>
            <p className="text-sm font-bold text-slate-300">
              {raw.state.draft.style === 'freeplay' ? 'Freeplay' : 'Secret'} draft: the {viewer === 'A' ? 'Defender' : 'Attacker'} looks away. Picks, trainers and placements stay hidden until the battle begins.
            </p>
            <button type="button" className="btn-primary w-full py-3 font-display text-lg" onClick={() => setHandedTo(viewer)}>
              I’m the {viewer === 'A' ? 'Attacker' : 'Defender'}: show my side
            </button>
            {raw.autofillTeam && (
              <button type="button" className="btn-ghost w-full" onClick={raw.autofillTeam}>
                Autofill team
              </button>
            )}
          </div>
        </div>
      )}
      {s.phase === 'over' && won && <Confetti />}
      {s.phase === 'over' && dismissedOver !== s.seq && (
        <Modal onClose={() => setDismissedOver(s.seq)}>
          <div className="space-y-3 text-center">
            <div className="text-xs uppercase tracking-widest text-slate-400">Battle over · round {s.round}</div>
            <div className={`text-3xl font-black ${SIDE_TEXT[s.winner!]}`}>
              {ctl.mySides.length === 1 ? (ctl.mySides[0] === s.winner ? 'Victory!' : 'Defeat') : `${ctl.names[s.winner!]} wins!`}
            </div>
            <p className="text-sm text-slate-300">{s.winReason}</p>
            {ctl.result?.deltas && (
              <div className="flex justify-center gap-3">
                {(['A', 'D'] as const).map((side) => {
                  const d = ctl.result!.deltas![side];
                  return (
                    <div key={side} className="paper-inset px-3 py-1.5">
                      <div className="text-xs font-extrabold text-slate-400">{ctl.accounts?.[side]?.username ?? ctl.names[side]}</div>
                      <div className="font-display text-lg">
                        {ctl.result!.ratings![side]} <span className={d >= 0 ? 'text-emerald-300' : 'text-rose-300'}>({d >= 0 ? `+${d}` : d})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setDismissedOver(s.seq)}>View board</button>
              {ctl.rematch && <button type="button" className="btn-primary" onClick={ctl.rematch}>{ctl.mode === 'online' ? 'Rematch (swap roles)' : 'Play again'}</button>}
              <button type="button" className="btn-ghost" onClick={onExit}>Main menu</button>
            </div>
            {ctl.mode === 'online' && !ctl.rematch && !ctl.rated && <p className="text-xs text-slate-500">The host can start a rematch.</p>}
            {ctl.rated && <p className="text-xs text-slate-500">Ranked match: head back to find another.</p>}
          </div>
        </Modal>
      )}

      {confirmLeave && (
        <Modal onClose={() => setConfirmLeave(false)}>
          <h3 className="font-display text-xl text-lacquer">Leave this match?</h3>
          <p className="mt-1 text-sm text-slate-300">
            {ctl.mode === 'online' ? 'You can rejoin with the same room code from this browser.' : 'The current game will be lost.'}
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-ghost flex-1" onClick={() => setConfirmLeave(false)}>Stay</button>
            <button type="button" className="btn-danger flex-1" onClick={onExit}>Leave</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Chess-style clocks for timed online matches (and each side's rating in ranked ones). */
function Clocks({ ctl }: { ctl: Controller }) {
  const c = ctl.clock;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!c?.running.length) return;
    const t = window.setInterval(() => tick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [c?.running.join(), c?.since]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = (side: Side): number => {
    if (!c) return 0;
    const base = c[side];
    if (!c.running.includes(side)) return base;
    // The server's `since` in local time: since + skew.
    return Math.max(0, base - (Date.now() - (c.since + c.skew)));
  };
  const fmt = (ms: number) => {
    const sec = Math.ceil(ms / 1000);
    return sec >= 60 ? `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : `0:${String(sec).padStart(2, '0')}`;
  };
  return (
    <div className="flex items-center gap-1.5">
      {(['A', 'D'] as const).map((side) => {
        const ms = left(side);
        const running = !!c?.running.includes(side);
        const acc = ctl.accounts?.[side];
        return (
          <div key={side} className={`flex items-center gap-1.5 rounded-lg border-2 px-2 py-1 ${running ? 'border-[#d9ab45] bg-[#3a2414]' : 'border-transparent bg-black/20'}`}
            title={acc ? `${acc.username} (${acc.rating})` : ctl.names[side]}>
            <span className={`h-2.5 w-2.5 rounded-full ${side === 'A' ? 'bg-[#c73a2e]' : 'bg-[#2f62b8]'}`} />
            {acc && <span className="hidden max-w-[7rem] truncate text-xs font-bold text-slate-300 lg:inline">{acc.username} <span className="text-[#f2d27a]">{acc.rating}</span></span>}
            {c && <span className={`font-mono text-base font-bold tabular-nums ${ms < 30_000 ? 'text-rose-300' : 'text-[#fff3d6]'}`}>{fmt(ms)}</span>}
          </div>
        );
      })}
    </div>
  );
}
