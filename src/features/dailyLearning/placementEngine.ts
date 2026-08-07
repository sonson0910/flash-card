import type { CardData } from '../../types/card';

export type PlacementTier = 'foundation' | 'core' | 'advanced';
export type PlacementConfidence = 'low' | 'medium' | 'high';

export interface PlacementItem {
  readonly card: CardData;
  readonly tier: PlacementTier;
}

export type PlacementCheck =
  | { readonly status: 'insufficient'; readonly eligibleCount: number; readonly requiredCount: 6 }
  | { readonly status: 'ready'; readonly items: readonly PlacementItem[] };

export type PlacementResult =
  | { readonly status: 'insufficient'; readonly answeredCount: number; readonly requiredCount: 6 }
  | {
      readonly status: 'complete';
      readonly recommendation: PlacementTier;
      readonly confidence: PlacementConfidence;
      readonly answeredCount: number;
      readonly correctCount: number;
    };

const tierFor = (value: string | undefined): PlacementTier | null => {
  const cefr = value?.trim().toLocaleUpperCase();
  if (cefr === 'A1' || cefr === 'A2') return 'foundation';
  if (cefr === 'B1' || cefr === 'B2') return 'core';
  if (cefr === 'C1' || cefr === 'C2') return 'advanced';
  return null;
};

const logicalIdentity = (card: CardData): string => (
  (card.normalizedWord || card.word).normalize('NFKC').trim().toLocaleLowerCase() || card.id
);

export function buildPlacementCheck(cards: readonly CardData[], maximum = 12): PlacementCheck {
  if (!Number.isSafeInteger(maximum) || maximum < 6 || maximum > 12) {
    throw new TypeError('Placement maximum must be an integer between 6 and 12.');
  }
  const unique = new Map<string, PlacementItem>();
  for (const card of [...cards].sort((left, right) => left.id.localeCompare(right.id))) {
    const tier = tierFor(card.cefrLevel);
    const identity = logicalIdentity(card);
    if (tier && !unique.has(identity)) unique.set(identity, { card, tier });
  }
  if (unique.size < 6) return { status: 'insufficient', eligibleCount: unique.size, requiredCount: 6 };

  const groups: Record<PlacementTier, PlacementItem[]> = { foundation: [], core: [], advanced: [] };
  for (const item of unique.values()) groups[item.tier].push(item);
  const items: PlacementItem[] = [];
  const tiers: readonly PlacementTier[] = ['foundation', 'core', 'advanced'];
  for (let offset = 0; items.length < maximum; offset += 1) {
    let added = false;
    for (const tier of tiers) {
      const item = groups[tier][offset];
      if (item && items.length < maximum) {
        items.push(item);
        added = true;
      }
    }
    if (!added) break;
  }
  return { status: 'ready', items };
}

const TIER_WEIGHT: Readonly<Record<PlacementTier, number>> = { foundation: 1, core: 2, advanced: 3 };
const TIER_ORDER: readonly PlacementTier[] = ['foundation', 'core', 'advanced'];

export function evaluatePlacement(
  check: Extract<PlacementCheck, { status: 'ready' }>,
  answers: Readonly<Record<string, boolean>>,
): PlacementResult {
  const answered = check.items.filter(item => typeof answers[item.card.id] === 'boolean');
  if (answered.length < 6) return { status: 'insufficient', answeredCount: answered.length, requiredCount: 6 };

  const possible = answered.reduce((sum, item) => sum + TIER_WEIGHT[item.tier], 0);
  const earned = answered.reduce((sum, item) => sum + (answers[item.card.id] ? TIER_WEIGHT[item.tier] : 0), 0);
  const ratio = possible > 0 ? earned / possible : 0;
  const proposed: PlacementTier = ratio >= 0.75 ? 'advanced' : ratio >= 0.45 ? 'core' : 'foundation';
  const evidenceTiers = new Set(answered.map(item => item.tier));
  const highestEvidence = Math.max(...[...evidenceTiers].map(tier => TIER_ORDER.indexOf(tier)));
  const recommendation = TIER_ORDER[Math.min(TIER_ORDER.indexOf(proposed), highestEvidence)];
  const confidence: PlacementConfidence = answered.length >= 10 && evidenceTiers.size === 3
    ? 'high'
    : answered.length >= 8 || evidenceTiers.size >= 2 ? 'medium' : 'low';
  return {
    status: 'complete',
    recommendation,
    confidence,
    answeredCount: answered.length,
    correctCount: answered.filter(item => answers[item.card.id]).length,
  };
}
