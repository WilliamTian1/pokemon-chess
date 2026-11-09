import { useEffect, useState } from 'react';
import { SIDE_NAME } from '../../engine';
import { sfx } from '../audio';
import { Modal, SIDE_TEXT } from '../components/bits';
import { Confetti, DraftTransition, SoundButton, useMusic } from '../components/Effects';
import type { Controller } from '../controller';
import { BattleView } from './BattleView';
import { DraftView } from './DraftView';

export function GameScreen({ ctl, onExit, title }: { ctl: Controller; onExit: () => void; title: string }) {
  const s = ctl.state;
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [dismissedOver, setDismissedOver] = useState<number | null>(null);
  const spectating = ctl.mySides.length === 0;
  const roleText = spectating
    ? 'Spectating'
    : ctl.mySides.length === 2 ? 'Hot-seat · both sides' : `You are the ${SIDE_NAME[ctl.mySides[0]]}`;
  const inProgress = s.phase !== 'over';
  // Victory for the player on this screen (any finished game counts in hot-seat and spectating).
  const won = s.phase === 'over' && (ctl.mySides.length !== 1 || ctl.mySides[0] === s.winner);
  useMusic(s.phase === 'draft' ? 'draft' : s.phase === 'over' ? null : s.mapId === 'river' ? 'battleRiver' : 'battle');
  useEffect(() => {
    if (s.phase === 'over') sfx(won ? 'victory' : 'defeat');
  }, [s.phase === 'over']); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex w-full flex-col px-3 pb-8 pt-3 sm:px-4 wide:h-[100dvh] wide:pb-3">
      <header className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 wide:mb-2">
        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost" onClick={() => (inProgress && !spectating ? setConfirmLeave(true) : onExit())}>← Menu</button>
          <div>
            <div className="text-sm font-bold leading-tight">{title}</div>
            <div className={`text-xs ${spectating ? 'text-slate-400' : ctl.mySides.length === 1 ? SIDE_TEXT[ctl.mySides[0]] : 'text-slate-400'}`}>{roleText}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
        <SoundButton />
        {inProgress && !spectating && s.phase === 'battle' && (
          <button
            type="button"
            className="btn-ghost text-xs"
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
      {s.phase === 'over' && won && <Confetti />}
      {s.phase === 'over' && dismissedOver !== s.seq && (
        <Modal onClose={() => setDismissedOver(s.seq)}>
          <div className="space-y-3 text-center">
            <div className="text-xs uppercase tracking-widest text-slate-400">Battle over · round {s.round}</div>
            <div className={`text-3xl font-black ${SIDE_TEXT[s.winner!]}`}>
              {ctl.mySides.length === 1 ? (ctl.mySides[0] === s.winner ? 'Victory!' : 'Defeat') : `${ctl.names[s.winner!]} wins!`}
            </div>
            <p className="text-sm text-slate-300">{s.winReason}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setDismissedOver(s.seq)}>View board</button>
              {ctl.rematch && <button type="button" className="btn-primary" onClick={ctl.rematch}>{ctl.mode === 'online' ? 'Rematch (swap roles)' : 'Play again'}</button>}
              <button type="button" className="btn-ghost" onClick={onExit}>Main menu</button>
            </div>
            {ctl.mode === 'online' && !ctl.rematch && <p className="text-xs text-slate-500">The host can start a rematch.</p>}
          </div>
        </Modal>
      )}

      {confirmLeave && (
        <Modal onClose={() => setConfirmLeave(false)}>
          <h3 className="text-lg font-bold">Leave this match?</h3>
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
