Trainer voicelines: four short battle callouts per trainer, named <trainer>-1.wav through <trainer>-4.wav. One is chosen at random whenever that trainer's Special Move is
used; the list lives in VOICE_CLIPS in src/ui/audio.ts.

Chosen from the transcribed sets in "Pokemon Chess Voicelines/" (transcripts.tsv there):
  mitsuhide  offense-c "This should finish you!", support-c "Now is our chance!",
             kessen-atk "My blade shall run you through!", tactic-b "Witness the power of a true strategist!"
             (silence trimmed)
  nobunaga   offense-c "CRUSH THEM IN ONE BLOW!", offense-a "Feel my wrath!",
             tactic-d "Tremble before Nobunaga!", assault-a "Run them through!" (silence trimmed)
  n          0013 "Let's do this!", 0015 "Unleash your power!", 0027 "You can't stop me.", 0026 "TRUTH!"
  red        0014 "Tah!", 0017 "Hut!", 0026 "Huah!", 0025 "Huh!" (Red has no spoken lines)
  blue       0013 "Bring it!", 0016 "Get 'em!", 0072 "I'll show you!", 0071 "I'll teach you just how strong I am!"
  lance      0013 "Here we come!", 0023 "Now!", 0026 "Fight!", 0007 "You haven't seen my true strength yet."

All clips were then cleaned up by scripts/soundtrack/voices.py: resampled to 48 kHz, the missing top
octave regrown with a harmonic exciter (the Kessen III clips are 22 kHz PS2 audio), rumble cut, a light
presence lift and matched loudness. To redo it from the original picks, run the selection again and then
  python3 scripts/soundtrack/voices.py <picked clips dir> public/voices
