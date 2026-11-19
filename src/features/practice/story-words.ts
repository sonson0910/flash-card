import type { CardData } from '../../types/card';

/** A run of story text, either plain or one occurrence of a learner's card word. */
export interface StoryTextPart {
  readonly text: string;
  readonly cardId?: string;
}

/** Scripts written without spaces between words, where a word boundary cannot be detected. */
const UNSPACED_LANGUAGES = new Set(['ja', 'zh', 'th']);
const KOREAN = 'ko';
/** Regular English endings a story may add to a card word. */
const INFLECTION = "(?:'s|s|es|ed|d|ing|er|ers|est|ly)?";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The forms of a card word to look for. A Korean dictionary form ending in 다 is usually
 * conjugated in running text, so its stem is searched too: the noun of a 하다 verb (결심하다 →
 * 결심, which survives the 했 contraction), otherwise the form without 다. One-syllable stems
 * are left out because they would match common particles such as 가.
 */
function searchForms(word: string, language: string): string[] {
  const trimmed = word.normalize('NFC').trim();
  if (!trimmed) return [];
  if (language === KOREAN && trimmed.length > 2) {
    if (trimmed.endsWith('하다') && trimmed.length > 3) return [trimmed, trimmed.slice(0, -2)];
    if (trimmed.endsWith('다')) return [trimmed, trimmed.slice(0, -1)];
  }
  return [trimmed];
}

function patternFor(word: string, language: string): RegExp | null {
  const forms = searchForms(word, language);
  if (forms.length === 0) return null;
  const body = forms.map(form => escapeRegExp(form).replace(/\s+/g, '\\s+')).join('|');
  // Korean particles and unspaced scripts attach directly to the word, so any position matches.
  if (language === KOREAN || UNSPACED_LANGUAGES.has(language)) return new RegExp(`()(${body})`, 'giu');
  // Spaced scripts match the whole word with a regular ending ("adapt" → "adapted"), never a
  // longer word that only starts the same ("cat" in "category"). The leading group stands in
  // for a lookbehind, which older Safari releases cannot parse.
  return new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])((?:${body})${INFLECTION})(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
}

/**
 * Splits story text into plain runs and the places where the learner's own card
 * words appear, so each occurrence can be tapped for its meaning. When two
 * words overlap, the one that starts first (then the longer one) wins.
 */
export function storyTextParts(text: string, cards: readonly CardData[], language: string): StoryTextPart[] {
  const source = text.normalize('NFC');
  const matches: Array<{ start: number; end: number; cardId: string }> = [];
  for (const card of cards) {
    const pattern = patternFor(card.word, language);
    if (!pattern) continue;
    for (const match of source.matchAll(pattern)) {
      const [, lead = '', word = ''] = match;
      if (match.index === undefined || word.length === 0) continue;
      const start = match.index + lead.length;
      matches.push({ start, end: start + word.length, cardId: card.id });
    }
  }
  matches.sort((left, right) => left.start - right.start || (right.end - right.start) - (left.end - left.start));
  const parts: StoryTextPart[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    if (match.start > cursor) parts.push({ text: source.slice(cursor, match.start) });
    parts.push({ text: source.slice(match.start, match.end), cardId: match.cardId });
    cursor = match.end;
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor) });
  return parts;
}

/** Whole minutes a learner needs to read `text` at a steady pace, never less than one. */
export function storyReadMinutes(text: string, language: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 1;
  if (UNSPACED_LANGUAGES.has(language)) return Math.max(1, Math.round(Array.from(trimmed.replace(/\s+/g, '')).length / 300));
  return Math.max(1, Math.round(trimmed.split(/\s+/).length / 180));
}

/** Days until a card is next due: 0 when it is due now, null when it has no schedule. */
export function cardDueInDays(card: CardData, now = Date.now()): number | null {
  const due = card.nextReviewDate ?? card.fsrs?.due;
  if (!due) return null;
  const timestamp = new Date(due).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - now) / 86_400_000));
}
