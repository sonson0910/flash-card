import type { CardData } from '../types/card';

/** Central speech locale until language packs provide card-specific voices. */
export function speechLocaleFor(_card: CardData): string {
  return 'en-US';
}
