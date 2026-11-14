"""Fits the value network (src/ai/value.ts) on a GPU from positions made by scripts/featurize.ts.

    .venv/bin/python scripts/train_value.py .train/run/gen1 [more folders or .f32 files…] --out src/ai/models/value.json
    .venv/bin/python scripts/train_value.py <positions…> --reexport old-model.json --out src/ai/models/value.json

Each folder holds `features.json` (column names) and `*.f32` files (one row of float32 per position).
Games whose seed is a multiple of 10 are held out for validation. The main head's target is the game's
result. Side heads, which only help the shared layers learn and are not exported, predict the final HP and
fainted counts of both teams, the final round, and the Hard search's own value of the position where it
was recorded (what its look-ahead concluded, turned into a win chance: a steadier target that differs
from position to position within a game, which the result alone does not).

It trains `--nets` networks from different seeds (their outputs are averaged), prints the held-out log
loss next to two baselines (a constant, and a logistic fit of the hand-written evaluation) and by round,
and writes the model with the input normalisation folded into the weights, in the readable layout
value.ts loads: notes, a summary of what the network learned, then the weights one named row per line.
The defaults are the recipe of the shipped model. `--reexport` skips the training and rewrites an
existing model file in that layout, recomputing its summary on the given positions.

Needs PyTorch (the default Linux build uses an NVIDIA GPU if there is one):
    python3 -m venv --without-pip .venv && pip --python .venv/bin/python install torch numpy
"""
import argparse
import glob
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument('inputs', nargs='+')
ap.add_argument('--out', default='')
ap.add_argument('--reexport', default='', help='instead of training: rewrite this model file (any earlier layout) in the readable '
                'layout, with its summary recomputed on the given positions')
ap.add_argument('--h', type=int, default=32)
ap.add_argument('--hu2', type=int, default=32)
ap.add_argument('--h2', type=int, default=64)
ap.add_argument('--h3', type=int, default=32)
ap.add_argument('--epochs', type=int, default=8)
ap.add_argument('--batch', type=int, default=1024)
ap.add_argument('--lr', type=float, default=2e-3)
ap.add_argument('--wd', type=float, default=1e-3)
ap.add_argument('--dropout', type=float, default=0.3)
ap.add_argument('--aux', type=float, default=0.5, help='weight of the side heads')
ap.add_argument('--search', type=float, default=2.0, help='weight of the search-value head')
ap.add_argument('--nets', type=int, default=3, help='train this many networks (different seeds) and export them as an ensemble')
ap.add_argument('--seed', type=int, default=1)
ap.add_argument('--drop', default='evalA,evalD',
                help='comma-separated feature names to leave out (by default the hand evaluation: the network is as good without it)')
ap.add_argument('--max-rows', type=int, default=0)
ap.add_argument('--quiet', action='store_true')
args = ap.parse_args()

torch.manual_seed(args.seed)
np.random.seed(args.seed)
DEV = 'cuda' if torch.cuda.is_available() else 'cpu'
t0 = time.time()

# ---------------------------------------------------------------- model files
# In memory a network is a dict of arrays, each layer as (inputs × outputs):
#   emb (cards × h), wu (Pokémon features × h), bu (h), bs (2 × h), wu2 (h × p) / bu2 or None,
#   w1 ((4p + position features) × h2), b1, w2 (h2 × h3), b2, w3 (h3), b3


