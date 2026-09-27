const areas = {
  landing: ['src/features/landing'],
  shell: [
    'src/App.tsx', 'src/app', 'src/components/shell', 'src/features/navigation',
    'src/components/AppErrorBoundary.tsx', 'src/components/AppOverlays.tsx',
    'src/features/library/libraryViewModel.ts',
    'src/components/RecoverableActionFeedback.tsx', 'src/components/ui/UndoToast.tsx',
    'src/features/courses', 'src/features/onboarding',
  ],
  components: [
    'src/components/*.tsx', 'src/components/flashcard', 'src/components/motion', 'src/components/study', 'src/components/ui',
    'src/features/cardReport',
  ],
  today: ['src/features/dailyLearning', 'src/features/webWords'],
  practice: ['src/features/practice'],
  library: [
    'src/features/library', 'src/features/cardEdit/EditCardDialog.tsx',
    'src/features/intake', 'src/features/importExport/SpreadsheetImportDialog.tsx',
    'src/features/importExport/spreadsheetWorkbook.ts',
  ],
  catalog: ['src/features/catalogWorkspace', 'src/features/catalog'],
  progress: ['src/components/stats', 'src/features/weeklyRecap'],
  billing: ['src/features/billing', 'src/features/plan'],
  account: ['src/features/account'],
  settings: ['src/features/settings'],
} as const;

export default {
  locales: ['en', 'vi', 'en-XA'],
  sourceLocale: 'en',
  pseudoLocale: 'en-XA',
  orderBy: 'messageId',
  catalogs: Object.entries(areas).map(([name, include]) => ({
    path: `src/i18n/locales/{locale}/${name}`,
    include: [...include],
  })),
};
