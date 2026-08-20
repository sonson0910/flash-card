/**
 * Syllable and stress analysis utility for SonFlash.
 * Accurately parses syllables from English words and IPA phonetics,
 * locating primary stress ('ˈ') and secondary stress ('ˌ').
 */

export interface SyllablePart {
  text: string;
  phoneticPart?: string;
  isPrimaryStress: boolean;
  isSecondaryStress: boolean;
}

export interface SyllableAnalysis {
  syllables: SyllablePart[];
  primaryStressIndex: number;
  hasMultipleSyllables: boolean;
}

/**
 * Standard English vowel cluster syllable splitting heuristic.
 */
function splitWordByVowelClusters(word: string): string[] {
  const clean = word.trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!clean || clean.length <= 3) return [word];

  const syllableRegex = /[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/gi;
  const matches = clean.match(syllableRegex);
  if (!matches || matches.length <= 1) return [word];

  // Re-map sliced parts back to original casing
  const parts: string[] = [];
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const len = matches[i].length;
    if (i === matches.length - 1) {
      parts.push(word.slice(cursor));
    } else {
      parts.push(word.slice(cursor, cursor + len));
      cursor += len;
    }
  }
  return parts.filter(p => p.length > 0);
}

/**
 * Parses phonetic and word into interactive syllable chunks with stress metadata.
 */
export function parseSyllables(word: string, phonetic?: string): SyllableAnalysis {
  const cleanWord = word.trim();
  if (!cleanWord) {
    return {
      syllables: [{ text: '', isPrimaryStress: false, isSecondaryStress: false }],
      primaryStressIndex: -1,
      hasMultipleSyllables: false,
    };
  }

  // 1. Check if IPA has explicit syllable dividers (. or space or stress markers)
  const cleanIpa = (phonetic || '').replace(/^\/|\/$/g, '').trim();

  if (cleanIpa && (cleanIpa.includes('.') || cleanIpa.includes('ˈ') || cleanIpa.includes('ˌ'))) {
    // Tokenize IPA by syllable boundaries
    const ipaRawTokens = cleanIpa.split(/(?=[.ˈˌ])|\./g).filter(Boolean);
    const ipaSyllables: { ipa: string; isPrimary: boolean; isSecondary: boolean }[] = [];

    let nextPrimary = false;
    let nextSecondary = false;

    for (const raw of ipaRawTokens) {
      const token = raw.trim();
      if (!token) continue;
      if (token === 'ˈ') {
        nextPrimary = true;
        continue;
      }
      if (token === 'ˌ') {
        nextSecondary = true;
        continue;
      }

      const isPrim = nextPrimary || token.startsWith('ˈ');
      const isSec = nextSecondary || token.startsWith('ˌ');
      const cleanToken = token.replace(/^[ˈˌ.]/, '');

      if (cleanToken) {
        ipaSyllables.push({
          ipa: cleanToken,
          isPrimary: isPrim,
          isSecondary: isSec,
        });
        nextPrimary = false;
        nextSecondary = false;
      }
    }

    if (ipaSyllables.length > 1) {
      // Divide English word proportionally across IPA syllables
      const wordSlices = splitWordByCount(cleanWord, ipaSyllables.length);
      const syllables: SyllablePart[] = ipaSyllables.map((item, idx) => ({
        text: wordSlices[idx] || item.ipa,
        phoneticPart: item.ipa,
        isPrimaryStress: item.isPrimary,
        isSecondaryStress: item.isSecondary,
      }));

      const primaryStressIndex = syllables.findIndex(s => s.isPrimaryStress);

      return {
        syllables,
        primaryStressIndex,
        hasMultipleSyllables: true,
      };
    }
  }

  // 2. Fallback to English rule-based syllable splitter
  const fallbackSlices = splitWordByVowelClusters(cleanWord);
  const syllables: SyllablePart[] = fallbackSlices.map((slice, idx) => ({
    text: slice,
    isPrimaryStress: idx === 0 && fallbackSlices.length > 1, // Default primary stress on 1st syllable for short words
    isSecondaryStress: false,
  }));

  return {
    syllables,
    primaryStressIndex: fallbackSlices.length > 1 ? 0 : -1,
    hasMultipleSyllables: syllables.length > 1,
  };
}

/**
 * Proportionally splits a word string into N syllable slices.
 */
function splitWordByCount(word: string, targetCount: number): string[] {
  if (targetCount <= 1) return [word];
  const charArray = Array.from(word);
  const roughLen = Math.max(1, Math.floor(charArray.length / targetCount));

  const slices: string[] = [];
  let cursor = 0;

  for (let i = 0; i < targetCount; i += 1) {
    if (i === targetCount - 1) {
      slices.push(charArray.slice(cursor).join(''));
    } else {
      const end = cursor + roughLen;
      slices.push(charArray.slice(cursor, end).join(''));
      cursor = end;
    }
  }

  return slices.filter(Boolean);
}
