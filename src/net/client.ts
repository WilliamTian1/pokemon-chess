import type { AccountView, ClientMsg, QueueView, RoomView, ServerMsg } from './protocol';

export type ConnStatus = 'connecting' | 'open' | 'closed';

export interface NetSnapshot {
  status: ConnStatus;
  playerId: string | null;
  room: RoomView | null;
  error: string | null;
  /** The signed-in account the server recognised (null for guests). */
  account: AccountView | null;
  /** Ranked matchmaking: searching, or null. */
  queue: QueueView | null;
  /** Local clock minus server clock, from the last room update (for the game clocks). */
  clockSkew: number;
}

const TOKEN_KEY = 'pokemon-chess-token';
const NAME_KEY = 'pokemon-chess-name';

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function savedName(): string {
  return storage()?.getItem(NAME_KEY) ?? '';
}

function token(): string {
  const st = storage();
  let t = st?.getItem(TOKEN_KEY) ?? null;
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    try {
      st?.setItem(TOKEN_KEY, t);
    } catch {
      /* private mode: token lives for this session only */
    }
  }
  return t;
}

function serverUrl(): string {
  const env = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** A reconnecting WebSocket client for the room server. */
export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<(s: NetSnapshot) => void>();
  private snap: NetSnapshot = { status: 'connecting', playerId: null, room: null, error: null, account: null, queue: null, clockSkew: 0 };
  private closedByUser = false;
  private retry = 0;
  private queue: ClientMsg[] = [];
  private roomCode: string | null = null;

  constructor(private name: string) {
    try {
      storage()?.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
    this.connect();
  }

  get snapshot(): NetSnapshot {
    return this.snap;
  }

  subscribe(fn: (s: NetSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snap);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<NetSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l(this.snap);
  }

  private connect(): void {
    this.set({ status: 'connecting' });
    const ws = new WebSocket(serverUrl());
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ status: 'open', error: null });
      this.raw({ t: 'hello', token: token(), name: this.name });
      if (this.roomCode) this.raw({ t: 'join', code: this.roomCode });
      const q = this.queue;
      this.queue = [];
      for (const m of q) this.raw(m);
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMsg;
      switch (msg.t) {
        case 'welcome':
          this.set({ playerId: msg.id, account: msg.account ?? null });
          break;
        case 'room':
          this.roomCode = msg.room.code;
          this.set({ room: msg.room, error: null, clockSkew: Date.now() - msg.room.serverNow });
          break;
        case 'queue':
          this.set({ queue: msg.queue });
          break;
        case 'left':
          this.roomCode = null;
          this.set({ room: null });
          break;
        case 'error':
          this.set({ error: msg.message });
          break;
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.set({ status: 'closed' });
      if (this.closedByUser) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.closedByUser && this.connect(), delay);
    };
  }

  private raw(m: ClientMsg): void {
    this.ws?.send(JSON.stringify(m));
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.raw(m);
    else this.queue.push(m);
  }

  clearError(): void {
    this.set({ error: null });
  }

  close(): void {
    this.closedByUser = true;
    if (this.roomCode) this.raw({ t: 'leave' });
    this.ws?.close();
  }
}
