/**
 * Presentation helpers for the library word card face: the cover tone and the
 * stressed syllable highlighted inside the headword.
 */

export type LibraryCoverTone = 'teal' | 'violet' | 'amber';

const COVER_TONES: readonly LibraryCoverTone[] = ['teal', 'violet', 'amber'];

/** Stable tone per category so every card of a category shares one cover colour. */
export function getLibraryCoverTone(key: string | null | undefined): LibraryCoverTone {
  const source = (key ?? '').trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return COVER_TONES[hash % COVER_TONES.length];
}

export interface StressedWordParts {
  before: string;
  stressed: string;
  after: string;
}

const IPA_VOWELS = /[aeiouyæɑɒɔəɚɛɜɝɪʊʌøœɐɘɵɤɯɨʉ]/;

/** Counts vowel nuclei in an IPA fragment; adjacent vowels (diphthongs) count once. */
function countIpaNuclei(fragment: string): number {
  let count = 0;
  let inVowel = false;
  for (const char of fragment) {
    if (char === 'ː' || char === 'ˑ' || char === '̃') continue;
    const isVowel = IPA_VOWELS.test(char);
    if (isVowel && !inVowel) count += 1;
    inVowel = isVowel;
  }
  return count;
}

const DIGRAPHS = new Set(['ch', 'sh', 'th', 'ph', 'wh', 'gh']);

/**
 * Orthographic syllables split at the consonants between vowel groups:
 * one consonant (or a digraph) starts the next syllable, "x", "ck" and "ng"
 * close the previous one, a longer cluster splits after its first letter,
 * and a final silent "e" folds back.
 */
function splitEnglishSyllables(word: string): string[] {
  const lower = word.toLowerCase();
  if (!/^[a-z]+$/.test(lower)) return [word];
  const isVowel = (index: number) => 'aeiouy'.includes(lower[index]) && !(lower[index] === 'y' && index === 0);
  const groups: Array<[number, number]> = [];
  for (let index = 0; index < lower.length; index += 1) {
    if (!isVowel(index)) continue;
    const start = index;
    while (index + 1 < lower.length && isVowel(index + 1)) index += 1;
    groups.push([start, index + 1]);
  }
  if (groups.length <= 1) return [word];
  const cuts: number[] = [];
  for (let group = 0; group < groups.length - 1; group += 1) {
    const clusterStart = groups[group][1];
    const cluster = lower.slice(clusterStart, groups[group + 1][0]);
    if (cluster === 'x') cuts.push(clusterStart + 1);
    else if (cluster.length === 1 || DIGRAPHS.has(cluster)) cuts.push(clusterStart);
    else if (cluster.startsWith('ck') || cluster.startsWith('ng')) cuts.push(clusterStart + 2);
    else cuts.push(clusterStart + 1);
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const cut of cuts) {
    if (cut <= cursor || cut >= word.length) continue;
    parts.push(word.slice(cursor, cut));
    cursor = cut;
  }
  parts.push(word.slice(cursor));
  const last = parts[parts.length - 1].toLowerCase();
  // "-ble" and "-tre" keep their own beat; "-rge", "-se" and similar do not.
  if (parts.length > 1 && /^[^aeiouy]*e$/.test(last) && !/^[^aeiouy]+[lr]e$/.test(last)) {
    parts.splice(parts.length - 2, 2, parts[parts.length - 2] + parts[parts.length - 1]);
  }
  return parts;
}

/**
 * Finds the syllable carrying primary stress in an English headword from its
 * IPA. Returns null whenever the IPA cannot place the stress reliably, so the
 * card never highlights a guessed syllable.
 */
export function splitStressedWord(word: string, phonetic?: string | null, language?: string | null): StressedWordParts | null {
  const headword = word.trim();
  const raw = (phonetic ?? '').replace(/^[/[]|[/\]]$/g, '').trim();
  // Some dictionaries write primary stress with an ASCII apostrophe.
  const ipa = raw.includes('ˈ') ? raw : raw.replace(/['’]/g, 'ˈ');
  if (!headword || !ipa) return null;
  if (language && !language.toLowerCase().startsWith('en')) return null;
  if (!/^[A-Za-z]+$/.test(headword)) return null;

  const syllables = splitEnglishSyllables(headword);
  const marker = ipa.indexOf('ˈ');
  if (marker < 0) {
    // Without a stress mark only a single-syllable word is unambiguous.
    return syllables.length === 1 && countIpaNuclei(ipa) === 1 ? { before: '', stressed: headword, after: '' } : null;
  }
  if (syllables.length === 1) return { before: '', stressed: headword, after: '' };
  const index = countIpaNuclei(ipa.slice(0, marker).replace(/ˌ/g, ''));
  if (index >= syllables.length) return null;
  return {
    before: syllables.slice(0, index).join(''),
    stressed: syllables[index],
    after: syllables.slice(index + 1).join(''),
  };
}
