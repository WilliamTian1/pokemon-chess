#!/bin/bash
# Retrains the Hard bot's two learned models from self-play (see docs/ai-training.md):
#
#   scripts/train-ai.sh [games per generation, default 24000] [work folder, default .train/run]
#
#   1. Generation 1: the Hard bot (fast search settings, hand evaluation) plays itself with random teams on
#      Flower Meadow, Winding River and generated maps, in every mode. CPU only; about 2.5 h per 24,000 games
#      on 28 threads.
#   2. A first value network is fitted to those positions on the GPU (a minute or two).
#   3. Generation 2: the same again, but the bot scores its lines with that network, so the positions the
#      network is wrong about get visited and corrected.
#   4. The final value network (src/ai/models/value.json) is fitted to both generations, and the draft
#      model (src/ai/models/general.json) to every game's teams and result.
#
# Needs: node, and PyTorch in .venv (python3 -m venv --without-pip .venv && pip --python .venv/bin/python
# install torch numpy; the default Linux build uses an NVIDIA GPU if there is one). Re-running continues where
# it stopped (finished chunks are kept). Check the result with scripts/arena.ts --swap against a copy of the
# old bot before committing the new models.
set -euo pipefail
cd "$(dirname "$0")/.."
GAMES=${1:-24000}
RUN=${2:-.train/run}
THREADS=${THREADS:-$(( $(nproc) - 4 ))}
PY=${PY:-.venv/bin/python}
MODELS=$(realpath "${MODELS:-src/ai/models}")   # where the two finished models go
CHUNK=${CHUNK:-4000}
LITE='"beam":3,"perUnit":2,"replies":3'
maps=(proc meadow proc river)
mkdir -p "$RUN/gen1" "$RUN/gen2"

# Self-play in chunks of 4000 games: $1 = folder, $2 = first seed, $3… = extra arena arguments.
generate() {
  local dir=$1 seed=$2; shift 2
  for i in $(seq 0 $(( GAMES / CHUNK - 1 ))); do
    [ -f "$dir/games-$i.done" ] && continue
    npx tsx scripts/arena.ts --a hard --d hard --draft teams --map "${maps[$(( i % 4 ))]}" --legends mix --trainers mix \
      --games $CHUNK --seed $(( seed + i * CHUNK )) --threads "$THREADS" --explore 0.2 --random-placement 0.25 \
      --states "$dir/states-$i.jsonl" --out "$dir/games-$i.jsonl" "$@" | tail -3
    touch "$dir/games-$i.done"
  done
  npx tsx scripts/featurize.ts "$dir"/states-*.jsonl --threads $(( THREADS / 2 ))
}

echo "== generation 1: self-play with the hand evaluation"
generate "$RUN/gen1" 1000000 --value none --tune "{\"search\":{$LITE}}"
echo "== first value network"
$PY scripts/train_value.py "$RUN/gen1" --quiet --out "$RUN/value-1.json"
echo "== generation 2: self-play guided by that network"
generate "$RUN/gen2" 2000000 --value "$RUN/value-1.json" --tune "{\"search\":{$LITE,\"net\":1,\"netPre\":0,\"netReplies\":0}}"
echo "== final value network"
$PY scripts/train_value.py "$RUN/gen1" "$RUN/gen2" --quiet --out "$MODELS/value.json"
rm -f "$MODELS/value.json.check.json"
echo "== draft model"
npx tsx scripts/train-draft-general.ts "$RUN"/gen*/games-*.jsonl --export "$RUN/rows.json"
$PY scripts/train_general.py "$RUN/rows.json" "$RUN/weights.json"
npx tsx scripts/train-draft-general.ts "$RUN"/gen*/games-*.jsonl --weights "$RUN/weights.json" --out "$MODELS/general.json"
echo "done: $MODELS/value.json and $MODELS/general.json"
