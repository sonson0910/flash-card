import type { LearningStateV3 } from '../multilingual/schemaV3';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import {
  createCatalogWorkspaceLocation,
  patchCatalogWorkspaceQuery,
  type CatalogWorkspaceQuery,
  type CatalogWorkspaceQueryPatch,
} from './catalogWorkspaceQuery';
import type { CatalogWorkspaceService } from './catalogWorkspaceService';

export interface CatalogLearningStateLoadResult {
  readonly states: ReadonlyMap<string, LearningStateV3>;
  readonly rejected: number;
}

export type InstalledCatalogInspection =
  | { readonly status: 'stale' }
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly summary: CatalogWorkspaceSummary };

export async function inspectInstalledCatalog({
  service,
  catalogId,
  loadLearningStates,
  isCurrent = () => true,
}: {
  service: CatalogWorkspaceService;
  catalogId: string;
  loadLearningStates: () => Promise<CatalogLearningStateLoadResult | null>;
  isCurrent?: () => boolean;
}): Promise<InstalledCatalogInspection> {
  const release = await service.inspect(catalogId);
  if (release.status === 'stale' || !isCurrent()) return { status: 'stale' };
  if (!release.value) return { status: 'missing' };

  let states: ReadonlyMap<string, LearningStateV3 | null> = new Map();
  try {
    states = (await loadLearningStates())?.states ?? states;
  } catch {
    // Progress is remote/best-effort; the verified local release remains usable offline.
  }
  if (!isCurrent()) return { status: 'stale' };
  const summary = await service.summarize(catalogId, states);
  if (summary.status === 'stale' || !isCurrent()) return { status: 'stale' };
  return summary.value ? { status: 'ready', summary: summary.value } : { status: 'missing' };
}

export function navigateCatalogWorkspaceQuery({
  service,
  current,
  patch,
  currentLocation,
  navigate,
}: {
  service: Pick<CatalogWorkspaceService, 'invalidate'>;
  current: CatalogWorkspaceQuery;
  patch: CatalogWorkspaceQueryPatch;
  currentLocation: string;
  navigate: (location: string) => void;
}): CatalogWorkspaceQuery {
  service.invalidate();
  const next = patchCatalogWorkspaceQuery(current, patch);
  navigate(createCatalogWorkspaceLocation(currentLocation, next));
  return next;
}
