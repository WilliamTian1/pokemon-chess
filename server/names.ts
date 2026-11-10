/**
 * Keeps slurs out of names other players see (account usernames and guest names in rooms).
 * Names are compared after undoing the usual disguises: capitals, accents, digits and symbols
 * standing in for letters, separators, and stretched letters.
 */

/** Blocked wherever they appear inside a name. */
const ANYWHERE = [
  'nigg', 'nigga', 'niglet', 'negro', 'faggot', 'fagot', 'retard', 'tranny', 'trannie', 'kike', 'chink', 'wetback', 'beaner',
  'towelhead', 'raghead', 'sandnigg', 'gypo', 'shemale', 'hitler', 'nazi', 'kkk', 'whitepower', 'heilh', 'siegheil', 'rapist', 'pedo', 'paedo', 'cunt',
];
/** Short ones that sit inside ordinary words (raccoon, spice, Pakistan): blocked only as the whole name. */
const WHOLE = ['fag', 'fags', 'coon', 'coons', 'spic', 'spics', 'gook', 'gooks', 'paki', 'pakis', 'dyke', 'dykes', 'jap', 'japs', 'homo', 'homos', 'tard'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

/** Letters only, lower case, with stand-in characters turned back into the letters they imitate. */
function squash(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[0134578@$!|]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '');
}

/** A pattern for `word` that also matches it with any letter stretched ("nigg" → n+i+g{2,}). */
function stretchy(word: string, whole: boolean): RegExp {
  const body = word.replace(/(.)\1*/g, (run, c: string) => (run.length > 1 ? `${c}{${run.length},}` : `${c}+`));
  return new RegExp(whole ? `^${body}$` : body);
}

const PATTERNS = [...ANYWHERE.map((w) => stretchy(w, false)), ...WHOLE.map((w) => stretchy(w, true))];

/** Whether a name is free of slurs. */
export function cleanName(name: string): boolean {
  const s = squash(name);
  return !PATTERNS.some((re) => re.test(s));
}
