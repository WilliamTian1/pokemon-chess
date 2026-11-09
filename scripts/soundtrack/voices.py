"""Cleans up the trainer voicelines in public/voices and writes them as 48 kHz WAV.

The clips come from two sources: Pokémon Masters (48 kHz Vorbis, ~16 kHz bandwidth, mastered hot) and
Kessen III (22 kHz PCM from the PS2: nothing above 11 kHz, so they sound dull). For each clip:
  - band-limited resampling to 48 kHz (FFT),
  - a harmonic exciter that regrows the missing top octave from the band below it,
  - a rumble cut at 80 Hz and a gentle presence lift around 3 kHz,
  - the same speech loudness for every clip (the originals' average), with a soft peak limiter at -1 dBFS,
  - 16-bit output with TPDF dither (lossless, so the Masters clips aren't re-encoded lossily).

usage: python voices.py <in dir> <out dir> [names…]   (names default to every clip in <in dir>)
"""
import os
import sys
import wave

import av
import numpy as np

SR = 48000
TARGET_RMS_DB = -12.5  # the average level of the original clips
CEILING = 10 ** (-1.0 / 20)


def load(path):
    """Mono float samples and the source sample rate."""
    out = []
    with av.open(path) as c:
        rate = c.streams.audio[0].rate
        rs = av.AudioResampler(format='flt', layout='mono', rate=rate)
        for fr in c.decode(audio=0):
            for f in rs.resample(fr):
                out.append(f.to_ndarray().reshape(-1))
        for f in rs.resample(None):
            out.append(f.to_ndarray().reshape(-1))
    return np.concatenate(out).astype(np.float64), rate


def resample(x, src, dst):
    """Band-limited resampling by zero-padding the spectrum (the clip is padded so it doesn't wrap)."""
    if src == dst:
        return x
    pad = int(0.05 * src)
    x = np.concatenate([np.zeros(pad), x, np.zeros(pad)])
    n_out = int(round(len(x) * dst / src))
    X = np.fft.rfft(x)
    Y = np.zeros(n_out // 2 + 1, dtype=complex)
    k = min(len(X), len(Y))
    Y[:k] = X[:k]
    y = np.fft.irfft(Y, n_out) * (n_out / len(x))
    cut = int(round(pad * dst / src))
    return y[cut:len(y) - cut]


def spectral(x, gain_fn):
    """Applies a zero-phase gain curve (function of frequency in Hz) to the whole clip."""
    n = 1 << (len(x) - 1).bit_length()
    X = np.fft.rfft(x, n)
    f = np.fft.rfftfreq(n, 1 / SR)
    return np.fft.irfft(X * gain_fn(f), n)[: len(x)]


def smoothstep(f, lo, hi):
    t = np.clip((f - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def bandwidth(x):
    """Highest frequency within 50 dB of the spectrum's peak."""
    n = 4096
    spec = np.zeros(n // 2 + 1)
    for i in range(0, max(1, len(x) - n), n // 2):
        seg = x[i:i + n]
        if len(seg) < n:
            break
        spec += np.abs(np.fft.rfft(seg * np.hanning(n))) ** 2
    db = 10 * np.log10(spec / spec.max() + 1e-12)
    return np.fft.rfftfreq(n, 1 / SR)[np.where(db > -50)[0].max()]


def excite(x, top):
    """Regrows the octave above `top` Hz from the octave below it, about 18 dB down."""
    band = spectral(x, lambda f: smoothstep(f, top / 2.2, top / 2) * (1 - smoothstep(f, top * 0.9, top)))
    drive = 4.0 / (np.abs(band).max() + 1e-9)
    harm = np.tanh(drive * band) / drive
    harm = harm - np.abs(band) * 0.15  # a touch of even harmonics too
    air = spectral(harm, lambda f: smoothstep(f, top * 0.95, top * 1.08) * (1 - smoothstep(f, 19000, 22000)))
    ref = np.sqrt(np.mean(band ** 2)) + 1e-12
    return x + air * (10 ** (-18 / 20) * ref / (np.sqrt(np.mean(air ** 2)) + 1e-12))


def eq(x):
    def curve(f):
        hp = smoothstep(f, 55, 90)
        presence = 10 ** ((2.0 * np.exp(-0.5 * (np.log2(np.maximum(f, 1) / 3000) / 0.6) ** 2)) / 20)
        return hp * presence
    return spectral(x, curve)


def limit(x):
    """Soft peak limiter: per-sample gain to stay under the ceiling, with a 2 ms attack and 40 ms release."""
    need = np.minimum(1.0, CEILING / (np.abs(x) + 1e-12))
    att = int(0.002 * SR)
    # Look ahead: the gain reaches its minimum before the peak.
    ahead = np.array([need[i:i + att].min() for i in range(len(need))])
    g = np.empty_like(ahead)
    rel = np.exp(-1 / (0.04 * SR))
    cur = 1.0
    for i, v in enumerate(ahead):
        cur = v if v < cur else rel * cur + (1 - rel) * v
        g[i] = cur
    return x * g


def loudness(x):
    """RMS (dB) over the voiced part of the clip."""
    w = int(0.02 * SR)
    frames = np.array([np.sqrt(np.mean(x[i:i + w] ** 2)) for i in range(0, len(x) - w, w)])
    voiced = frames[frames > frames.max() * 10 ** (-30 / 20)]
    return 20 * np.log10(np.sqrt(np.mean(voiced ** 2)) + 1e-12)


def write_wav(path, x):
    rng = np.random.default_rng(0)
    dither = (rng.random(len(x)) - rng.random(len(x))) / 32768
    pcm = np.clip(np.round((x + dither) * 32767), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def process(path):
    x, rate = load(path)
    x = resample(x, rate, SR)
    top = min(bandwidth(x), 0.48 * rate)
    if top < 18500:
        x = excite(x, top)
    x = eq(x)
    x = x * 10 ** ((TARGET_RMS_DB - loudness(x)) / 20)
    x = limit(x)
    # Fade the first and last 5 ms so cuts never click.
    f = int(0.005 * SR)
    x[:f] *= np.linspace(0, 1, f)
    x[-f:] *= np.linspace(1, 0, f)
    return x, rate, top


def main():
    src, dst = sys.argv[1], sys.argv[2]
    names = sys.argv[3:] or sorted(f for f in os.listdir(src) if f.endswith(('.ogg', '.wav')))
    os.makedirs(dst, exist_ok=True)
    for name in names:
        x, rate, top = process(os.path.join(src, name))
        out = os.path.join(dst, name.rsplit('.', 1)[0] + '.wav')
        write_wav(out, x)
        print(f'{name:16s} {rate} Hz, content to {top / 1000:4.1f} kHz -> {out}  ({len(x) / SR:.2f}s, peak {20 * np.log10(np.abs(x).max()):.1f} dB)')


if __name__ == '__main__':
    main()
