import { describe, expect, it, vi } from 'vitest';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import { readCatalogWorkspaceQuery } from './catalogWorkspaceQuery';
import {
  inspectInstalledCatalog,
  navigateCatalogWorkspaceQuery,
} from './catalogWorkspaceOrchestration';
import type { CatalogWorkspaceService } from './catalogWorkspaceService';

const service = (overrides: Partial<CatalogWorkspaceService> = {}): CatalogWorkspaceService => ({
  inspect: vi.fn(async () => ({ status: 'current' as const, value: null })),
  summarize: vi.fn(async () => ({ status: 'current' as const, value: null })),
  download: vi.fn(), query: vi.fn(), hydrate: vi.fn(), invalidate: vi.fn(),
  ...overrides,
});

describe('catalog workspace orchestration', () => {
  it('inspects the offline cache first and treats progress sync failure as best-effort', async () => {
    const order: string[] = [];
    const summary = { release: { releaseId: 'offline-1' } } as CatalogWorkspaceSummary;
    const ports = service({
      inspect: async () => {
        order.push('inspect');
        return { status: 'current' as const, value: { catalogId: 'english-core', releaseId: 'offline-1' } as never };
      },
      summarize: async (_catalogId, states) => {
        order.push(`summarize:${states.size}`);
        return { status: 'current' as const, value: summary };
      },
    });

    await expect(inspectInstalledCatalog({
      service: ports,
      catalogId: 'english-core',
      loadLearningStates: async () => {
        order.push('progress');
        throw new Error('offline');
      },
    })).resolves.toEqual({ status: 'ready', summary });
    expect(order).toEqual(['inspect', 'progress', 'summarize:0']);
  });

  it('invalidates every in-flight browse channel before changing URL state', () => {
    const order: string[] = [];
    const current = readCatalogWorkspaceQuery('/?view=catalog&utm=kept');
    const ports = service({ invalidate: () => { order.push('invalidate'); } });

    const next = navigateCatalogWorkspaceQuery({
      service: ports,
      current,
      patch: { term: 'learn' },
      currentLocation: '/?view=catalog&utm=kept#paths',
      navigate: location => { order.push(`navigate:${location}`); },
    });

    expect(order[0]).toBe('invalidate');
    expect(order[1]).toContain('utm=kept');
    expect(order[1]).toContain('term=learn');
    expect(order[1]).toContain('#paths');
    expect(next.term).toBe('learn');
  });

  it('does not start a summary when a language switch supersedes deferred progress', async () => {
    let resolveProgress!: (value: null) => void;
    const progress = new Promise<null>(resolve => { resolveProgress = resolve; });
    let current = true;
    const summarize = vi.fn();
    const ports = service({
      inspect: async () => ({
        status: 'current' as const,
        value: { catalogId: 'english-core', releaseId: 'offline-1' } as never,
      }),
      summarize,
    });
    const pending = inspectInstalledCatalog({
      service: ports,
      catalogId: 'english-core',
      loadLearningStates: () => progress,
      isCurrent: () => current,
    });

    current = false;
    resolveProgress(null);

    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(summarize).not.toHaveBeenCalled();
  });
});
