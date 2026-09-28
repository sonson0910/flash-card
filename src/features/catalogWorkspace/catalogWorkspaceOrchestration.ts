import type { CatalogLearningStatus, CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import {
  createCatalogWorkspaceLocation,
  patchCatalogWorkspaceQuery,
  type CatalogWorkspaceQuery,
  type CatalogWorkspaceQueryPatch,
} from './catalogWorkspaceQuery';
import type { CatalogWorkspaceService } from './catalogWorkspaceService';

export type InstalledCatalogInspection =
  | { readonly status: 'stale' }
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly summary: CatalogWorkspaceSummary; readonly progressAvailable: boolean };

type CatalogReleaseSelection = Pick<CatalogWorkspaceQuery, 'catalogId' | 'releaseId'>;

export async function inspectInstalledCatalog({
  service,
  catalogId,
  releaseId,
  loadProgress,
  isCurrent = () => true,
}: {
  service: CatalogWorkspaceService;
  catalogId: string;
  releaseId: string;
  loadProgress?: () => Promise<ReadonlyMap<string, CatalogLearningStatus>>;
  isCurrent?: () => boolean;
}): Promise<InstalledCatalogInspection> {
  const release = await service.inspect(catalogId);
  if (release.status === 'stale' || !isCurrent()) return { status: 'stale' };
  if (!release.value || release.value.releaseId !== releaseId) return { status: 'missing' };

  let statuses: ReadonlyMap<string, CatalogLearningStatus> = new Map();
  let progressAvailable = false;
  if (release.value.schemaVersion === 2 && loadProgress) {
    try {
      statuses = await loadProgress();
      progressAvailable = true;
    } catch {
      // Progress is remote/best-effort; the verified local release remains usable offline.
    }
  }
  if (!isCurrent()) return { status: 'stale' };
  const summary = await service.summarize(catalogId, statuses);
  if (summary.status === 'stale' || !isCurrent()) return { status: 'stale' };
  return summary.value ? { status: 'ready', summary: summary.value, progressAvailable } : { status: 'missing' };
}

export function synchronizeCatalogHistoryInspection({
  service,
  current,
  restored,
}: {
  service: Pick<CatalogWorkspaceService, 'invalidate'>;
  current: CatalogReleaseSelection;
  restored: CatalogReleaseSelection;
}): boolean {
  const releaseChanged = current.catalogId !== restored.catalogId
    || current.releaseId !== restored.releaseId;
  if (releaseChanged) service.invalidate();
  return releaseChanged;
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
