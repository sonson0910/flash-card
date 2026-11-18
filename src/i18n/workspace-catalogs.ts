import type { Messages } from '@lingui/core';

// Landing only needs shell/landing; workspace catalogs keep their import registry lazy.
const catalogs = import.meta.glob<{ messages: Messages }>([
  './locales/en/*.po',
  './locales/vi/*.po',
  '!./locales/*/{landing,shell}.po',
]);

export const loadWorkspaceCatalog = (catalogKey: string, key: string): Promise<{ messages: Messages }> => {
  const importer = catalogs[`./locales/${catalogKey}.po`];
  return importer ? importer() : Promise.reject(new Error(`Missing UI catalog: ${key}`));
};
