"""Turns the Conquest BGM rips (intro + loop x2 + fade, 320 kbps) into game-ready files.

Looped tracks: intro + exactly one loop, with the last 120 ms crossfaded into the audio just before the
loop start (the two passes of an emulator render aren't sample-identical), then a short pad. The game
loops between loopStart and loopEnd, so the jump is seamless even if a decoder shifts the audio by up
to ~45 ms. One-shots (jingles) are trimmed of trailing silence. Everything is 128 kbps MP3, and the
manifest gives each track a gain that brings it to the same loudness.

usage: python process.py <src dir> <out dir> <manifest.json>
"""
import json
import os
import sys

import av
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from loops import SR, load, spectro  # noqa: E402

TRACKS = {
    # id: (source file, looped)
    'title': ('0000 BGM_SYSTEM_GENERAL_USE.mp3', True),
    'draft': ('0001 BGM_STRATEGY_MAP_A.mp3', True),
    'lab': ('0002 BGM_STRATEGY_MAP_B.mp3', True),
    'battle': ('0008 BGM_BATTLE_NORMAL.mp3', True),
    'battleRiver': ('000a BGM_BATTLE_WATER.mp3', True),
    'climax': ('001a BGM_BATTLE_BOSS.mp3', True),
    'resultsWin': ('001c BGM_EVENT_GOOD.mp3', True),
    'resultsLose': ('0025 BGM_EVENT_SAD.mp3', True),
    'jingleWin': ('0020 BGM_JINGLE_BATTLE_WIN.mp3', False),
    'jingleLose': ('0021 BGM_JINGLE_BATTLE_LOSE.mp3', False),
    'jingleSpecial': ('0023 BGM_JINGLE_BUSYO_EVOLUTION.mp3', False),
    'jingleEvolve': ('0022 BGM_JINGLE_POKEMON_EVOLUTION.mp3', False),
}
TARGET_RMS_DB = -18.0
XFADE = int(0.12 * SR)
MARGIN = 2048  # pure continuation at the end of the crossfade, for decoder offsets
PAD = int(0.3 * SR)


def find_loop(mono):
    """(introEnd, loopLen) in samples, from spectral self-similarity."""
    F, hop = spectro(mono)
    fsr = SR / hop
    W = int(8 * fsr)
    t0 = len(F) - int(14 * fsr) - W
    sim = F[t0:t0 + W] @ F[: t0 - int(5 * fsr)].T
    P = sim.shape[1] - W
    score = np.zeros(P)
    for i in range(W):
        score += sim[i, i:i + P]
    score /= W
    cands = []
    for p in np.argsort(-score)[:3000]:
        if score[p] < 0.9:
            break
        if all(abs(p - q) > fsr for q in cands):
            cands.append(p)
    k1 = int(fsr)
    for p in sorted(cands, reverse=True):
        L = t0 - p
        v = np.convolve(np.einsum('ij,ij->i', F[:-L], F[L:]), np.ones(k1) / k1, mode='same')
        good = v > 0.9
        i = min(p + W // 2, len(good) - 1)
        if not good[i]:
            continue
        j = i
        while j > 0 and good[j - 1]:
            j -= 1
        k = i
        while k < len(good) - 1 and good[k + 1]:
            k += 1
        # A true loop matches across (almost) the whole render; a repeated phrase only briefly.
        coverage = (k - j) / (len(F) - L)
        if coverage >= 0.7:
            return j * hop, L * hop, float(score[p])
    raise RuntimeError('no loop found')


def best_splice(mono, intro, L):
    """Loop start A and exact length: where the stretch before A best matches the stretch before A+L."""
    best = None
    lo = intro + int(0.3 * SR)
    hi = intro + int(min(15.0, L / SR / 3) * SR)
    R = 1024
    for A in range(max(lo, XFADE + MARGIN), hi, int(0.025 * SR)):
        a = mono[A - XFADE:A]
        b = mono[A + L - XFADE - R:A + L + R]
        if len(b) < XFADE + 2 * R:
            break
        # Normalized correlation of a against every shift of b.
        n = 1 << (len(b) + len(a)).bit_length()
        raw = np.fft.irfft(np.fft.rfft(b, n) * np.fft.rfft(a[::-1], n), n)[len(a) - 1:len(b)]
        c2 = np.concatenate([[0], np.cumsum(b * b)])
        e = c2[XFADE:] - c2[:-XFADE]
        cc = raw / np.sqrt(np.maximum(e, 1e-12) * (a * a).sum())
        k = int(np.argmax(cc))
        if best is None or cc[k] > best[0]:
            best = (float(cc[k]), A, L - R + k)
    return best


def encode(st, path):
    with av.open(path, 'w', format='mp3') as out:
        s = out.add_stream('libmp3lame', rate=SR, layout='stereo')
        s.bit_rate = 128000
        x = np.clip(st, -1, 1).astype(np.float32)
        step = 1152
        for i in range(0, x.shape[1], step):
            fr = av.AudioFrame.from_ndarray(np.ascontiguousarray(x[:, i:i + step]), format='fltp', layout='stereo')
            fr.sample_rate = SR
            for p in s.encode(fr):
                out.mux(p)
        for p in s.encode(None):
            out.mux(p)


def main():
    src, outdir, manifest = sys.argv[1:4]
    os.makedirs(outdir, exist_ok=True)
    meta = {}
    for tid, (fname, looped) in TRACKS.items():
        st = load(os.path.join(src, fname))
        mono = st.mean(axis=0)
        if looped:
            intro, L, spec = find_loop(mono)
            match, A, L = best_splice(mono, intro, L)
            y = st[:, :A + L].copy()
            n = XFADE - MARGIN
            t = np.linspace(0, np.pi / 2, n)
            w_out, w_in = np.cos(t), np.sin(t)
            tail = slice(A + L - XFADE, A + L - MARGIN)
            y[:, tail] = st[:, tail] * w_out + st[:, A - XFADE:A - MARGIN] * w_in
            y[:, A + L - MARGIN:A + L] = st[:, A - MARGIN:A]
            y = np.concatenate([y, st[:, A:A + PAD]], axis=1)
            body = st[:, A:A + L]
            info = {'loopStart': round(A / SR, 5), 'loopEnd': round((A + L) / SR, 5)}
            note = f'loop {L / SR:7.3f}s from {A / SR:6.3f}s (spectral {spec:.3f}, splice match {match:.3f})'
        else:
            env = np.abs(mono)
            last = np.where(env > 10 ** (-60 / 20))[0].max()
            y = st[:, :min(st.shape[1], last + int(0.05 * SR))]
            body = y
            info = {}
            note = f'one-shot {y.shape[1] / SR:6.2f}s'
        rms_db = 20 * np.log10(np.sqrt(np.mean(body ** 2)))
        peak_db = 20 * np.log10(np.abs(y).max())
        gain_db = min(TARGET_RMS_DB - rms_db, -0.3 - peak_db)
        out = f'{tid}.mp3'
        encode(y, os.path.join(outdir, out))
        meta[tid] = {'file': out, **info, 'gain': round(float(10 ** (gain_db / 20)), 3)}
        size = os.path.getsize(os.path.join(outdir, out)) / 1e6
        print(f'{tid:14s} {note}  rms {rms_db:6.1f}dB gain {gain_db:+5.1f}dB  {y.shape[1] / SR:6.1f}s {size:4.2f}MB  <- {fname}', flush=True)
    with open(manifest, 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    main()
