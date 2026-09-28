import { describe, expect, it, vi } from 'vitest';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import { readCatalogWorkspaceQuery } from './catalogWorkspaceQuery';
import {
  inspectInstalledCatalog,
  navigateCatalogWorkspaceQuery,
  synchronizeCatalogHistoryInspection,
} from './catalogWorkspaceOrchestration';
import {
  createCatalogWorkspaceRequestGuard,
  type CatalogWorkspaceService,
} from './catalogWorkspaceService';

const service = (overrides: Partial<CatalogWorkspaceService> = {}): CatalogWorkspaceService => ({
  inspect: vi.fn(async () => ({ status: 'current' as const, value: null })),
  summarize: vi.fn(async () => ({ status: 'current' as const, value: null })),
  download: vi.fn(), readPage: vi.fn(), readUnit: vi.fn(), invalidate: vi.fn(),
  ...overrides,
});

describe('catalog workspace orchestration', () => {
  it('inspects the offline cache first and treats the one V2 progress query as best-effort', async () => {
    const order: string[] = [];
    const summary = { release: { releaseId: 'offline-1' } } as CatalogWorkspaceSummary;
    const ports = service({
      inspect: async () => {
        order.push('inspect');
        return { status: 'current' as const, value: { catalogId: 'english-core', releaseId: 'offline-1', schemaVersion: 2 } as never };
      },
      summarize: async (_catalogId, states) => {
        order.push(`summarize:${states.size}`);
        return { status: 'current' as const, value: summary };
      },
    });

    await expect(inspectInstalledCatalog({
      service: ports,
      catalogId: 'english-core',
      releaseId: 'offline-1',
      loadProgress: async () => {
        order.push('progress');
        throw new Error('offline');
      },
    })).resolves.toEqual({ status: 'ready', summary, progressAvailable: false });
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
    let resolveProgress!: (value: ReadonlyMap<string, 'started' | 'mastered'>) => void;
    const progress = new Promise<ReadonlyMap<string, 'started' | 'mastered'>>(resolve => { resolveProgress = resolve; });
    let current = true;
    const summarize = vi.fn();
    const ports = service({
      inspect: async () => ({
        status: 'current' as const,
        value: { catalogId: 'english-core', releaseId: 'offline-1', schemaVersion: 2 } as never,
      }),
      summarize,
    });
    const pending = inspectInstalledCatalog({
      service: ports,
      catalogId: 'english-core',
      releaseId: 'offline-1',
      loadProgress: () => progress,
      isCurrent: () => current,
    });

    current = false;
    resolveProgress(new Map());

    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('keeps a deferred same-release inspection current during filter-only history restoration', async () => {
    let resolveInspection!: () => void;
    const inspectionFinished = new Promise<void>(resolve => { resolveInspection = resolve; });
    const guard = createCatalogWorkspaceRequestGuard();
    const token = guard.begin('inspect');
    const pendingInspection = inspectionFinished.then(() => (
      guard.isCurrent(token) ? 'ready' : 'stale'
    ));
    const ports = service({ invalidate: () => guard.invalidate() });
    const current = {
      ...readCatalogWorkspaceQuery('/?view=catalog&term=before'),
      catalogId: 'english-core',
      releaseId: 'release-1',
    };
    const restored = {
      ...readCatalogWorkspaceQuery('/?view=catalog&term=after'),
      catalogId: 'english-core',
      releaseId: 'release-1',
    };

    const invalidated = synchronizeCatalogHistoryInspection({
      service: ports,
      current,
      restored,
    });
    resolveInspection();

    expect(invalidated).toBe(false);
    await expect(pendingInspection).resolves.toBe('ready');
  });

  it('does not open an installed release that differs from the registry-approved release', async () => {
    const summarize = vi.fn();
    const ports = service({
      inspect: async () => ({
        status: 'current' as const,
        value: { catalogId: 'english-core', releaseId: 'different-release' } as never,
      }),
      summarize,
    });

    await expect(inspectInstalledCatalog({
      service: ports,
      catalogId: 'english-core',
      releaseId: 'approved-release',
      loadProgress: async () => new Map(),
    })).resolves.toEqual({ status: 'missing' });
    expect(summarize).not.toHaveBeenCalled();
  });

  it('does not query progress for V1 releases or without a verified progress loader', async () => {
    const loadProgress = vi.fn(async () => new Map<string, 'started' | 'mastered'>());
    const summarize = vi.fn(async () => ({ status: 'current' as const, value: { release: { releaseId: 'offline-1' } } as never }));
    const ports = service({
      inspect: async () => ({ status: 'current' as const, value: { catalogId: 'english-core', releaseId: 'offline-1', schemaVersion: 1 } as never }),
      summarize,
    });

    await inspectInstalledCatalog({ service: ports, catalogId: 'english-core', releaseId: 'offline-1', loadProgress });
    await inspectInstalledCatalog({
      service: service({
        inspect: async () => ({ status: 'current' as const, value: { catalogId: 'english-core', releaseId: 'offline-1', schemaVersion: 2 } as never }),
        summarize,
      }),
      catalogId: 'english-core', releaseId: 'offline-1',
    });

    expect(loadProgress).not.toHaveBeenCalled();
    expect(summarize).toHaveBeenCalledTimes(2);
  });

  it('marks a successful V2 projection read available even when it returns no documents', async () => {
    const summary = { release: { releaseId: 'offline-1' } } as CatalogWorkspaceSummary;
    await expect(inspectInstalledCatalog({
      service: service({
        inspect: async () => ({ status: 'current' as const, value: { catalogId: 'english-core', releaseId: 'offline-1', schemaVersion: 2 } as never }),
        summarize: async () => ({ status: 'current' as const, value: summary }),
      }),
      catalogId: 'english-core', releaseId: 'offline-1', loadProgress: async () => new Map(),
    })).resolves.toEqual({ status: 'ready', summary, progressAvailable: true });
  });
});