def load_model(path):
    """A model file in the readable layout (version 3) or the flat one before it (version 2)."""
    m = json.load(open(path))
    A = lambda x: np.asarray(x, dtype=np.float64)  # noqa: E731
    if m['version'] == 2:
        h, hu2, h2, h3 = m['h'], m['hu2'], m['h2'], m['h3']
        nets = [dict(emb=A(n['emb']).reshape(-1, h), wu=A(n['wu']).reshape(-1, h), bu=A(n['bu']), bs=A(n['bs']).reshape(2, h),
                     wu2=A(n['wu2']).reshape(h, hu2) if hu2 else None, bu2=A(n['bu2']) if hu2 else None,
                     w1=A(n['w1']).reshape(-1, h2), b1=A(n['b1']), w2=A(n['w2']).reshape(h2, h3), b2=A(n['b2']), w3=A(n['w3']), b3=float(n['b3']))
                for n in m['nets']]
        return dict(cards=m['cards'], unit=m['unitFeatures'], glob=m['globalFeatures'], sizes=(h, hu2, h2, h3), nets=nets, training=m.get('about', {}))
    L = m['layers']
    first = m['networks'][0]
    cards, unit, glob = list(first['cardVectors']), list(first['pokemonFeatureWeights']), list(first['hidden1']['positionFeatures'])
    nets = []
    for n in m['networks']:
        h1 = n['hidden1']
        l2 = n.get('pokemonLayer2')
        nets.append(dict(
            emb=A([n['cardVectors'][c] for c in cards]), wu=A([n['pokemonFeatureWeights'][f] for f in unit]), bu=A(n['pokemonBias']),
            bs=A([n['sideBias']['attacker'], n['sideBias']['defender']]),
            wu2=A(l2['weights']) if l2 else None, bu2=A(l2['bias']) if l2 else None,
            w1=A(h1['attackerSum'] + h1['attackerMax'] + h1['defenderSum'] + h1['defenderMax'] + [h1['positionFeatures'][g] for g in glob]),
            b1=A(h1['bias']), w2=A(n['hidden2']['weights']), b2=A(n['hidden2']['bias']), w3=A(n['output']['weights']), b3=float(n['output']['bias'])))
    return dict(cards=cards, unit=unit, glob=glob, sizes=(L['pokemonVector'], L['pokemonLayer2'], L['hidden1'], L['hidden2']), nets=nets, training=m['training'])


OLD = load_model(args.reexport) if args.reexport else None

# ---------------------------------------------------------------- data

META = ['seed', 'z', 'end', 'faintedA', 'faintedD', 'hpFracA', 'hpFracD', 'round', 'hasSearch', 'search']
parts, src_parts, meta = [], [], None
for i, p in enumerate(args.inputs):
    folder = p if os.path.isdir(p) else os.path.dirname(p)
    m = json.load(open(os.path.join(folder, 'features.json')))
    assert meta is None or (m['unit'] == meta['unit'] and m['global'] == meta['global'] and m['cards'] == meta['cards']), 'feature sets differ'
    meta = m
    for f in (sorted(glob.glob(os.path.join(p, '*.f32'))) if os.path.isdir(p) else [p]):
        raw = np.fromfile(f, dtype=np.float32).reshape(-1, m['width'])
        # Files from before the search value was recorded have fewer leading columns: missing ones are 0.
        lead = np.zeros((len(raw), len(META)), dtype=np.float32)
        for k, name in enumerate(META):
            if name in m['meta']:
                lead[:, k] = raw[:, m['meta'].index(name)]
        parts.append(np.concatenate([lead, raw[:, len(m['meta']):]], 1))
        src_parts.append(np.full(len(raw), i))
NM, NG, NU, NC = len(META), len(meta['global']), len(meta['unit']), len(meta['cards'])
meta = {**meta, 'meta': META, 'width': NM + NG + 8 * (1 + NU)}
data = np.concatenate(parts)
source = np.concatenate(src_parts)
del parts, src_parts
if args.max_rows:
    data, source = data[: args.max_rows], source[: args.max_rows]
assert not np.isnan(data).any()
M = {n: data[:, i] for i, n in enumerate(meta['meta'])}
G = data[:, NM:NM + NG]
U = data[:, NM + NG:].reshape(-1, 8, 1 + NU)
card = U[:, :, 0].astype(np.int64)            # 0 = empty slot, else card index + 1
X = U[:, :, 1:]
present = card > 0

drop = set(args.drop.split(',')) - {''}
if OLD:  # the inputs the existing model reads
    drop = (set(meta['unit']) - set(OLD['unit'])) | (set(meta['global']) - set(OLD['glob']))
    args.h, args.hu2, args.h2, args.h3 = OLD['sizes']
g_keep = [i for i, n in enumerate(meta['global']) if n not in drop]
u_keep = [i for i, n in enumerate(meta['unit']) if n not in drop]
g_names = [meta['global'][i] for i in g_keep]
u_names = [meta['unit'][i] for i in u_keep]

