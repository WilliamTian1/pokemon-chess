"""Finds the loop of each rendered Conquest BGM (intro + loop x2 + fade) by self-similarity.

usage: python loops.py <dir> <file.mp3>...   -> prints JSON lines {file, dur, start, len, ncc, rms_db, peak_db}
"""
import json
import os
import sys

import av
import numpy as np

SR = 44100


def load(path):
    out = []
    rs = av.AudioResampler(format='fltp', layout='stereo', rate=SR)
    with av.open(path) as c:
        for fr in c.decode(audio=0):
            for f in rs.resample(fr):
                out.append(f.to_ndarray())
        for f in rs.resample(None):
            out.append(f.to_ndarray())
    return np.concatenate(out, axis=1)  # (2, n)


def ncc(a, b):
    a = a - a.mean()
    b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def xcorr_valid(sig, ref):
    """Normalized cross-correlation of ref against every position of sig (FFT)."""
    n = len(sig) + len(ref)
    size = 1 << (n - 1).bit_length()
    F = np.fft.rfft(sig, size)
    R = np.fft.rfft(ref[::-1], size)
    raw = np.fft.irfft(F * R, size)[len(ref) - 1: len(sig)]
    # Local energy of sig for each window.
    c2 = np.concatenate([[0], np.cumsum(sig * sig)])
    c1 = np.concatenate([[0], np.cumsum(sig)])
    m = len(ref)
    e = c2[m:] - c2[:-m] - (c1[m:] - c1[:-m]) ** 2 / m
    r = ref - ref.mean()
    denom = np.sqrt(np.maximum(e, 1e-12) * (r * r).sum())
    return raw / denom


def spectro(mono, n=2048, hop=512, bands=48):
    frames = (len(mono) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    mag = np.abs(np.fft.rfft(mono[idx] * np.hanning(n), axis=1))
    edges = np.unique(np.geomspace(2, n // 2, bands + 1).astype(int))
    feat = np.stack([mag[:, a:b].mean(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1)
    feat = np.log1p(100 * feat)
    feat -= feat.mean(axis=1, keepdims=True)
    feat /= np.linalg.norm(feat, axis=1, keepdims=True) + 1e-9
    return feat, hop


def analyse(path):
    st = load(path)
    mono = st.mean(axis=0)
    dur = len(mono) / SR
    F, hop = spectro(mono)
    fsr = SR / hop
    W = int(8 * fsr)
    t0 = len(F) - int(14 * fsr) - W  # just before the fade-out
    if t0 < int(25 * fsr):
        return {'dur': round(dur, 3), 'loop': None}
    sim = F[t0:t0 + W] @ F[: t0 - int(5 * fsr)].T  # (W, P)
    P = sim.shape[1] - W
    score = np.zeros(P)
    for i in range(W):
        score += sim[i, i:i + P]
    score /= W
    # Frame similarity at lag L, smoothed over 1 s.
    def lagsim(L):
        v = np.einsum('ij,ij->i', F[:-L], F[L:])
        k = int(fsr)
        return np.convolve(v, np.ones(k) / k, mode='same')
    cands = []
    for p in np.argsort(-score)[:3000]:
        if score[p] < 0.9:
            break
        if all(abs(p - q) > fsr for q in cands):
            cands.append(p)
    best = None
    for p in sorted(cands, reverse=True):  # smallest lag first
        L = t0 - p
        v = lagsim(L)
        good = v > 0.9
        # Frames of the first pass (around p) compared with the second pass (around t0).
        i = min(p + W // 2, len(good) - 1)
        if not good[i]:
            continue
        j = i
        while j > 0 and good[j - 1]:
            j -= 1
        k = i
        while k < len(good) - 1 and good[k + 1]:
            k += 1
        if (k - j) >= 0.8 * L or (j <= fsr and k - j >= 0.5 * L):
            best = (L, j, float(score[p]))
            break
    if not best:
        return {'dur': round(dur, 3), 'loop': None, 'cands': [round((t0 - p) / fsr, 2) for p in cands[:5]], 'best': round(float(score.max()), 3)}
    L, j, sc = best
    S = j * hop
    Lf = L * hop
    # Splice point a little into the loop; tune the loop length so the waveforms line up there.
    a = S + int(1.0 * SR)
    N = int(0.08 * SR)
    lags = np.arange(Lf - 2 * hop, Lf + 2 * hop + 1)
    seg = mono[a:a + N]
    scores = np.array([ncc(seg, mono[a + l:a + l + N]) for l in lags])
    Lf = int(lags[int(np.argmax(scores))])
    # Check the match over a longer stretch at that lag.
    long = ncc(mono[a:a + int(2 * SR)], mono[a + Lf:a + Lf + int(2 * SR)])
    body = st[:, S:S + Lf]
    rms = float(np.sqrt(np.mean(body ** 2)))
    return {
        'dur': round(dur, 3), 'loopStart': round(a / SR, 5), 'loopLen': round(Lf / SR, 5), 'loopStartSample': int(a), 'loopLenSample': Lf,
        'introEnds': round(S / SR, 2), 'spec': round(sc, 3), 'splice': round(float(scores.max()), 4), 'long': round(long, 4),
        'rms_db': round(20 * np.log10(rms), 2), 'peak_db': round(float(20 * np.log10(np.abs(st).max())), 2),
    }


if __name__ == '__main__':
    d = sys.argv[1]
    for f in sys.argv[2:]:
        r = analyse(os.path.join(d, f))
        r['file'] = f
        print(json.dumps(r), flush=True)
