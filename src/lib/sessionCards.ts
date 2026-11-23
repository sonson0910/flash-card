export function retainCardsForSession<T>(cards: T[], pageSize: number): T[] {
  return cards.slice(0, Math.max(0, pageSize));
}