val = (M['seed'].astype(np.int64) % 10) == 0
tr = ~val
# Normalisation from the training rows (Pokémon features over occupied slots only).
g_mu, g_sd = G[tr][:, g_keep].mean(0), np.maximum(G[tr][:, g_keep].std(0), 0.05)
xs = X[tr][present[tr]][:, u_keep]
u_mu, u_sd = xs.mean(0), np.maximum(xs.std(0), 0.05)
del xs


# The search's value as a win chance: a logistic fit of the result on it, separately for each side to
# move (the two sides' hand evaluations are on different scales) and for each input (different
# generations of self-play may have searched with different evaluations).
a_to_move = G[:, meta['global'].index('aToMove')] > 0.5
has_sv = (M['hasSearch'] > 0.5) if 'hasSearch' in M else np.zeros(len(data), dtype=bool)
sv = np.zeros(len(data), dtype=np.float32)
for src, name, side in [(i, n, sd & (source == i)) for i in range(len(args.inputs)) for n, sd in (('Attacker', a_to_move), ('Defender', ~a_to_move))]:
    mk = has_sv & side & tr
    if mk.sum() < 100:
        has_sv &= ~side
        continue
    v = torch.tensor(np.clip(M['search'][mk], -6, 6), dtype=torch.float64)
    yy = torch.tensor(M['z'][mk], dtype=torch.float64)
    ab = torch.zeros(2, dtype=torch.float64, requires_grad=True)
    o = torch.optim.LBFGS([ab], max_iter=200)

    def closure():
        o.zero_grad()
        loss = F.binary_cross_entropy_with_logits(ab[0] * v + ab[1], yy)
        loss.backward()
        return loss
    o.step(closure)
    a, b = ab.tolist()
    every = has_sv & side
    sv[every] = 1 / (1 + np.exp(-(a * np.clip(M['search'][every], -6, 6) + b)))
    print(f'search value → win chance, {args.inputs[src]}, {name} to move: logit = {a:.3f}·v + {b:.3f} (log loss {closure().item():.4f} on {mk.sum()} positions)')


def tensors(mask):
    aux = np.stack([M['hpFracA'], M['hpFracD'], M['faintedA'] / 4, M['faintedD'] / 4, M['end'] / 10], 1)[mask]
    return dict(
        sv=torch.tensor(sv[mask], device=DEV),
        has_sv=torch.tensor(has_sv[mask], device=DEV),
        g=torch.tensor((G[mask][:, g_keep] - g_mu) / g_sd, device=DEV),
        x=torch.tensor((X[mask][:, :, u_keep] - u_mu) / u_sd, device=DEV),
        c=torch.tensor(card[mask], device=DEV),
        y=torch.tensor(M['z'][mask], device=DEV),
        aux=torch.tensor(aux, device=DEV),
        rnd=torch.tensor(M['round'][mask], device=DEV),
    )


T, V = tensors(tr), tensors(val)
n_tr, n_val = len(T['y']), len(V['y'])
games = len(np.unique(M['seed']))
print(f'{len(data)} positions from {games} games ({n_tr} train / {n_val} held out), Attacker wins {M["z"].mean():.3f}, '
      f'{len(u_names)} Pokémon + {len(g_names)} global features, on {DEV} [{time.time() - t0:.0f}s]', flush=True)

# ---------------------------------------------------------------- model


class Net(nn.Module):
    def __init__(s):
        super().__init__()
        h, p = args.h, args.hu2 or args.h
        s.emb = nn.Embedding(NC + 1, h, padding_idx=0)
        s.unit = nn.Linear(len(u_names), h)
        s.side = nn.Parameter(torch.zeros(2, h))
        s.unit2 = nn.Linear(h, args.hu2) if args.hu2 else None
        s.l1 = nn.Linear(4 * p + len(g_names), args.h2)
        s.l2 = nn.Linear(args.h2, args.h3)
        s.out = nn.Linear(args.h3, 2 + 5)                         # result, search value, 5 side targets
        s.dp = nn.Dropout(args.dropout)
        nn.init.normal_(s.emb.weight, std=0.1)
        with torch.no_grad():
            s.emb.weight[0].zero_()

    def forward(s, b):
        c = b['c']
        mask = (c > 0).unsqueeze(-1).float()                      # (n, 8, 1)
        side = s.side.repeat_interleave(4, 0).unsqueeze(0)        # (1, 8, h): Attacker slots then Defender
        z = F.relu(s.emb(c) + s.unit(b['x']) + side)
        if s.unit2 is not None:
            z = F.relu(s.unit2(z))
        z = z * mask
        a, d = z[:, :4], z[:, 4:]
        pooled = torch.cat([a.sum(1) / 4, a.max(1).values, d.sum(1) / 4, d.max(1).values], 1)
        hid = s.dp(F.relu(s.l1(torch.cat([pooled, b['g']], 1))))
        return s.out(s.dp(F.relu(s.l2(hid))))


