/**
 * Sound: synthesized effects and chiptune music (Web Audio, no audio files — every tune here is
 * original), plus trainer voicelines read by the browser's speech synthesis. Browsers only allow
 * sound after the player has interacted with the page, so nothing plays before the first click.
 */

export interface AudioSettings {
  music: boolean;
  sfx: boolean;
  voice: boolean;
  /** 0–1. */
  volume: number;
}

const KEY = 'pcc-audio';
let settings: AudioSettings = load();
const listeners = new Set<() => void>();

function load(): AudioSettings {
  const base: AudioSettings = { music: true, sfx: true, voice: true, volume: 0.7 };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return base;
  }
}

export const getAudioSettings = (): AudioSettings => settings;

export function setAudioSettings(next: Partial<AudioSettings>): void {
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable; the settings still apply for this visit.
  }
  if (bus) {
    bus.master.gain.value = settings.volume;
    bus.music.gain.value = settings.music ? MUSIC_LEVEL : 0;
  }
  if (!settings.voice && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  listeners.forEach((f) => f());
}

export function onAudioSettings(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

// ---------------------------------------------------------------- context

const MUSIC_LEVEL = 0.22;
let ctx: AudioContext | null = null;
let bus: { master: GainNode; music: GainNode; sfx: GainNode } | null = null;
let noiseBuf: AudioBuffer | null = null;
const waves = new Map<string, PeriodicWave>();

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined;
  if (!AC) return null;
  ctx = new AC();
  const master = ctx.createGain();
  master.gain.value = settings.volume;
  master.connect(ctx.destination);
  const music = ctx.createGain();
  music.gain.value = settings.music ? MUSIC_LEVEL : 0;
  music.connect(master);
  const sfx = ctx.createGain();
  sfx.gain.value = 0.55;
  sfx.connect(master);
  bus = { master, music, sfx };
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

let unlocked = false;
/** Starts sound on the first click or key press (browsers block it until then). */
export function installAudioUnlock(): void {
  const unlock = () => {
    const c = audio();
    if (!c) return;
    void c.resume();
    if (!unlocked) {
      unlocked = true;
      if (wanted) playMusic(wanted, true);
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** A pulse wave with the given duty cycle (the classic handheld-console square sounds). */
function pulse(c: AudioContext, duty: number): PeriodicWave {
  const k = `p${duty}`;
  let w = waves.get(k);
  if (!w) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) imag[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    w = c.createPeriodicWave(real, imag);
    waves.set(k, w);
  }
  return w;
}

type Wave = 'square' | 'triangle' | 'sine' | 'sawtooth' | 'pulse12' | 'pulse25';

interface ToneOpts {
  at?: number;
  vol?: number;
  wave?: Wave;
  slideTo?: number;
  attack?: number;
  out?: AudioNode;
}

function tone(freq: number, dur: number, o: ToneOpts = {}): void {
  const c = audio();
  if (!c || !bus) return;
  const t = c.currentTime + (o.at ?? 0);
  const osc = c.createOscillator();
  const w = o.wave ?? 'square';
  if (w === 'pulse12' || w === 'pulse25') osc.setPeriodicWave(pulse(c, w === 'pulse12' ? 0.125 : 0.25));
  else osc.type = w;
  osc.frequency.setValueAtTime(freq, t);
  if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slideTo), t + dur);
  const g = c.createGain();
  const vol = o.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + (o.attack ?? 0.008));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(o.out ?? bus.sfx);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(dur: number, o: { at?: number; vol?: number; filter?: BiquadFilterType; freq?: number; sweepTo?: number; out?: AudioNode } = {}): void {
  const c = audio();
  if (!c || !bus || !noiseBuf) return;
  const t = c.currentTime + (o.at ?? 0);
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = o.filter ?? 'lowpass';
  f.frequency.setValueAtTime(o.freq ?? 2000, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(o.out ?? bus.sfx);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

const NOTE: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
/** Frequency of a note name like "A4" or "F#5". */
function freq(name: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(name)!;
  const midi = 12 * (Number(m[2]) + 1) + NOTE[m[1]];
  return 440 * 2 ** ((midi - 69) / 12);
}

// ---------------------------------------------------------------- sound effects

export type Sfx =
  | 'hit' | 'bigHit' | 'heal' | 'miss' | 'faint' | 'statUp' | 'statDown' | 'burn' | 'paralysis' | 'poison' | 'sleep'
  | 'freeze' | 'confuse' | 'flinch' | 'special' | 'sun' | 'rain' | 'sand' | 'hail' | 'screen' | 'taunt' | 'flowers'
  | 'turn' | 'pick' | 'place' | 'step' | 'trebuchet' | 'click' | 'victory' | 'defeat' | 'count' | 'go';

export function sfx(name: Sfx, delay = 0): void {
  if (!settings.sfx || !unlocked) return;
  const at = delay;
  switch (name) {
    case 'hit':
      noise(0.14, { at, vol: 0.5, freq: 1800, sweepTo: 300 });
      tone(140, 0.16, { at, wave: 'square', vol: 0.25, slideTo: 50 });
      break;
    case 'bigHit':
      noise(0.22, { at, vol: 0.65, freq: 3000, sweepTo: 200 });
      tone(110, 0.28, { at, wave: 'square', vol: 0.32, slideTo: 35 });
      tone(880, 0.08, { at: at + 0.02, wave: 'pulse12', vol: 0.18, slideTo: 300 });
      break;
    case 'heal':
      ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((n, i) => tone(freq(n), 0.16, { at: at + i * 0.055, wave: 'triangle', vol: 0.28 }));
      break;
    case 'miss':
      noise(0.25, { at, vol: 0.25, filter: 'bandpass', freq: 400, sweepTo: 3000 });
      break;
    case 'faint':
      tone(523, 0.6, { at, wave: 'pulse25', vol: 0.25, slideTo: 80 });
      noise(0.5, { at: at + 0.1, vol: 0.18, freq: 800, sweepTo: 100 });
      break;
    case 'statUp':
      [660, 880, 1175].forEach((f, i) => tone(f, 0.09, { at: at + i * 0.06, wave: 'pulse25', vol: 0.18 }));
      break;
    case 'statDown':
      [1175, 880, 660].forEach((f, i) => tone(f, 0.09, { at: at + i * 0.06, wave: 'pulse25', vol: 0.18 }));
      break;
    case 'burn':
      noise(0.5, { at, vol: 0.3, filter: 'highpass', freq: 2500, sweepTo: 800 });
      tone(200, 0.4, { at, wave: 'sawtooth', vol: 0.1, slideTo: 400 });
      break;
    case 'paralysis':
      for (let i = 0; i < 4; i++) tone(1500 - i * 250, 0.05, { at: at + i * 0.05, wave: 'square', vol: 0.15, slideTo: 300 });
      break;
    case 'poison':
      for (let i = 0; i < 4; i++) tone(300 + (i % 2) * 120, 0.08, { at: at + i * 0.08, wave: 'sine', vol: 0.25, slideTo: 600 });
      break;
    case 'sleep':
      ['E5', 'C5', 'A4'].forEach((n, i) => tone(freq(n), 0.3, { at: at + i * 0.18, wave: 'triangle', vol: 0.2 }));
      break;
    case 'freeze':
      ['B6', 'G6', 'E6', 'B5'].forEach((n, i) => tone(freq(n), 0.25, { at: at + i * 0.05, wave: 'sine', vol: 0.15 }));
      break;
    case 'confuse':
      for (let i = 0; i < 6; i++) tone(500 + Math.sin(i) * 150, 0.07, { at: at + i * 0.06, wave: 'triangle', vol: 0.18 });
      break;
    case 'flinch':
      tone(300, 0.12, { at, wave: 'square', vol: 0.18, slideTo: 150 });
      break;
    case 'special':
      noise(0.6, { at, vol: 0.3, filter: 'bandpass', freq: 300, sweepTo: 6000 });
      ['C4', 'G4', 'C5', 'E5', 'G5'].forEach((n) => tone(freq(n), 0.9, { at: at + 0.25, wave: 'pulse25', vol: 0.12, attack: 0.02 }));
      tone(freq('C6'), 0.5, { at: at + 0.25, wave: 'triangle', vol: 0.2 });
      break;
    case 'sun':
      ['C5', 'E5', 'G5', 'B5'].forEach((n, i) => tone(freq(n), 1.0, { at: at + i * 0.08, wave: 'sine', vol: 0.12, attack: 0.2 }));
      break;
    case 'rain':
      noise(1.6, { at, vol: 0.22, filter: 'highpass', freq: 3000 });
      for (let i = 0; i < 10; i++) tone(2000 + Math.random() * 2000, 0.03, { at: at + Math.random() * 1.4, wave: 'sine', vol: 0.05 });
      break;
    case 'sand':
      noise(1.6, { at, vol: 0.28, filter: 'bandpass', freq: 500, sweepTo: 1500 });
      break;
    case 'hail':
      for (let i = 0; i < 14; i++) noise(0.03, { at: at + Math.random() * 1.3, vol: 0.25, filter: 'highpass', freq: 5000 });
      break;
    case 'screen':
      ['G5', 'D6', 'G6'].forEach((n, i) => tone(freq(n), 0.6, { at: at + i * 0.07, wave: 'sine', vol: 0.12, attack: 0.05 }));
      break;
    case 'taunt':
      tone(330, 0.12, { at, wave: 'square', vol: 0.2 });
      tone(247, 0.25, { at: at + 0.13, wave: 'square', vol: 0.2 });
      break;
    case 'flowers':
      ['E5', 'G5', 'B5', 'E6'].forEach((n, i) => tone(freq(n), 0.2, { at: at + i * 0.07, wave: 'sine', vol: 0.15 }));
      break;
    case 'turn':
      tone(freq('G5'), 0.12, { at, wave: 'pulse25', vol: 0.16 });
      tone(freq('C6'), 0.22, { at: at + 0.11, wave: 'pulse25', vol: 0.16 });
      break;
    case 'pick':
      tone(freq('E6'), 0.08, { at, wave: 'pulse25', vol: 0.15 });
      tone(freq('B6'), 0.14, { at: at + 0.06, wave: 'pulse25', vol: 0.13 });
      break;
    case 'place':
      tone(160, 0.12, { at, wave: 'triangle', vol: 0.4, slideTo: 70 });
      noise(0.06, { at, vol: 0.15, freq: 900 });
      break;
    case 'step':
      noise(0.04, { at, vol: 0.08, freq: 700 });
      break;
    case 'trebuchet':
      tone(90, 0.2, { at, wave: 'triangle', vol: 0.4, slideTo: 45 });
      noise(0.5, { at: at + 0.05, vol: 0.2, filter: 'bandpass', freq: 900, sweepTo: 250 });
      break;
    case 'click':
      tone(1200, 0.03, { at, wave: 'square', vol: 0.07 });
      break;
    case 'count':
      tone(freq('A5'), 0.18, { at, wave: 'pulse25', vol: 0.22 });
      break;
    case 'go':
      tone(freq('A6'), 0.45, { at, wave: 'pulse25', vol: 0.24 });
      tone(freq('E6'), 0.45, { at, wave: 'pulse12', vol: 0.14 });
      noise(0.4, { at, vol: 0.18, filter: 'bandpass', freq: 600, sweepTo: 5000 });
      break;
    case 'victory':
      [['C5', 0], ['E5', 0.12], ['G5', 0.24], ['C6', 0.36], ['G5', 0.6], ['C6', 0.72]].forEach(([n, t]) =>
        tone(freq(n as string), (t as number) >= 0.72 ? 0.8 : 0.14, { at: at + (t as number), wave: 'pulse25', vol: 0.2 }));
      ['C4', 'G4', 'E5'].forEach((n) => tone(freq(n), 0.9, { at: at + 0.72, wave: 'triangle', vol: 0.16 }));
      break;
    case 'defeat':
      [['E5', 0], ['D5', 0.3], ['C5', 0.6], ['B4', 0.9], ['A4', 1.2]].forEach(([n, t]) =>
        tone(freq(n as string), (t as number) >= 1.2 ? 1.0 : 0.32, { at: at + (t as number), wave: 'triangle', vol: 0.22 }));
      break;
  }
}

// ---------------------------------------------------------------- voicelines

/** Each trainer's line when they use their Special Move (original lines, read by speech synthesis). */
const VOICE: Record<string, { line: string; pitch: number; rate: number }> = {
  mitsuhide: { line: 'Clear skies, steady hands. Strike true!', pitch: 0.85, rate: 0.95 },
  n: { line: 'Rest now, my friends. Be whole again.', pitch: 1.05, rate: 0.9 },
  nobunaga: { line: 'You! Break through their walls!', pitch: 0.65, rate: 0.95 },
  red: { line: "We're not done yet. Let's go!", pitch: 1.0, rate: 1.05 },
  blue: { line: "Watch closely. This is how it's done!", pitch: 1.15, rate: 1.1 },
  lance: { line: 'Dragons, drive them back!', pitch: 0.75, rate: 0.95 },
};

/**
 * Recorded voicelines: an audio file at public/voices/<trainer>.mp3 (or .ogg) plays instead of the
 * synthesized line. None ship with the game; add clips you have the rights to.
 */
const voiceFiles = new Map<string, Promise<string | null>>();

function voiceFile(trainer: string): Promise<string | null> {
  let p = voiceFiles.get(trainer);
  if (!p) {
    const base = `${import.meta.env.BASE_URL}voices/${trainer}`;
    p = (async () => {
      for (const ext of ['mp3', 'ogg']) {
        try {
          const r = await fetch(`${base}.${ext}`, { method: 'HEAD' });
          if (r.ok && (r.headers.get('content-type') ?? '').startsWith('audio')) return `${base}.${ext}`;
        } catch {
          // No file (or offline): fall back to speech synthesis.
        }
      }
      return null;
    })();
    voiceFiles.set(trainer, p);
  }
  return p;
}

export function speakTrainer(trainer: string): void {
  if (!settings.voice || !unlocked) return;
  void voiceFile(trainer).then((url) => {
    if (url) {
      const a = new Audio(url);
      a.volume = Math.min(1, settings.volume + 0.2);
      void a.play().catch(() => synthLine(trainer));
    } else {
      synthLine(trainer);
    }
  });
}

function synthLine(trainer: string): void {
  const v = VOICE[trainer];
  if (!v || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(v.line);
  u.pitch = v.pitch;
  u.rate = v.rate;
  u.volume = Math.min(1, settings.volume + 0.2);
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- music

/** Battle music is per map: `battle` (Trebuchet Meadow) and `battleRiver` (Winding River). */
export type Track = 'menu' | 'draft' | 'battle' | 'battleRiver' | 'victory' | 'defeat';

interface Song {
  bpm: number;
  /** One chord per bar: root (with octave) and quality. */
  chords: [string, 'maj' | 'min' | '7'][];
  /** Lead melody, one token per eighth note: a note, '-' to hold, '.' for a rest. */
  lead: string;
  /** Drum pattern per bar, one character per sixteenth: k kick, s snare, h hat, '.' nothing. */
  drums?: string;
  loop: boolean;
  /** Arpeggio speed: notes per beat. */
  arp?: number;
}

// All original compositions.
const SONGS: Record<Track, Song> = {
  menu: {
    bpm: 108,
    loop: true,
    arp: 2,
    chords: [['C3', 'maj'], ['A2', 'min'], ['F2', 'maj'], ['G2', 'maj'], ['C3', 'maj'], ['A2', 'min'], ['F2', 'maj'], ['G2', 'maj']],
    lead: 'E5 - G5 - C6 - B5 A5 | A5 - - - G5 E5 - - | F5 - A5 - C6 - A5 G5 | G5 - - - . . D5 - | '
      + 'E5 - G5 - C6 - D6 E6 | E6 - D6 C6 A5 - - - | F5 A5 C6 - D6 - C6 A5 | B5 - - - G5 - - -',
    drums: 'k...h...s...h...',
  },
  draft: {
    bpm: 96,
    loop: true,
    arp: 4,
    chords: [['A2', 'min'], ['F2', 'maj'], ['C3', 'maj'], ['G2', 'maj'], ['A2', 'min'], ['F2', 'maj'], ['C3', 'maj'], ['G2', 'maj']],
    lead: '. . E5 - A5 - B5 - | C6 - - - A5 - - - | G5 - E5 - G5 - C6 - | B5 - - - D5 - - - | '
      + '. . E5 - A5 - C6 - | D6 - C6 - A5 - F5 - | E5 - G5 - C6 - E6 - | D6 - B5 - G5 - - -',
    drums: 'k.......s.......',
  },
  battle: {
    bpm: 152,
    loop: true,
    arp: 4,
    chords: [['E2', 'min'], ['C2', 'maj'], ['D2', 'maj'], ['B1', 'maj'], ['E2', 'min'], ['C2', 'maj'], ['D2', 'maj'], ['B1', 'maj']],
    lead: 'E5 E5 G5 B5 A5 - G5 F#5 | E5 - - - D5 E5 G5 - | F#5 F#5 A5 D6 C6 - B5 A5 | B5 - - - A5 G5 F#5 D#5 | '
      + 'E5 E5 G5 B5 E6 - D6 B5 | C6 - B5 G5 E5 - G5 - | A5 - F#5 D5 F#5 A5 D6 - | B5 - A5 F#5 D#5 - B4 -',
    drums: 'k.h.s.h.k.k.s.hh',
  },
  // Winding River: rolling D minor with arpeggios that keep flowing like the current.
  battleRiver: {
    bpm: 138,
    loop: true,
    arp: 4,
    chords: [['D2', 'min'], ['A#1', 'maj'], ['F2', 'maj'], ['C2', 'maj'], ['D2', 'min'], ['G2', 'min'], ['A#1', 'maj'], ['A1', '7']],
    lead: 'D5 - F5 A5 D6 - C6 A5 | A#5 - A5 F5 D5 - - - | C5 F5 A5 - C6 - A5 F5 | E5 - G5 - C6 - - - | '
      + 'D5 F5 A5 D6 F6 - E6 D6 | D6 - A#5 G5 A#5 D6 - - | F6 - D6 A#5 F5 - A#5 D6 | C#6 - E6 - A5 - - -',
    drums: 'k..hk.s.h.k.s.h.',
  },
  victory: {
    bpm: 132,
    loop: false,
    chords: [['C3', 'maj'], ['G2', 'maj'], ['C3', 'maj']],
    lead: 'C5 E5 G5 C6 - - G5 C6 | D6 - B5 - G5 - D6 - | E6 - - - - - - -',
  },
  defeat: {
    bpm: 72,
    loop: false,
    chords: [['A2', 'min'], ['F2', 'maj'], ['E2', '7']],
    lead: 'E5 - D5 - C5 - B4 - | A4 - - - C5 - B4 - | G#4 - - - - - - -',
  },
};

const CHORD: Record<'maj' | 'min' | '7', number[]> = { maj: [0, 4, 7, 12], min: [0, 3, 7, 12], '7': [0, 4, 7, 10] };
const semis = (f: number, n: number): number => f * 2 ** (n / 12);

let wanted: Track | null = null;
let playing: { track: Track; stop: () => void } | null = null;

/** Switch the background music (cross-fading); the same track keeps playing. */
export function playMusic(track: Track | null, force = false): void {
  wanted = track;
  if (!force && playing?.track === track) return;
  playing?.stop();
  playing = null;
  if (!track || !unlocked) return;
  const c = audio();
  if (!c || !bus) return;
  playing = { track, stop: startSong(c, bus.music, SONGS[track]) };
}

/** Schedules a song a little ahead of time; returns a function that fades it out and stops it. */
function startSong(c: AudioContext, out: AudioNode, song: Song): () => void {
  const fade = c.createGain();
  fade.gain.setValueAtTime(0.0001, c.currentTime);
  fade.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.6);
  fade.connect(out);
  const eighth = 30 / song.bpm;
  const bars = song.lead.split('|').map((b) => b.trim().split(/\s+/));
  const barLen = 8 * eighth;
  const total = bars.length;
  let bar = 0;
  let nextBarAt = c.currentTime + 0.1;
  let stopped = false;

  const scheduleBar = (i: number, t0: number) => {
    const [root, quality] = song.chords[i % song.chords.length];
    const rootF = freq(root);
    // Bass: root on the beat, an octave up on the off-beats.
    for (let e = 0; e < 8; e++) {
      tone(semis(rootF, e % 2 ? 12 : 0), eighth * 0.9, { at: t0 + e * eighth - c.currentTime, wave: 'triangle', vol: 0.35, out: fade });
    }
    // Arpeggio of the chord.
    const per = song.arp ?? 0;
    for (let k = 0; per && k < 4 * per; k++) {
      const n = CHORD[quality][k % 4];
      tone(semis(rootF, 24 + n), (60 / song.bpm / per) * 0.8, { at: t0 + (k * 60) / song.bpm / per - c.currentTime, wave: 'pulse25', vol: 0.06, out: fade });
    }
    // Lead: tokens are eighths; a note lasts while it is followed by holds.
    const toks = bars[i % total];
    toks.forEach((tok, j) => {
      if (tok === '-' || tok === '.') return;
      let len = 1;
      while (toks[j + len] === '-') len += 1;
      tone(freq(tok), len * eighth * 0.92, { at: t0 + j * eighth - c.currentTime, wave: 'pulse12', vol: 0.16, out: fade });
    });
    // Drums.
    if (song.drums) {
      const sixteenth = eighth / 2;
      [...song.drums].forEach((d, j) => {
        const at = t0 + j * sixteenth - c.currentTime;
        if (d === 'k') tone(120, 0.12, { at, wave: 'sine', vol: 0.45, slideTo: 40, out: fade });
        else if (d === 's') noise(0.1, { at, vol: 0.18, filter: 'highpass', freq: 1500, out: fade });
        else if (d === 'h') noise(0.025, { at, vol: 0.06, filter: 'highpass', freq: 7000, out: fade });
      });
    }
  };

  const timer = window.setInterval(() => {
    if (stopped) return;
    while (nextBarAt < c.currentTime + 0.25) {
      if (!song.loop && bar >= total) {
        window.clearInterval(timer);
        return;
      }
      scheduleBar(bar, nextBarAt);
      bar += 1;
      nextBarAt += barLen;
    }
  }, 50);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    const t = c.currentTime;
    fade.gain.cancelScheduledValues(t);
    fade.gain.setValueAtTime(fade.gain.value, t);
    fade.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    window.setTimeout(() => fade.disconnect(), 700);
  };
}
