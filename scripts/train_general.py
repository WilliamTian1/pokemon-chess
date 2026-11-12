"""Fits the general draft model from `train-draft-general.ts --export rows.json`, as matrix maths.

    python3 scripts/train_general.py rows.json weights.json [--iters 600]

The same model, loss, penalties and 5-fold cross-validation as the TypeScript trainer, but vectorised:
numpy on the CPU (seconds), or PyTorch on a CUDA GPU if a CUDA build of torch is importable. The
weights go back through `train-draft-general.ts --weights weights.json`, which writes general.json.
"""
import json
import sys
import time

import numpy as np

args = sys.argv[1:]
ITERS = int(args[args.index('--iters') + 1]) if '--iters' in args else 600
src, out = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or args[i - 1] != '--iters')][:2]

try:  # a GPU if there is one; numpy otherwise
    import torch
    DEV = 'cuda' if torch.cuda.is_available() else None
except Exception:  # noqa: BLE001
    DEV = None

t0 = time.time()
data = json.load(open(src))
F, BIAS, roles, rows = data['F'], data['BIAS'], data['roles'], data['rows']
n = len(rows)
X = np.zeros((n, F), dtype=np.float32)
for i, r in enumerate(rows):
    for j in r['s']:
        X[i, j] += 1.0
    for j, v in r['d']:
        X[i, j] += v
    X[i, BIAS] = 1.0
y = np.array([r['y'] for r in rows], dtype=np.float32)
fold = np.array([r['f'] for r in rows])
group = np.array([r['g'] for r in rows])
groups = data['groups']
role = np.array(roles)
print(f'{n} rows x {F} columns, built in {time.time() - t0:.1f}s, fitting on {DEV or "cpu (numpy)"}', flush=True)


def penalties(lam, delta, inter):
    p = np.zeros(F, dtype=np.float32)
    p[role == 'card'] = lam
    p[(role == 'corr') | (role == 'mapcorr')] = delta
    p[role == 'inter'] = inter
    return p


def fit(rows_mask, cols_mask, pen):
    """Full-batch Adam on mean log loss + L2, over the chosen rows and columns."""
    Xs = X[rows_mask][:, cols_mask]
    ys = y[rows_mask]
    ps = pen[cols_mask]
    if DEV:
        Xt = torch.tensor(Xs, device=DEV)
        yt = torch.tensor(ys, device=DEV)
        pt = torch.tensor(ps, device=DEV)
        w = torch.zeros(Xs.shape[1], device=DEV)
        m = torch.zeros_like(w)
        v = torch.zeros_like(w)
        for it in range(1, ITERS + 1):
            e = torch.sigmoid(Xt @ w) - yt
            g = Xt.T @ e / len(ys) + pt * w
            m = 0.9 * m + 0.1 * g
            v = 0.999 * v + 0.001 * g * g
            w -= 0.05 * (m / (1 - 0.9 ** it)) / (torch.sqrt(v / (1 - 0.999 ** it)) + 1e-8)
        full = np.zeros(F, dtype=np.float32)
        full[cols_mask] = w.cpu().numpy()
        return full
    w = np.zeros(Xs.shape[1], dtype=np.float32)
    m = np.zeros_like(w)
    v = np.zeros_like(w)
    for it in range(1, ITERS + 1):
        e = 1.0 / (1.0 + np.exp(-(Xs @ w))) - ys
        g = Xs.T @ e / len(ys) + ps * w
        m = 0.9 * m + 0.1 * g
        v = 0.999 * v + 0.001 * g * g
        w -= 0.05 * (m / (1 - 0.9 ** it)) / (np.sqrt(v / (1 - 0.999 ** it)) + 1e-8)
    full = np.zeros(F, dtype=np.float32)
    full[cols_mask] = w
    return full


def logloss(w, rows_mask):
    z = X[rows_mask] @ w
    p = np.clip(1.0 / (1.0 + np.exp(-z)), 1e-9, 1 - 1e-9)
    yy = y[rows_mask]
    return -(yy * np.log(p) + (1 - yy) * np.log(1 - p))


def cv(cols_mask, pen, rows_mask=None):
    """Held-out log loss per group (5-fold)."""
    base = np.ones(n, dtype=bool) if rows_mask is None else rows_mask
    total = np.zeros(n)
    for k in range(5):
        w = fit(base & (fold != k), cols_mask, pen)
        test = base & (fold == k)
        total[test] = logloss(w, test)
    return {g: float(total[base & (group == g)].mean()) for g in groups if (base & (group == g)).any()}


def overall(per):
    counts = {g: int((group == g).sum()) for g in per}
    return sum(per[g] * counts[g] for g in per) / sum(counts.values())


fmt = lambda per: ' · '.join(f'{g} {per[g]:.4f}' for g in groups if g in per)  # noqa: E731
everything = np.ones(F, dtype=bool)
best = None
for lam, delta, inter in [(0.001, 0.01, 0.003), (0.0003, 0.01, 0.003), (0.0001, 0.01, 0.003), (0.0001, 0.003, 0.003), (0.0001, 0.003, 0.001),
                          (0.0001, 0.001, 0.001), (0.00003, 0.003, 0.001), (0.0003, 0.003, 0.001)]:
    pen = penalties(lam, delta, inter)
    per = cv(everything, pen)
    loss = overall(per)
    print(f'  λ={lam} λΔ={delta} λI={inter}: {loss:.4f}  ({fmt(per)})  [{time.time() - t0:.0f}s]', flush=True)
    if best is None or loss < best[0]:
        best = (loss, (lam, delta, inter), per)

loss, (lam, delta, inter), per = best
pen = penalties(lam, delta, inter)
no_inter = cv(role != 'inter', pen)
print(f'without map traits:       {overall(no_inter):.4f}  ({fmt(no_inter)})')
sep = {}
for g in groups:
    sep[g] = cv((role != 'inter') & (role != 'mapcorr'), pen, group == g)[g]
print(f'separate model per group: {overall(sep):.4f}  ({fmt(sep)})')
print(f'general model:            {loss:.4f}  ({fmt(per)})')
w = fit(np.ones(n, dtype=bool), everything, pen)
json.dump({'w': [round(float(x), 6) for x in w], 'pen': {'lambda': lam, 'delta': delta, 'inter': inter}, 'loss': loss}, open(out, 'w'))
print(f'wrote {out} ({time.time() - t0:.0f}s)')
