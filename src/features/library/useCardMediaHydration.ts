import { useEffect, useRef, useSyncExternalStore } from 'react';
import { mapWithConcurrency } from '../../lib/asyncPool';
import type { CardData } from '../../types/card';

export interface CardMediaHydrationPort {
  hasMedia(card: CardData): boolean;
  fetchMedia(card: CardData): Promise<CardMediaUpdate | null>;
  previewCard?(
    cardId: string,
    fields: CardMediaUpdate,
    options: { source: CardData; expectedLifecycle: string },
  ): void;
  updateCard(
    cardId: string,
    fields: CardMediaUpdate,
    options: { source: CardData; expectedLifecycle: string },
  ): Promise<void>;
}

export type CardMediaUpdate = Partial<Pick<
  CardData,
  'audioUrl' | 'imageUrl' | 'imageSearchQuery'
>>;

export interface CardMediaHydrationSnapshot {
  pendingCount: number;
  isHydrating: boolean;
}

export interface CardMediaHydrationActions {
  hydrateCard(
    card: CardData,
    options?: { force?: boolean; allowInactive?: boolean },
  ): Promise<CardMediaUpdate | null>;
  invalidateCard(cardId: string): void;
  lifecycleToken(cardId: string): string;
  isLifecycleCurrent(cardId: string, token: string): boolean;
}

export interface CardMediaHydrationScope {
  ownerKey: string | null;
  cards: readonly CardData[];
  enabled: boolean;
}

export function createCardMediaHydrationController(
  port: CardMediaHydrationPort,
  concurrency = 3,
) {
  const attempted = new Set<string>();
  const inFlight = new Map<string, Promise<CardMediaUpdate | null>>();
  const cardLifecycles = new Map<string, number>();
  const listeners = new Set<() => void>();
  let scope: CardMediaHydrationScope = { ownerKey: null, cards: [], enabled: false };
  let activeCards = new Map<string, CardData>();
  let ownerGeneration = 0;
  let pendingCount = 0;
  let disposed = false;

  const snapshot = (): CardMediaHydrationSnapshot => ({
    pendingCount,
    isHydrating: pendingCount > 0,
  });
  let currentSnapshot = snapshot();
  const publishPending = (nextPending: number) => {
    pendingCount = Math.max(0, nextPending);
    currentSnapshot = snapshot();
    listeners.forEach(listener => listener());
  };
  const lifecycleToken = (cardId: string) =>
    `${ownerGeneration}:${cardLifecycles.get(cardId) ?? 0}`;
  const isLifecycleCurrent = (cardId: string, token: string) =>
    !disposed && scope.enabled && lifecycleToken(cardId) === token;

  const replace = (nextScope: CardMediaHydrationScope) => {
    if (nextScope.ownerKey !== scope.ownerKey) ownerGeneration += 1;
    scope = nextScope;
    activeCards = new Map(nextScope.cards.map(card => [card.id, card]));
  };

  const hydrateCard: CardMediaHydrationActions['hydrateCard'] = async (card, options) => {
    const allowInactive = options?.allowInactive === true;
    if (disposed || !scope.enabled || (!allowInactive && !activeCards.has(card.id))) return null;
    if (port.hasMedia(card)) return null;
    const operationKey = `${scope.ownerKey ?? 'guest'}:${card.id}`;
    const existingRequest = inFlight.get(operationKey);
    if (existingRequest) {
      try {
        const existingResult = await existingRequest;
        if (existingResult || !options?.force) return existingResult;
      } catch (error) {
        if (!options?.force) throw error;
      }
    }
    if (!options?.force && attempted.has(operationKey)) return null;
    const ownerKey = scope.ownerKey;
    const generation = ownerGeneration;
    const token = lifecycleToken(card.id);
    const canPersist = () => !disposed
      && scope.enabled
      && scope.ownerKey === ownerKey
      && ownerGeneration === generation
      && (allowInactive || activeCards.has(card.id))
      && lifecycleToken(card.id) === token;
    attempted.add(operationKey);
    publishPending(pendingCount + 1);
    const request = (async () => {
      try {
        const fields = await port.fetchMedia(card);
        if (!fields) return null;
        if (!canPersist()) {
          attempted.delete(operationKey);
          return null;
        }
        const updateOptions = {
          source: card,
          expectedLifecycle: token,
        };
        await port.updateCard(card.id, fields, updateOptions);
        if (canPersist()) port.previewCard?.(card.id, fields, updateOptions);
        return fields;
      } catch (error) {
        attempted.delete(operationKey);
        throw error;
      }
    })();
    inFlight.set(operationKey, request);
    try {
      return await request;
    } finally {
      if (inFlight.get(operationKey) === request) inFlight.delete(operationKey);
      publishPending(pendingCount - 1);
    }
  };

  const actions: CardMediaHydrationActions = {
    hydrateCard,
    invalidateCard: cardId => {
      cardLifecycles.set(cardId, (cardLifecycles.get(cardId) ?? 0) + 1);
      const operationKey = `${scope.ownerKey ?? 'guest'}:${cardId}`;
      attempted.delete(operationKey);
      inFlight.delete(operationKey);
    },
    lifecycleToken,
    isLifecycleCurrent,
  };

  return {
    replace,
    hydrateLibrary: async () => {
      if (disposed || !scope.enabled) return;
      const candidates = scope.cards.filter(card => !port.hasMedia(card));
      await mapWithConcurrency([...candidates], concurrency, card => hydrateCard(card));
    },
    getSnapshot: () => currentSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions,
    dispose() {
      if (disposed) return;
      disposed = true;
      ownerGeneration += 1;
      activeCards.clear();
      listeners.clear();
    },
  };
}

export interface UseCardMediaHydrationOptions extends CardMediaHydrationScope {
  port: CardMediaHydrationPort;
  concurrency?: number;
}

export function useCardMediaHydration({
  ownerKey,
  cards,
  enabled,
  port,
  concurrency = 3,
}: UseCardMediaHydrationOptions): {
  model: CardMediaHydrationSnapshot;
  actions: CardMediaHydrationActions;
} {
  const latestPortRef = useRef(port);
  latestPortRef.current = port;
  const controllerRef = useRef<ReturnType<typeof createCardMediaHydrationController> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createCardMediaHydrationController({
      hasMedia: card => latestPortRef.current.hasMedia(card),
      fetchMedia: card => latestPortRef.current.fetchMedia(card),
      previewCard: (cardId, fields, options) => latestPortRef.current.previewCard?.(cardId, fields, options),
      updateCard: (cardId, fields, options) => latestPortRef.current.updateCard(cardId, fields, options),
    }, concurrency);
  }
  const controller = controllerRef.current;
  controller.replace({ ownerKey, cards, enabled });
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.hydrateLibrary();
  }, [cards, controller, enabled, ownerKey]);
  useEffect(() => () => controller.dispose(), [controller]);

  return { model, actions: controller.actions };
}
