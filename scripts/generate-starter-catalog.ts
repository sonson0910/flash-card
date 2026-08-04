import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalogRelease } from '../src/features/catalogPipeline/catalogBuilder';
import { createEnglishStarterCatalog } from '../src/features/catalogPipeline/starterCatalog';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(projectRoot, 'public');
const catalogRoot = path.join(publicRoot, 'catalog');
const chunkRoot = path.join(publicRoot, 'english-core');

const result = await buildCatalogRelease(await createEnglishStarterCatalog(), {
  releaseId: 'starter-v1',
  sequence: 1,
  previousReleaseId: null,
  createdAt: '2026-08-04T00:00:00.000Z',
});

if (result.status !== 'built') {
  throw new Error(`Starter catalog build rejected: ${result.reason}${result.path ? ` at ${result.path}` : ''}`);
}

await rm(catalogRoot, { recursive: true, force: true });
await rm(chunkRoot, { recursive: true, force: true });
for (const chunk of result.artifact.chunks) {
  const target = path.join(publicRoot, chunk.descriptor.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, chunk.bytes);
}

const manifestTarget = path.join(catalogRoot, 'english-core/release-manifest.json');
await mkdir(path.dirname(manifestTarget), { recursive: true });
await writeFile(manifestTarget, result.artifact.manifestBytes);
console.log(JSON.stringify(result.artifact.manifest.counts));
