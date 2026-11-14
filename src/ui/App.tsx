import { Suspense, lazy, useEffect, useState } from 'react';
import type { Difficulty } from '../ai/bot';
import type { Side } from '../engine';
import { SoundButton, useMusic } from './components/Effects';
import { type LocalConfig, useLocalGame } from './controller';
import { GameScreen } from './screens/GameScreen';
import { BotSetup, CardGallery, Home, HowToPlay, LocalSetup } from './screens/Menus';
import { Online } from './screens/Online';
import { ProfileScreen } from './screens/Profile';

// The draft lab is private to the owner. It's a separate code file that the game server only sends to
// a browser holding the lab cookie (see server/index.ts); static builds (VITE_DRAFT_LAB=off) leave it out.
const DraftLab = import.meta.env.VITE_DRAFT_LAB === 'off'
  ? null
  : lazy(() => import('./screens/DraftLab').then((m) => ({ default: m.DraftLab })));

/** Whether this browser may open the draft lab: always in development, otherwise if the server says so. */
function useLabAccess(): boolean {
  const [ok, setOk] = useState<boolean>(import.meta.env.DEV && !!DraftLab);
  useEffect(() => {
    if (!DraftLab || import.meta.env.DEV) return;
    fetch(`${import.meta.env.BASE_URL}api/lab`, { cache: 'no-store' })
      .then((r) => setOk(r.ok))
      .catch(() => setOk(false));
  }, []);
  return ok;
}

type Screen =
  | { name: 'home' }
  | { name: 'botSetup' }
  | { name: 'localSetup' }
  | { name: 'cards' }
  | { name: 'lab' }
  | { name: 'rules' }
  | { name: 'online' }
  /** A player's profile; `from` is where Back returns to. */
  | { name: 'profile'; username: string; from: 'home' | 'online' }
  | { name: 'game'; cfg: LocalConfig; key: number };

/**
 * Development only: `?screen=…` (see below), or `?scenario=<teamA>;<teamD>[;<trainerA>,<trainerD>][;river]` (card ids, comma-separated)
 * starts a hot-seat battle with those teams already placed, for trying out specific cards.
 */
function devScenario(): Screen | null {
  if (!import.meta.env.DEV) return null;
  // `?screen=<name>` opens a menu screen directly, or `draft` a fresh hot-seat draft (for screenshots).
  const screen = new URLSearchParams(location.search).get('screen');
  if (screen === 'draft' || screen === 'draft-secret' || screen === 'draft-auction' || screen === 'draft-freeplay') {
    const style = screen === 'draft' ? 'classic' : screen === 'draft-secret' ? 'secret' : screen === 'draft-auction' ? 'auction' : 'freeplay';
    return { name: 'game', key: Date.now(), cfg: { mode: 'local', mapId: 'meadow', legendaries: true, trainers: true, style } };
  }
  if (screen && ['botSetup', 'localSetup', 'cards', 'lab', 'rules', 'online'].includes(screen)) return { name: screen } as Screen;
  const q = new URLSearchParams(location.search).get('scenario');
  if (!q) return null;
  const [a = '', d = '', t = '', map = 'meadow'] = q.split(';');
  const [tA, tD] = t ? t.split(',') : [];
  return {
    name: 'game', key: Date.now(),
    cfg: { mode: 'local', mapId: map, legendaries: true, trainers: !!t, scenario: { A: a.split(','), D: d.split(','), trainers: t ? { A: tA, D: tD } : undefined } },
  };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    devScenario() ?? (new URLSearchParams(location.search).has('room')
      ? { name: 'online' }
      : new URLSearchParams(location.search).get('u') ? { name: 'profile', username: new URLSearchParams(location.search).get('u')!, from: 'home' } : { name: 'home' }),
  );
  const lab = useLabAccess();
  // /lab?key=… redirects to /?lab once the cookie is set: open the lab straight away.
  useEffect(() => {
    if (lab && new URLSearchParams(location.search).has('lab')) setScreen({ name: 'lab' });
  }, [lab]);
  const home = () => {
    if (location.search) history.replaceState(null, '', location.pathname);
    setScreen({ name: 'home' });
  };
  // Menus play the title theme (the Draft Lab its own); games and online rooms choose their own music.
  const menu = screen.name !== 'game' && screen.name !== 'online';
  useMusic(screen.name === 'lab' ? 'lab' : menu ? 'menu' : undefined);
  return (
    <>
      {renderScreen()}
      {menu && <SoundButton up className="fixed bottom-3 left-3 z-40" />}
    </>
  );

  function renderScreen() {
  switch (screen.name) {
    case 'home':
      return (
        <Home
          onBot={() => setScreen({ name: 'botSetup' })}
          onLocal={() => setScreen({ name: 'localSetup' })}
          onOnline={() => setScreen({ name: 'online' })}
          onCards={() => setScreen({ name: 'cards' })}
          onLab={lab ? () => setScreen({ name: 'lab' }) : undefined}
          onRules={() => setScreen({ name: 'rules' })}
          onProfile={(username) => setScreen({ name: 'profile', username, from: 'home' })}
        />
      );
    case 'botSetup':
      return (
        <BotSetup
          onBack={home}
          onStart={(human: Side, level: Difficulty, opts) => setScreen({ name: 'game', cfg: { mode: 'bot', human, level, ...opts }, key: Date.now() })}
        />
      );
    case 'localSetup':
      return <LocalSetup onBack={home} onStart={(opts) => setScreen({ name: 'game', cfg: { mode: 'local', ...opts }, key: Date.now() })} />;
    case 'cards':
      return <CardGallery onBack={home} />;
    case 'lab':
      return DraftLab && lab ? <Suspense fallback={null}><DraftLab onBack={home} /></Suspense> : null;
    case 'rules':
      return <HowToPlay onBack={home} />;
    case 'online':
      return <Online onExit={home} onProfile={(username) => setScreen({ name: 'profile', username, from: 'online' })} />;
    case 'profile':
      return (
        <ProfileScreen
          username={screen.username}
          onBack={() => (screen.from === 'online' ? setScreen({ name: 'online' }) : home())}
          onProfile={(username) => setScreen({ name: 'profile', username, from: screen.from })}
        />
      );
    case 'game':
      return <LocalGame key={screen.key} cfg={screen.cfg} onExit={home} />;
  }
  }
}

function LocalGame({ cfg, onExit }: { cfg: LocalConfig; onExit: () => void }) {
  const local = useLocalGame(cfg);
  // Development only: `&clock=1` shows demo clocks and ranked accounts (layout checks without a server).
  const demo = import.meta.env.DEV && new URLSearchParams(location.search).has('clock');
  const ctl = demo ? {
    ...local, rated: true,
    clock: { A: 512_000, D: 26_000, running: [local.state.side], since: Date.now(), incMs: 5000, skew: 0 },
    accounts: {
      A: { id: 'a', username: 'PalletPro', ratings: { classic: 1214, secret: 1200, auction: 1200 }, games: { classic: 3, secret: 0, auction: 0 } },
      D: { id: 'd', username: 'RoninKage', ratings: { classic: 1492, secret: 1480, auction: 1510 }, games: { classic: 40, secret: 30, auction: 25 }, bot: 'hard' as const },
    },
  } : local;
  const title = cfg.mode === 'local' ? 'Hot-seat match' : `vs Bot · ${cfg.level[0].toUpperCase()}${cfg.level.slice(1)}`;
  return <GameScreen ctl={ctl} onExit={onExit} title={title} />;
}
