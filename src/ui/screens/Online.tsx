import { useEffect, useMemo, useState } from 'react';
import { type Side, getMap } from '../../engine';
import { NetClient, savedName } from '../../net/client';
import { ROOM_CODE_RE } from '../../net/protocol';
import { SIDE_TEXT } from '../components/bits';
import { LegendaryToggle, MapPicker, MapPreview, savedLegendaries, savedMapId } from '../components/MapPicker';
import { useNet, useOnlineGame } from '../controller';
import { GameScreen } from './GameScreen';

export function Online({ onExit }: { onExit: () => void }) {
  const [name, setName] = useState(savedName());
  const [client, setClient] = useState<NetClient | null>(null);
  const joinFromUrl = useMemo(() => new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '', []);
  const [code, setCode] = useState(joinFromUrl);

  useEffect(() => () => client?.close(), [client]);

  if (!client) {
    const ok = name.trim().length > 0;
    const connect = (then: (c: NetClient) => void) => {
      const c = new NetClient(name.trim().slice(0, 20));
      setClient(c);
      then(c);
    };
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <button type="button" className="btn-ghost mb-4" onClick={onExit}>← Back</button>
        <div className="panel space-y-4 p-5">
          <h2 className="text-2xl font-bold">Online match</h2>
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-slate-300">Your name</span>
            <input
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-amber-300"
              placeholder="Ash"
            />
          </label>
          <button type="button" disabled={!ok} className="btn-primary w-full py-2.5" onClick={() => connect((c) => c.send({ t: 'create' }))}>
            Create a private room
          </button>
          <div className="flex gap-2">
            <input
              value={code}
              maxLength={4}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
              className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-center font-mono text-lg tracking-widest outline-none focus:border-amber-300"
              placeholder="CODE"
            />
            <button
              type="button"
              disabled={!ok || !ROOM_CODE_RE.test(code)}
              className="btn-ghost flex-1"
              onClick={() => connect((c) => c.send({ t: 'join', code }))}
            >
              Join room
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Rooms hold two players plus any number of spectators. The server rolls all dice, so nobody can cheat their luck.
          </p>
        </div>
      </div>
    );
  }
  return <Room client={client} onExit={() => { client.close(); setClient(null); onExit(); }} />;
}

function Room({ client, onExit }: { client: NetClient; onExit: () => void }) {
  const snap = useNet(client);
  const ctl = useOnlineGame(client, snap);
  const [randomRoles, setRandomRoles] = useState(true);
  const [mapId, setMapId] = useState(savedMapId);
  const [legendaries, setLegendaries] = useState(savedLegendaries);
  const [copied, setCopied] = useState(false);
  const room = snap.room;

  if (ctl && room) return <GameScreen ctl={ctl} onExit={onExit} title={`Online · room ${room.code}`} />;

  if (!room) {
    return (
      <div className="mx-auto max-w-md px-4 py-10 text-center">
        <div className="panel space-y-3 p-6">
          <div className="text-lg font-semibold">{snap.status === 'open' ? 'Joining room…' : snap.status === 'connecting' ? 'Connecting to server…' : 'Disconnected — retrying…'}</div>
          {snap.error && <p className="text-sm text-rose-300">{snap.error}</p>}
          <p className="text-xs text-slate-500">Online play needs the game server (<code>npm run server</code> in development, <code>npm start</code> in production).</p>
          <button type="button" className="btn-ghost" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const me = room.players.find((p) => p.id === snap.playerId);
  const isHost = room.hostId === snap.playerId;
  const seatOf = (side: Side) => room.players.find((p) => p.side === side);
  const ready = !!seatOf('A') && !!seatOf('D');
  const link = `${location.origin}${location.pathname}?room=${room.code}`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <button type="button" className="btn-ghost mb-4" onClick={onExit}>← Leave room</button>
      <div className="panel space-y-5 p-5">
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-slate-400">Room code</div>
          <div className="font-mono text-5xl font-black tracking-[0.3em] text-amber-300">{room.code}</div>
          <button
            type="button"
            className="btn-ghost mt-2 text-xs"
            onClick={() => {
              void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}
          >
            {copied ? 'Link copied!' : 'Copy invite link'}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(['A', 'D'] as const).map((side) => {
            const p = seatOf(side);
            return (
              <div key={side} className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-center">
                <div className={`text-sm font-bold ${SIDE_TEXT[side]}`}>{side === 'A' ? 'Attacker' : 'Defender'}</div>
                <div className="my-2 min-h-[1.5rem] truncate text-base">{p ? `${p.name}${p.connected ? '' : ' (offline)'}` : <span className="text-slate-500">Open seat</span>}</div>
                {!p && <button type="button" className="btn-ghost w-full text-xs" onClick={() => client.send({ t: 'seat', side })}>Sit here</button>}
                {p?.id === me?.id && <button type="button" className="btn-ghost w-full text-xs" onClick={() => client.send({ t: 'seat', side: null })}>Stand up</button>}
              </div>
            );
          })}
        </div>
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-400">In the room</div>
          <div className="flex flex-wrap gap-1.5">
            {room.players.map((p) => (
              <span key={p.id} className={`chip ${p.side === 'A' ? 'bg-rose-500/80' : p.side === 'D' ? 'bg-sky-500/80' : 'bg-slate-700'} text-white normal-case`}>
                {p.name}{p.id === room.hostId ? ' ★' : ''}{p.connected ? '' : ' ⏸'}
              </span>
            ))}
          </div>
        </div>
        {isHost ? (
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-slate-400">Map</div>
            <MapPicker value={mapId} onChange={setMapId} />
            <LegendaryToggle value={legendaries} onChange={setLegendaries} />
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={randomRoles} onChange={(e) => setRandomRoles(e.target.checked)} />
              Randomize who attacks
            </label>
            <button type="button" className="btn-primary w-full py-2.5" disabled={!ready} onClick={() => client.send({ t: 'start', randomRoles, mapId, legendaries })}>
              {ready ? 'Start match' : 'Waiting for two seated players…'}
            </button>
          </div>
        ) : (
          <div className="space-y-2 text-center">
            <MapPreview map={getMap(room.mapId)} className="mx-auto max-w-xs" />
            <p className="text-sm text-slate-400">Map: <b className="text-slate-200">{getMap(room.mapId).name}</b>{room.legendaries === false ? ', no legendaries' : ''} (the host chooses). Waiting for the host to start the match…</p>
          </div>
        )}
        {snap.error && <p className="text-center text-sm text-rose-300">{snap.error}</p>}
      </div>
    </div>
  );
}
