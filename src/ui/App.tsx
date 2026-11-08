import { useState } from 'react';
import type { Difficulty } from '../ai/bot';
import type { Side } from '../engine';
import { type LocalConfig, useLocalGame } from './controller';
import { GameScreen } from './screens/GameScreen';
import { BotSetup, CardGallery, Home, HowToPlay, LocalSetup } from './screens/Menus';
import { Online } from './screens/Online';

type Screen =
  | { name: 'home' }
  | { name: 'botSetup' }
  | { name: 'localSetup' }
  | { name: 'cards' }
  | { name: 'rules' }
  | { name: 'online' }
  | { name: 'game'; cfg: LocalConfig; key: number };

export function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(location.search).has('room') ? { name: 'online' } : { name: 'home' },
  );
  const home = () => {
    if (location.search) history.replaceState(null, '', location.pathname);
    setScreen({ name: 'home' });
  };

  switch (screen.name) {
    case 'home':
      return (
        <Home
          onBot={() => setScreen({ name: 'botSetup' })}
          onLocal={() => setScreen({ name: 'localSetup' })}
          onOnline={() => setScreen({ name: 'online' })}
          onCards={() => setScreen({ name: 'cards' })}
          onRules={() => setScreen({ name: 'rules' })}
        />
      );
    case 'botSetup':
      return (
        <BotSetup
          onBack={home}
          onStart={(human: Side, level: Difficulty, mapId: string) => setScreen({ name: 'game', cfg: { mode: 'bot', human, level, mapId }, key: Date.now() })}
        />
      );
    case 'localSetup':
      return <LocalSetup onBack={home} onStart={(mapId) => setScreen({ name: 'game', cfg: { mode: 'local', mapId }, key: Date.now() })} />;
    case 'cards':
      return <CardGallery onBack={home} />;
    case 'rules':
      return <HowToPlay onBack={home} />;
    case 'online':
      return <Online onExit={home} />;
    case 'game':
      return <LocalGame key={screen.key} cfg={screen.cfg} onExit={home} />;
  }
}

function LocalGame({ cfg, onExit }: { cfg: LocalConfig; onExit: () => void }) {
  const ctl = useLocalGame(cfg);
  const title = cfg.mode === 'local' ? 'Hot-seat match' : `vs Bot · ${cfg.level[0].toUpperCase()}${cfg.level.slice(1)}`;
  return <GameScreen ctl={ctl} onExit={onExit} title={title} />;
}
