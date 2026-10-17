import type { CatalogLearningStatus, CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import type { CatalogWorkspaceService } from './catalogWorkspaceService';

export type InstalledCatalogInspection =
  | { readonly status: 'stale' }
  | { readonly status: 'missing' }
  | { readonly status: 'ready'; readonly summary: CatalogWorkspaceSummary; readonly progressAvailable: boolean };

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
