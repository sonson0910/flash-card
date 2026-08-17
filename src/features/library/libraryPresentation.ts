import { cardMatchesQuery, sortCardsByActivity, type CardQueryState } from '../../lib/cardQuery';
import { cardWordKey } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';

export function formatCardDate(dateValue?: string): string {
  if (!dateValue) return 'Older';
  const date = new Date(dateValue);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function dateLabelToQueryDate(label: string): string | null {
  if (label === 'All') return null;
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (calendarDate) {
    const [, yearValue, monthValue, dayValue] = calendarDate;
    const year = Number(yearValue);
    const month = Number(monthValue);
    const day = Number(dayValue);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day
      ? label
      : null;
  }
  const date = label === 'Today'
    ? new Date()
    : label === 'Yesterday'
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(label);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function groupCardsByDate<T extends { createdAt?: string }>(cards: T[]): Record<string, T[]> {
  return cards.reduce<Record<string, T[]>>((groups, card) => {
    const label = formatCardDate(card.createdAt);
    groups[label] = [...(groups[label] ?? []), card];
    return groups;
  }, {});
}

export function shouldResetLibraryPageAfterSync(
  operations: readonly { type: string }[],
): boolean {
  return operations.some(operation => operation.type !== 'patch');
}

export function getCategoryEmoji(category: string): string {
  const cat = category.toLowerCase().trim();
  if (cat === 'all') return '🗂️';
  if (cat.includes('food') || cat.includes('cook') || cat.includes('eat') || cat.includes('drink') || cat.includes('món ăn')) return '🍔';
  if (cat.includes('animal') || cat.includes('pet') || cat.includes('nature') || cat.includes('wild') || cat.includes('động vật')) return '🦁';
  if (cat.includes('travel') || cat.includes('place') || cat.includes('city') || cat.includes('country') || cat.includes('du lịch')) return '✈️';
  if (cat.includes('tech') || cat.includes('code') || cat.includes('computer') || cat.includes('science') || cat.includes('công nghệ')) return '💻';
  if (cat.includes('sport') || cat.includes('health') || cat.includes('fitness') || cat.includes('gym') || cat.includes('thể thao')) return '🏋️';
  if (cat.includes('academic') || cat.includes('study') || cat.includes('school') || cat.includes('book') || cat.includes('học tập')) return '📚';
  if (cat.includes('business') || cat.includes('work') || cat.includes('job') || cat.includes('money') || cat.includes('kinh doanh')) return '💼';
  if (cat.includes('art') || cat.includes('music') || cat.includes('design') || cat.includes('photo') || cat.includes('nghệ thuật')) return '🎨';
  if (cat.includes('verb') || cat.includes('action') || cat.includes('động từ')) return '⚡';
  if (cat.includes('noun') || cat.includes('object') || cat.includes('thing') || cat.includes('danh từ')) return '📦';
  if (cat.includes('adjective') || cat.includes('descri') || cat.includes('tính từ')) return '✨';
  if (cat.includes('people') || cat.includes('family') || cat.includes('con người')) return '👥';
  if (cat.includes('communication') || cat.includes('talk') || cat.includes('giao tiếp')) return '💬';
  return '🌱';
}

export function existingCardRevealState() {
  return {
    search: '',
    category: 'All',
    date: 'All',
    deck: 'All',
    difficulty: 'All',
    partOfSpeech: 'All',
    starred: false,
    page: 1,
  } as const;
}

export function promoteExistingCard<T extends { createdAt?: string }>(
  card: T,
  promotedAt = new Date().toISOString(),
) {
  const fields = {
    lastOpenedAt: promotedAt,
    sortTouchedAt: promotedAt,
  };
  return {
    card: { ...card, ...fields },
    fields,
  };
}

export function overlayRecentlyPromotedCards({
  pageCards,
  promotedCards,
  filters,
  page,
  pageSize,
}: {
  pageCards: readonly CardData[];
  promotedCards: readonly CardData[];
  filters: CardQueryState;
  page: number;
  pageSize: number;
}): CardData[] {
  if (page !== 1 || promotedCards.length === 0) return [...pageCards];
  const pageCardsByWord = new Map(pageCards.map(card => [cardWordKey(card), card]));
  const matchingPromotedCards = sortCardsByActivity(
    promotedCards
      .filter(card => cardMatchesQuery(card, filters))
      .map(card => {
        const pageCard = pageCardsByWord.get(cardWordKey(card));
        if (!pageCard) return card;
        return {
          ...pageCard,
          ...card,
          audioUrl: card.audioUrl || pageCard.audioUrl,
          imageUrl: card.imageUrl || pageCard.imageUrl,
          imageSearchQuery: card.imageSearchQuery || pageCard.imageSearchQuery,
        };
      }),
  );
  if (matchingPromotedCards.length === 0) return [...pageCards];
  const promotedKeys = new Set(matchingPromotedCards.map(cardWordKey));
  return [
    ...matchingPromotedCards,
    ...pageCards.filter(card => !promotedKeys.has(cardWordKey(card))),
  ].slice(0, Math.max(1, pageSize));
}
