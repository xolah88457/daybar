# Synthesizes a 48 s ambient soundtrack for the Daybar ad: warm pad chords that change with the
# scenes, a quiet plucked arpeggio, sub bass, a whoosh for the window reveal, soft UI clicks timed
# to the on-screen clicks, and a bell on the logo. Writes a 48 kHz stereo 16-bit WAV.
import sys, wave
import numpy as np

SR = 48000
DUR = 48.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
t_all = np.arange(N) / SR

def midi(m): return 440.0 * 2 ** ((m - 69) / 12)

def env(n, a, r, hold=None):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na) ** 2
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 1.6
    return e

def onepole_lp(x, cutoff):
    # vectorised enough: process in blocks with a scalar state
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x); s = 0.0
    for i in range(0, len(x), 4096):
        blk = x[i:i + 4096]
        out = np.empty_like(blk)
        for j, v in enumerate(blk):
            s = (1 - a) * v + a * s; out[j] = s
        y[i:i + 4096] = out
    return y

L = np.zeros(N); R = np.zeros(N)
def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR); j = min(N, i + len(sig))
    if j <= i: return
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    L[i:j] += sig[:j - i] * gain * l * 1.414; R[i:j] += sig[:j - i] * gain * r * 1.414

# --- pad: additive, slightly detuned, soft harmonics
def pad_note(f, length, detune=0.0):
    n = int(length * SR); t = np.arange(n) / SR
    sig = np.zeros(n)
    for h, amp in [(1, 1.0), (2, .32), (3, .14), (4, .06)]:
        for d in (-detune, detune):
            ff = f * h * (1 + d)
            sig += amp * np.sin(2 * np.pi * ff * t + rng.uniform(0, 6.28))
    lfo = 1 + .06 * np.sin(2 * np.pi * .23 * t + rng.uniform(0, 6.28))
    return sig * lfo * env(n, 1.4, 1.8) / 2

# scene chords (start, length, midi notes)
C = lambda *n: list(n)
chords = [
    (0.0, 4.9, C(41, 52, 55, 60, 64)),       # Fmaj7 swell under the intro
    (4.4, 5.1, C(48, 55, 59, 62, 64)),       # Cmaj9 reveal
    (9.0, 6.4, C(45, 52, 55, 59, 60)),       # Am9 habits
    (14.9, 6.2, C(41, 48, 52, 55, 57)),      # Fmaj9 focus
    (20.7, 6.4, C(40, 48, 52, 55, 59)),      # Cmaj7/E countdown
    (26.7, 5.6, C(38, 50, 53, 57, 60)),      # Dm9 radar
    (31.9, 5.8, C(43, 50, 55, 57, 59)),      # G6/9 day & night
    (37.3, 5.9, C(45, 52, 55, 60, 64)),      # Am(add9) sync
    (42.7, 5.3, C(48, 55, 59, 62, 64, 67)),  # Cmaj9 end card
]
for start, length, notes in chords:
    for k, m in enumerate(notes):
        g = .055 if m < 47 else .045
        add(pad_note(midi(m), length + 1.6, .0016 + .0007 * k), start, g, pan=(-.5 + k / max(1, len(notes) - 1)) * .7)
    # sub bass on the root
    n = int((length + 1.2) * SR); t = np.arange(n) / SR
    add(np.sin(2 * np.pi * midi(notes[0] - 12) * t) * env(n, .6, 1.2), start, .10)

# --- plucked arpeggio from the reveal to the end card: quiet, 0.375 s grid
def pluck(f, length=1.6):
    n = int(length * SR); t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * 2 * f * t) + .08 * np.sin(2 * np.pi * 3 * f * t)
    return s * np.exp(-t * 4.2) * env(n, .004, .05)
step = .375
for start, length, notes in chords[1:-1]:
    upper = [m + 12 for m in notes[1:]]
    seq = upper + upper[-2:0:-1]
    k = 0; tt = start + .2
    while tt < start + length - .1:
        m = seq[k % len(seq)]
        add(pluck(midi(m)), tt, .028 if k % 4 else .04, pan=.35 * np.sin(k * 1.3))
        k += 1; tt += step

# --- whoosh for the window reveal (noise swept through a rising low-pass)
n = int(2.2 * SR); noise = rng.standard_normal(n)
sweep = np.concatenate([onepole_lp(noise[:n // 2], 900), onepole_lp(noise[n // 2:], 2600)])
add(sweep * np.sin(np.linspace(0, np.pi, n)) ** 2, 3.15, .05)
# soft shimmer as the intro squares fill
for i in range(14):
    add(pluck(midi(84 + [0, 4, 7, 11, 14][i % 5]), .9), .25 + i * .1, .012, pan=-.6 + i * .09)

# --- UI clicks (match the on-screen clicks)
def click():
    n = int(.05 * SR); t = np.arange(n) / SR
    tick = np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 160)
    body = rng.standard_normal(n) * np.exp(-t * 300) * .4
    return tick + body
for tc in [10.75, 11.7, 16.45, 27.15, 33.15, 34.4, 36.6]:
    add(click(), tc, .085)

# --- bell on the logo
def bell(f, length=4.0):
    n = int(length * SR); t = np.arange(n) / SR
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in [(1, 1, 1.1), (2.0, .5, 1.8), (2.76, .3, 2.6), (5.4, .12, 4)])
    return s * env(n, .003, .4)
add(bell(midi(76)), 43.0, .07); add(bell(midi(83)), 43.05, .04, pan=.3)

# --- reverb: convolve with a 2.6 s exponentially decaying stereo noise impulse
def reverb(x, seed):
    n = int(2.6 * SR); t = np.arange(n) / SR
    ir = np.random.default_rng(seed).standard_normal(n) * np.exp(-t * 2.4)
    ir = onepole_lp(ir, 5200); ir /= np.sqrt((ir ** 2).sum())
    size = 1 << int(np.ceil(np.log2(len(x) + n)))
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
    return y
wetL, wetR = reverb(L, 1), reverb(R, 2)
outL = L * .75 + wetL * .55; outR = R * .75 + wetR * .55

# master: gentle fades, soft clip, normalise to -1 dBFS
fade = np.ones(N); fi, fo = int(.3 * SR), int(2.5 * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[-fo:] = np.linspace(1, 0, fo) ** 1.5
out = np.stack([outL, outR], 1) * fade[:, None]
out = np.tanh(out * 1.2 / np.abs(out).max())
out *= 10 ** (-1 / 20) / np.abs(out).max()
wav = (out * 32767).astype('<i2')
with wave.open(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(wav.tobytes())
print('peak', np.abs(out).max(), 'rms dB', 20 * np.log10(np.sqrt((out ** 2).mean())))
