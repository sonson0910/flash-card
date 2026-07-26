export interface CardIdentityLike {
  id: string;
  word?: unknown;
  normalizedWord?: unknown;
  createdAt?: unknown;
  reviewHistory?: unknown;
  correctStreak?: unknown;
  difficulty?: unknown;
  bookmarked?: unknown;
}

export function normalizeCardWord(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
}

export function cardWordKey(card: CardIdentityLike): string {
  return normalizeCardWord(card.normalizedWord) || normalizeCardWord(card.word);
}

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

function stableWordHash(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(paddedLength - 4, bytes.length << 3);
  const state = [...SHA256_INITIAL];
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + (index * 4));
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_CONSTANTS[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      [h, g, f, e, d, c, b, a] = [g, f, e, (d + temporary1) >>> 0, c, b, a, (temporary1 + temporary2) >>> 0];
    }
    [a, b, c, d, e, f, g, h].forEach((value, index) => { state[index] = (state[index] + value) >>> 0; });
  }

  return state.map(value => value.toString(16).padStart(8, '0')).join('').slice(0, 24);
}

export function createWordCardId(word: string): string {
  const normalizedWord = normalizeCardWord(word);
  const legacySafeId = `word-${normalizedWord}`;
  if (/^[a-zA-Z0-9_-]+$/.test(normalizedWord) && legacySafeId.length <= 128) return legacySafeId;

  const slug = normalizedWord
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  const hash = stableWordHash(normalizedWord);
  return `word-${slug ? `${slug}-` : ''}${hash}`;
}

function reviewCount(card: CardIdentityLike): number {
  return Array.isArray(card.reviewHistory) ? card.reviewHistory.length : 0;
}

function learningScore(card: CardIdentityLike): number {
  const streak = typeof card.correctStreak === 'number' && Number.isFinite(card.correctStreak)
    ? Math.max(0, card.correctStreak)
    : 0;
  const rated = typeof card.difficulty === 'string'
    && card.difficulty !== ''
    && card.difficulty !== 'unrated'
    ? 1
    : 0;
  return (reviewCount(card) * 10_000)
    + (streak * 100)
    + (rated * 10)
    + (card.bookmarked === true ? 1 : 0);
}

export function preferCardWithLearningProgress<T extends CardIdentityLike>(left: T, right: T): T {
  const leftScore = learningScore(left);
  const rightScore = learningScore(right);
  if (leftScore !== rightScore) return rightScore > leftScore ? right : left;

  const leftCreatedAt = typeof left.createdAt === 'string' ? Date.parse(left.createdAt) : Number.NaN;
  const rightCreatedAt = typeof right.createdAt === 'string' ? Date.parse(right.createdAt) : Number.NaN;
  if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
    return rightCreatedAt < leftCreatedAt ? right : left;
  }
  return left;
}

export function dedupeCardsByNormalizedWord<T extends CardIdentityLike>(cards: readonly T[]): T[] {
  const cardsByWord = new Map<string, T>();
  const cardsWithoutWord: T[] = [];
  cards.forEach(card => {
    const key = cardWordKey(card);
    if (!key) {
      cardsWithoutWord.push(card);
      return;
    }
    const existing = cardsByWord.get(key);
    cardsByWord.set(key, existing ? preferCardWithLearningProgress(existing, card) : card);
  });
  return [...cardsByWord.values(), ...cardsWithoutWord];
}