def run(net, b, idx=None):
    if idx is not None:
        b = {k: v[idx] for k, v in b.items()}
    o = net(b)
    win = F.binary_cross_entropy_with_logits(o[:, 0], b['y'])
    aux = F.mse_loss(torch.sigmoid(o[:, 2:6]), b['aux'][:, :4]) + F.mse_loss(o[:, 6], b['aux'][:, 4])
    hs = b['has_sv']
    if hs.any():
        aux = aux + (args.search / max(args.aux, 1e-9)) * F.binary_cross_entropy_with_logits(o[hs, 1], b['sv'][hs]) * hs.float().mean()
    return win, aux, o[:, 0]


def evaluate(net, b):
    net.eval()
    with torch.no_grad():
        losses, outs = [], []
        for i in range(0, len(b['y']), 65536):
            idx = torch.arange(i, min(len(b['y']), i + 65536), device=DEV)
            win, _, o = run(net, b, idx)
            losses.append(win.item() * len(idx))
            outs.append(o)
    net.train()
    return sum(losses) / len(b['y']), torch.cat(outs)


def logistic(names):
    """Held-out log loss of a logistic fit on some global features (baselines; they need not be network inputs)."""
    cols = [meta['global'].index(n) for n in names]
    sd = np.maximum(G[tr][:, cols].std(0), 0.05)
    xt, xv = torch.tensor(G[tr][:, cols] / sd, device=DEV), torch.tensor(G[val][:, cols] / sd, device=DEV)
    lin = nn.Linear(len(cols), 1).to(DEV)
    opt = torch.optim.LBFGS(lin.parameters(), max_iter=200)

    def closure():
        opt.zero_grad()
        loss = F.binary_cross_entropy_with_logits(lin(xt)[:, 0], T['y'])
        loss.backward()
        return loss
    opt.step(closure)
    with torch.no_grad():
        return F.binary_cross_entropy_with_logits(lin(xv)[:, 0], V['y']).item(), lin(xv)[:, 0]


base = T['y'].mean().clamp(1e-6, 1 - 1e-6)
const_loss = F.binary_cross_entropy(base.expand(n_val), V['y']).item()
hand_loss, hand_out = logistic(['evalA', 'evalD', 'clockT', 'aToMove'])
glob_loss, _ = logistic(meta['global'])
print(f'held-out log loss: constant {const_loss:.4f} · hand evaluation (logistic) {hand_loss:.4f} · all global features (logistic) {glob_loss:.4f}', flush=True)

def evaluate_search(net, b):
    """Held-out loss of the search head against the search's value (where recorded)."""
    net.eval()
    with torch.no_grad():
        hs = b['has_sv']
        if not hs.any():
            return float('nan'), None
        outs = torch.cat([net({k: v[i:i + 65536] for k, v in b.items()})[:, 1] for i in range(0, len(b['y']), 65536)])
    net.train()
    return F.binary_cross_entropy_with_logits(outs[hs], b['sv'][hs]).item(), outs


