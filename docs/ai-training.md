# The Hard bot's learned models, and how to retrain them

The Hard bot has two learned parts. Both are plain JSON files in `src/ai/models/`, laid out to be read by
people, and both are written by scripts: retrain rather than edit.

| | `general.json` | `value.json` |
|---|---|---|
| Used in | the draft (picks, Secret draft, Auction bids, trainer choice) | the battle |
| Answers | with these two teams on this map, who wins? | from this exact position, who wins? |
| Looks at | the cards, the map's traits, the trainers | every live Pokémon (card, HP, status, position, who can hit it, what it can hit, matchups), the round, the map's traits, the trainers |
| Kind of model | a table: card values that add up, with corrections per map trait, named map and trainer mode | a small neural network (three, averaged) |
| Code | `src/ai/draftModel.ts`, `draft.ts`, `styles.ts` | `src/ai/value.ts`, used by the search in `bot.ts` |
| Trainer | `scripts/train-draft-general.ts` + `scripts/train_general.py` | `scripts/featurize.ts` + `scripts/train_value.py` |

Medium and Easy use neither.

## How the battle search uses the value network

The Hard bot still builds its candidate turns with the hand-written evaluation (a beam search over whole
turns), and still checks each candidate against the opponent's best reply and its own follow-up turn. The
network does two things in that search (`SEARCH` in `src/ai/bot.ts`):

1. It picks which finished turns get the full check. The beam is twice as wide as before (`beamNet` 32),
   and the 16 turns that go on are the ones whose resulting position the network likes best (`netPre`).
2. It scores the final position of each line instead of the hand evaluation (`net`).

Most of the gain comes from the first: the network judges positions better than the hand evaluation, but
only helps much when it has a wide field of candidate turns to choose from.

## Retraining

One command does everything (about 5 hours on a 32-thread CPU for the default 24,000 games per
generation; the GPU part takes minutes):

```bash
python3 -m venv --without-pip .venv && pip --python .venv/bin/python install torch numpy   # once
scripts/train-ai.sh            # or: scripts/train-ai.sh 12000 .train/my-run
```

What it runs:

1. **Self-play, generation 1** (`scripts/arena.ts --draft teams --states … --explore 0.2 --random-placement 0.25`).
   The Hard bot plays itself with fast search settings and the hand evaluation: random teams (with and
   without a legendary), on Flower Meadow, Winding River and generated maps, with and without trainers.
   Every turn-start position is saved with the game's result. One turn in five it plays its 2nd–4th
   choice, and a quarter of the games start from random placements, so the positions vary. This is CPU
   work; a GPU cannot speed it up.
2. **Features** (`scripts/featurize.ts`): each saved position becomes a row of numbers.
3. **A first value network** (`scripts/train_value.py`, on the GPU).
4. **Self-play, generation 2**: the same, with the bot scoring its lines by that network, so positions
   the network leads the bot into are in the data too.
5. **The final value network** on both generations → `src/ai/models/value.json`.
6. **The draft model** on every game's teams and result → `src/ai/models/general.json`.

The saved positions are raw game states, so after changing the features in `positionFeatures`
(`src/ai/bot.ts`) only steps 2, 3 and 5 need to run again. `train_value.py --reexport old.json` rewrites an
existing model file in the current layout without retraining.

Keep the machine awake while it runs: Windows sleep suspends WSL and everything in it.

## Checking a new model before shipping it

Self-play against a frozen copy of the old bot, every seed played twice with the roles swapped:

```bash
git worktree add ../old-bot HEAD      # the bot to beat
npx tsx scripts/arena.ts --a hard --d other:hard --other ../old-bot/src/ai/bot.ts \
  --swap --games 300 --map proc --legends mix --trainers mix
```

600 games give about ±2 points, so differences under 4 points need more games. `--map meadow|river|proc`,
`--style secret|auction`, `--value file.json` (another network), `--value none` (hand evaluation only) and
`--tune '{"search":{…}}'` cover the rest.

## Results of the 2026-11-10 training run

Data: 40,000 self-play games (554,009 positions) for the value network; those games plus the 24,000
earlier ones for the draft model.

How well each evaluator predicts the result of held-out games (log loss, lower is better; a coin flip
weighted by the Attacker's win rate scores 0.679):

| Evaluator | Log loss |
|---|---|
| Hand evaluation (best logistic fit) | 0.452 |
| Value network | 0.323 |

New Hard against the shipped v1.5.1 Hard, bot drafts, legendaries and trainers on and off in rotation:

| Setting | Games | New Hard wins |
|---|---|---|
| Generated maps, classic draft | 1,200 | 56.1% |
| Flower Meadow, classic draft | 600 | 55.7% |
| Winding River, classic draft | 600 | 55.0% |
| Flower Meadow, Secret draft | 300 | 55.3% |
| Generated maps, Auction | 300 | 57.7% |
| **All** | **3,000** | **55.9%** (±0.9) |

Both bots drafted with the same draft model in these games, so this is the battle AI alone.

The draft model refitted on 64,000 games (held-out log loss 0.5411; the card values correlate 0.987 with
the earlier 24,000-game fit) against the earlier fit, same battle AI on both sides, generated maps:
54.2% over 600 games (±2).

Both together, exactly as shipped, against v1.5.1 Hard on generated maps: 59.3% over 600 games (±2).

Thinking time per turn on a desktop CPU (i9-14900K, one thread, 300 positions): mean 0.86 s → 0.99 s,
median 0.46 s → 0.54 s.

What was tried and did not help (so nobody repeats it):

- Scoring lines with the network while keeping the old, narrower candidate list: only +2 points.
- Letting the network choose the opponent's reply among its best four (`netReplies` 4) with a beam of 64:
  about +2 points more, not clearly separated from noise, at nearly twice the thinking time. Left off.
- Blending the network with the hand evaluation at the leaves, dropping the bot's follow-up turn, a wider
  opponent reply search, network-guided cuts inside the beam, network-scored placement: no gain.
- Bigger networks, more regularisation, mixing the search's own value into the training target: the same
  held-out loss, and no stronger in play.
- Pair terms in the draft model (counters between specific cards, same-team synergy): 0.5437 → 0.5412
  held-out log loss on 40,000 games, too little to matter in drafts. The draft model stays a readable table.
