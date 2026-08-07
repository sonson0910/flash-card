import { createEnglishStarterCatalogDraft } from '../src/features/catalogPipeline/starterCatalog';
import { validateCatalogSourceBundle } from '../src/features/catalogPipeline/catalogValidation';

const result = validateCatalogSourceBundle(createEnglishStarterCatalogDraft());
if (result.status !== 'accepted') throw new Error('Starter draft failed structural validation.');
console.log(JSON.stringify({
  status: 'draft-valid',
  catalogId: result.catalog.manifest.catalogId,
  lexemes: result.catalog.lexemes.length,
  memberships: result.catalog.memberships.length,
  publishable: false,
  writesPublicAssets: false,
}));