def train_one(seed):
    torch.manual_seed(seed)
    net = Net().to(DEV)
    opt = torch.optim.AdamW(net.parameters(), lr=args.lr, weight_decay=args.wd)
    steps = args.epochs * ((n_tr + args.batch - 1) // args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=steps, pct_start=0.1)
    best = (1e9, None, 0)
    for ep in range(1, args.epochs + 1):
        perm = torch.randperm(n_tr, device=DEV)
        tot = 0.0
        for i in range(0, n_tr, args.batch):
            idx = perm[i:i + args.batch]
            win, aux, _ = run(net, T, idx)
            opt.zero_grad()
            (win + args.aux * aux).backward()
            opt.step()
            sched.step()
            tot += win.item() * len(idx)
        vl, _ = evaluate(net, V)
        if vl < best[0]:
            best = (vl, {k: v.detach().clone() for k, v in net.state_dict().items()}, ep)
        if not args.quiet:
            print(f'epoch {ep}: train {tot / n_tr:.4f} · held out {vl:.4f}{" *" if best[2] == ep else ""}', flush=True)
    net.load_state_dict(best[1])
    vl, out = evaluate(net, V)
    sl, sout = evaluate_search(net, V)
    print(f'network (seed {seed}): held-out log loss {vl:.4f} at epoch {best[2]}, search head {sl:.4f} [{time.time() - t0:.0f}s]', flush=True)
    return net, out, sout


def folded(net):
    """A trained network as arrays (see "model files" above), with the input normalisation folded into the weights."""
    sd = {k: v.double().cpu().numpy() for k, v in net.state_dict().items()}
    p = args.hu2 or args.h
    wu = sd['unit.weight'] / u_sd[None, :]                       # (h, features)
    w1 = sd['l1.weight'].copy()                                   # (h2, 4p + position features)
    w1[:, 4 * p:] /= g_sd[None, :]
    return dict(
        emb=sd['emb.weight'][1:], wu=wu.T, bu=sd['unit.bias'] - (wu * u_mu[None, :]).sum(1), bs=sd['side'],
        wu2=sd['unit2.weight'].T if args.hu2 else None, bu2=sd['unit2.bias'] if args.hu2 else None,
        w1=w1.T, b1=sd['l1.bias'] - (w1[:, 4 * p:] * g_mu[None, :]).sum(1), w2=sd['l2.weight'].T, b2=sd['l2.bias'],
        w3=sd['out.weight'][0], b3=float(sd['out.bias'][0]))                 # the result head only


if OLD:
    weight_list, cards = OLD['nets'], OLD['cards']
else:
    nets, outs, souts = [], [], []
    for k in range(args.nets):
        net, out, sout = train_one(args.seed + k)
        nets.append(net)
        outs.append(out)
        souts.append(sout)
    out = torch.stack(outs).mean(0)
    if V['has_sv'].any():
        # How the two heads and the search's own value compare as predictors of the result.
        hs = V['has_sv']
        sv_loss = F.binary_cross_entropy(V['sv'][hs].clamp(1e-6, 1 - 1e-6), V['y'][hs]).item()
        sout = torch.stack(souts).mean(0)
        print(f'where the search value was recorded ({int(hs.sum())} held-out positions): log loss of the result from the search value itself {sv_loss:.4f}, '
              f'from the result head {F.binary_cross_entropy_with_logits(out[hs], V["y"][hs]).item():.4f}, '
              f'from the search head {F.binary_cross_entropy_with_logits(sout[hs], V["y"][hs]).item():.4f}')
    weight_list, cards = [folded(n) for n in nets], meta['cards']

# ---------------------------------------------------------------- the exported model, run as the game runs it

Wt = [{k: (None if v is None else torch.tensor(np.asarray(v), dtype=torch.float32, device=DEV)) for k, v in w.items()} for w in weight_list]
# Held-out positions with raw (unnormalised) features; card numbers point into the model's own card list (0 = none or unknown).
def card_numbers(names):
    to_model = np.array([0] + [names.index(c) + 1 if c in names else 0 for c in meta['cards']])
    return torch.tensor(to_model[card[val]], device=DEV)


Vc = card_numbers(cards)
Vx = torch.tensor(X[val][:, :, u_keep], device=DEV)
Vg = torch.tensor(G[val][:, g_keep], device=DEV)
side_of_slot = torch.tensor([0] * 4 + [1] * 4, device=DEV)


def model_logit(c, x, g):
    """Log-odds that the Attacker wins: the same arithmetic as src/ai/value.ts."""
    total = 0
    for w in Wt:
        emb = torch.cat([torch.zeros(1, w['emb'].shape[1], device=DEV), w['emb']])
        z = F.relu(emb[c] + x @ w['wu'] + w['bu'] + w['bs'][side_of_slot])
        if w['wu2'] is not None:
            z = F.relu(z @ w['wu2'] + w['bu2'])
        z = z * (x.abs().sum(-1, keepdim=True) > 0)               # empty slots (a real Pokémon always has some feature set)
        a, d = z[:, :4], z[:, 4:]
        hid = F.relu(torch.cat([a.sum(1) / 4, a.max(1).values, d.sum(1) / 4, d.max(1).values, g], 1) @ w['w1'] + w['b1'])
        total = total + F.relu(hid @ w['w2'] + w['b2']) @ w['w3'] + w['b3']
    return total / len(Wt)


with torch.no_grad():
    out_x = model_logit(Vc, Vx, Vg)
vl = F.binary_cross_entropy_with_logits(out_x, V['y']).item()
acc = ((out_x > 0).float() == V['y']).float().mean().item()
print(f'{"ensemble of " + str(len(Wt)) if len(Wt) > 1 else "network"}: held-out log loss {vl:.4f}, accuracy {acc:.3f} · h={args.h} hu2={args.hu2} '
      f'h2={args.h2} h3={args.h3}' + ('' if OLD else f' dropout={args.dropout} wd={args.wd} aux={args.aux} search={args.search} epochs={args.epochs}'), flush=True)
if not OLD:
    assert (out_x - out).abs().max().item() < 1e-2, 'the exported weights disagree with the trained network'
rounds = sorted(set(V['rnd'].tolist()))
line = []
for r in rounds:
    mk = V['rnd'] == r
    n = F.binary_cross_entropy_with_logits(out_x[mk], V['y'][mk]).item()
    hnd = F.binary_cross_entropy_with_logits(hand_out[mk], V['y'][mk]).item()
    line.append(f'r{int(r)} {n:.3f}/{hnd:.3f}')
print('by round, network/hand: ' + ' · '.join(line))

# ---------------------------------------------------------------- what it learned (a summary for readers of the file)


def summary(limit=20000):
    """How the output moves when one input is changed on held-out positions, everything else left as it was."""
    c, x, g = Vc[:limit], Vx[:limit], Vg[:limit]
    gen = torch.Generator(device='cpu').manual_seed(0)
    present = c > 0
    with torch.no_grad():
        base = model_logit(c, x, g)
        # One random Pokémon of each side per position.
        pick = {}
        for si, sl in ((0, slice(0, 4)), (1, slice(4, 8))):
            w = present[:, sl].float() + 1e-9
            k = torch.multinomial(w.cpu(), 1, generator=gen).to(DEV)[:, 0] + sl.start
            pick[si] = (k, present[torch.arange(len(c), device=DEV), k])
        rows = torch.arange(len(c), device=DEV)
        feats = {}
        for j, name in enumerate(u_names):
            col = x[:, :, j][present]
            flag = bool(((col == 0) | (col == 1)).all())
            step = 1.0 if flag else float(col.std())
            e = {}
            for si, key in ((0, 'attacker'), (1, 'defender')):
                k, ok = pick[si]
                ok = ok & (x[rows, k, j] == 0) if flag else ok
                if ok.sum() < 50:
                    e[key] = 0.0
                    continue
                x2 = x.clone()
                x2[rows[ok], k[ok], j] += step
                d = (model_logit(c[ok], x2[ok], g[ok]) - base[ok]).mean().item()
                e[key] = round(d if si == 0 else -d, 3)          # higher = better for the side whose Pokémon it is
            feats[name] = {**e, 'step': 'on' if flag else round(step, 3)}
        pos = {}
        for j, name in enumerate(g_names):
            col = g[:, j]
            flag = bool(((col == 0) | (col == 1)).all())
            step = 1.0 if flag else float(col.std())
            ok = (col == 0) if flag else torch.ones_like(col, dtype=torch.bool)
            if ok.sum() < 50 or step == 0:
                continue
            g2 = g.clone()
            g2[ok, j] += step
            pos[name] = {'attackerEdge': round((model_logit(c[ok], x[ok], g2[ok]) - base[ok]).mean().item(), 3), 'step': 'on' if flag else round(step, 3)}
        cardv = {}
        for ci, name in enumerate(cards):
            e = {}
            for si, key, sl in ((0, 'attacker', slice(0, 4)), (1, 'defender', slice(4, 8))):
                has = (c[:, sl] == ci + 1)
                ok = has.any(1)
                if ok.sum() < 30:
                    continue
                c2 = c.clone()
                c2[:, sl][has] = 0                                # the same Pokémon without its card vector
                d = (base[ok] - model_logit(c2[ok], x[ok], g[ok])).mean().item()
                e[key] = round(d if si == 0 else -d, 3)
            if len(e) == 2:
                cardv[name] = e
    size = lambda e: -sum(abs(v) for v in e.values() if not isinstance(v, str))  # noqa: E731
    return {
        'pokemonFeatures': dict(sorted(feats.items(), key=lambda kv: size({k: v for k, v in kv[1].items() if k != 'step'}))),
        'positionFeatures': dict(sorted(pos.items(), key=lambda kv: -abs(kv[1]['attackerEdge']))),
        'cardVectors': dict(sorted(cardv.items(), key=lambda kv: -(kv[1]['attacker'] + kv[1]['defender']))),
    }


# ---------------------------------------------------------------- writing the file (laid out for people to read)

ABOUT = [
    'Value network of the Hard bot: from a battle position, the chance that the Attacker wins. Written by scripts/train_value.py:',
    '  retrain rather than edit (docs/ai-training.md). The bot uses it during battles; drafting uses general.json instead.',
    'Unlike general.json this is a neural network: no single weight means anything on its own. For a reader, "whatItLearned" below',
    '  is the useful part; the weights after it are listed in the order the numbers flow through the network, one named row per line.',
    'How a position is scored (src/ai/value.ts), for each of the networks, whose results are averaged:',
    '  1. every live Pokémon gets a vector: cardVectors[its card] + Σ its feature values × pokemonFeatureWeights + pokemonBias + sideBias,',
    '     negatives set to 0 (then through pokemonLayer2 the same way, if present);',
    '  2. each team is pooled: the sum of its Pokémon vectors ÷ 4, and their maximum, so the order of the Pokémon does not matter;',
    '  3. hidden1 = those four pooled vectors and the position features (round, map traits, trainers…) × their rows + bias, negatives to 0;',
    '  4. hidden2 the same from hidden1; output = hidden2 × output.weights + bias = log-odds that the Attacker wins.',
    'The features are computed by positionFeatures in src/ai/bot.ts. A row lists one input\'s weights to every unit of the next layer.',
    'whatItLearned: how the output moves, on average over held-out positions, when one input alone is changed. A rough guide: it',
    '  shows what the network associates with winning, not cause and effect, and real inputs move together (a few signs look odd for',
    '  that reason). All in log-odds; near an even game +0.10 is about +2.5 points of win chance.',
    '  pokemonFeatures: one Pokémon\'s feature goes up by "step" (its typical spread; "on" = a yes/no feature switched on). In each',
    '    attacker/defender pair, higher = better for the side whose Pokémon it is. Strongest effects first.',
    '  positionFeatures: the same for a feature of the whole position; attackerEdge > 0 favours the Attacker.',
    '  cardVectors: what a card\'s own vector adds beyond what its stats, types and matchups already say (higher = better for its side).',
    'Within each network, cards are in alphabetical order and features in the order the bot computes them.',
]


def num(v, d=5):
    s = f'{v:.{d}f}'
    return s if s.startswith('-') else ' ' + s


def render(v, ind=''):
    """JSON with every list of numbers, and every small record, on one line; tables get their keys lined up."""
    def inline(x):
        if isinstance(x, bool) or x is None or isinstance(x, str):
            return json.dumps(x, ensure_ascii=False)
        if isinstance(x, (int, np.integer)):
            return str(int(x))
        if isinstance(x, (float, np.floating)):
            return num(float(x), 4).strip() if abs(x) >= 100 else num(float(x))
        if isinstance(x, (list, np.ndarray)) and all(isinstance(e, (int, float, np.integer, np.floating)) for e in x):
            return '[' + ','.join(num(float(e)) for e in x) + ' ]'
        if isinstance(x, dict) and x and all(isinstance(e, (int, float, str)) for e in x.values()) and len(x) <= 4:
            return '{ ' + ', '.join(f'{json.dumps(k)}: {e if isinstance(e, int) else json.dumps(e) if isinstance(e, str) else num(e, 3)}' for k, e in x.items()) + ' }'
        return None
    one = inline(v)
    if one is not None:
        return one
    if len(v) == 0:
        return '[]' if isinstance(v, (list, np.ndarray)) else '{}'
    inner = ind + '  '
    if isinstance(v, (list, np.ndarray)):
        return '[\n' + ',\n'.join(inner + render(e, inner) for e in v) + '\n' + ind + ']'
    rows = [(json.dumps(k, ensure_ascii=False), render(e, inner)) for k, e in v.items()]
    width = max(len(k) for k, _ in rows) if all('\n' not in s for _, s in rows) else 0
    return '{\n' + ',\n'.join(f'{inner}{k}:{" " * max(1, width - len(k) + 1)}{s}' for k, s in rows) + '\n' + ind + '}'


if args.out:
    h, p = args.h, args.hu2 or args.h
    order = sorted(range(len(cards)), key=lambda i: cards[i])

    def network(w):
        r = lambda a: np.round(np.asarray(a, dtype=np.float64), 5)  # noqa: E731
        w1 = r(w['w1'])
        return {
            'cardVectors': {cards[i]: r(w['emb'][i]) for i in order},
            'pokemonFeatureWeights': {n: r(w['wu'][j]) for j, n in enumerate(u_names)},
            'pokemonBias': r(w['bu']),
            'sideBias': {'attacker': r(w['bs'][0]), 'defender': r(w['bs'][1])},
            **({'pokemonLayer2': {'weights': list(r(w['wu2'])), 'bias': r(w['bu2'])}} if w['wu2'] is not None else {}),
            'hidden1': {
                'attackerSum': list(w1[:p]), 'attackerMax': list(w1[p:2 * p]), 'defenderSum': list(w1[2 * p:3 * p]), 'defenderMax': list(w1[3 * p:4 * p]),
                'positionFeatures': {n: w1[4 * p + j] for j, n in enumerate(g_names)},
                'bias': r(w['b1']),
            },
            'hidden2': {'weights': list(r(w['w2'])), 'bias': r(w['b2'])},
            'output': {'weights': r(w['w3']), 'bias': round(float(w['b3']), 5)},
        }

    training = {
        'games': int(games), 'positions': int(len(data)), 'heldOutLogLoss': round(vl, 4), 'handEvalLogLoss': round(hand_loss, 4),
        'constantLogLoss': round(const_loss, 4), 'trained': time.strftime('%Y-%m-%d'),
    }
    if OLD:  # keep the record of the original training run, except what was just measured again
        kept = {k: v for k, v in OLD['training'].items() if k in ('games', 'positions', 'trained', 'data')}
        training = {**training, **kept}
    model = {
        'about': ABOUT,
        'version': 3,
        'training': training,
        'whatItLearned': summary(),
        'layers': {'pokemonVector': h, 'pokemonLayer2': args.hu2, 'hidden1': args.h2, 'hidden2': args.h3},
        'networks': [network(w) for w in weight_list],
    }
    text = render(model) + '\n'
    with open(args.out, 'w') as f:
        f.write(text)
    # A few held-out predictions of the file as written (weights rounded to 5 decimals), so the JavaScript
    # forward pass can be checked against this one.
    written = load_model(args.out)
    Wt = [{k: (None if v is None else torch.tensor(np.asarray(v), dtype=torch.float32, device=DEV)) for k, v in w.items()} for w in written['nets']]
    k = min(200, n_val)
    with torch.no_grad():
        again = model_logit(card_numbers(written['cards'])[:k], Vx[:k], Vg[:k])
    assert (again - out_x[:k]).abs().max().item() < 1e-2, 'the file as written disagrees with the model'
    json.dump({'meta': meta, 'rows': data[np.flatnonzero(val)[:k]].tolist(), 'logits': again.tolist()}, open(args.out + '.check.json', 'w'))
    print(f'wrote {args.out} ({os.path.getsize(args.out) / 1024:.0f} KB)')
