/**
 * Kana helpers for the Japanese card face: Hepburn romanization and mora splitting of a kana
 * reading. Deterministic tables only; text that is not kana passes through unchanged.
 */

const SMALL_KANA = new Set(['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ', 'ゃ', 'ゅ', 'ょ', 'ゎ', 'ゕ', 'ゖ']);

const KANA: Readonly<Record<string, string>> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n', ゔ: 'vu',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o', ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ゕ: 'ka', ゖ: 'ke',
};

/** Katakana to hiragana, so one table serves both scripts. */
export function toHiragana(value: string): string {
  return Array.from(value.normalize('NFC'), character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x30a1 && codePoint <= 0x30f6 ? String.fromCodePoint(codePoint - 0x60) : character;
  }).join('');
}

/** Combines a kana with the small kana after it ("きゃ", "ふぁ", "てぃ"). */
function combine(base: string, small: string): string {
  const glide = KANA[small];
  if (small === 'ゃ' || small === 'ゅ' || small === 'ょ') {
    if (base.endsWith('hi') && (base === 'shi' || base === 'chi')) return base.slice(0, -1) + glide.slice(1);
    if (base === 'ji') return 'j' + glide.slice(1);
    return base.slice(0, -1) + glide;
  }
  if (base === 'te' || base === 'de') return base[0] + glide;
  if (base === 'u') return 'w' + glide;
  if (base === 'shi' || base === 'chi' || base === 'ji') return base.slice(0, -1) + glide;
  if (base.endsWith('u')) return base.slice(0, -1) + glide;
  return base + glide;
}

/** Hepburn romanization of a kana reading, e.g. "けいけん" → "keiken", "にっぽん" → "nippon". */
export function romanizeKana(kana: string): string {
  const characters = Array.from(toHiragana(kana));
  const syllables: string[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const next = characters[index + 1];
    if (character === 'ー') {
      const previous = syllables.at(-1) ?? '';
      syllables.push(/[aeiou]$/u.test(previous) ? previous.slice(-1) : '');
      continue;
    }
    const base = KANA[character];
    if (base === undefined) {
      syllables.push(character);
      continue;
    }
    if (character !== 'っ' && next && SMALL_KANA.has(next) && !SMALL_KANA.has(character)) {
      syllables.push(combine(base, next));
      index += 1;
      continue;
    }
    syllables.push(base);
  }
  // Second pass: the sokuon doubles the next consonant and ん takes an apostrophe before a vowel or y.
  let result = '';
  for (let index = 0; index < syllables.length; index += 1) {
    const syllable = syllables[index];
    const following = syllables[index + 1] ?? '';
    if (syllable === 'っ') {
      result += following.startsWith('ch') ? 't' : /^[bcdfghjkmprstvwz]/u.test(following) ? following[0] : '';
      continue;
    }
    result += syllable === 'n' && /^[aeiouy]/u.test(following) ? "n'" : syllable;
  }
  return result;
}

/** Splits a kana reading into morae: small kana join the kana before them; っ, ん and ー stand alone. */
export function splitKanaMorae(kana: string): string[] {
  const morae: string[] = [];
  for (const character of Array.from(kana.normalize('NFC').trim())) {
    if (SMALL_KANA.has(toHiragana(character)) && morae.length > 0) morae[morae.length - 1] += character;
    else morae.push(character);
  }
  return morae;
}
