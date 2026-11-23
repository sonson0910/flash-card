import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useCallback, useRef, useState } from 'react';
import type { CardData } from '../../types/card';
import { createLibraryExportOperation, type LibraryExportPhase } from './libraryExport';
import { cardsToSpreadsheetRows } from './spreadsheetModel';

interface LibraryExportOptions {
  ownerId: string | null;
  cards: readonly CardData[];
  minimumExpectedCards: number;
  loadAllCards(ownerId: string | null): Promise<readonly CardData[] | null>;
  /** Every card the owner holds across all courses; the export is a whole-library backup. */
  countAllCards(ownerId: string): Promise<number>;
  reportError(message: string): void;
  notify(message: string): void;
}

interface PreparedSpreadsheet {
  xlsx: typeof import('@e965/xlsx/dist/xlsx.mini.min');
  workbook: ReturnType<typeof import('@e965/xlsx/dist/xlsx.mini.min')['utils']['book_new']>;
}

type XlsxMiniModule = typeof import('@e965/xlsx/dist/xlsx.mini.min');

export function useLibraryExport(options: LibraryExportOptions) {
  const contextRef = useRef({ ...options, generation: 0 });
  const previous = contextRef.current;
  const changed = previous.ownerId !== options.ownerId
    || previous.cards !== options.cards
    || previous.minimumExpectedCards !== options.minimumExpectedCards;
  contextRef.current = { ...options, generation: previous.generation + Number(changed) };

  const [phase, setPhase] = useState<LibraryExportPhase>('idle');
  const exporterRef = useRef<ReturnType<typeof createLibraryExportOperation<CardData, PreparedSpreadsheet>> | null>(null);
  if (!exporterRef.current) {
    exporterRef.current = createLibraryExportOperation<CardData, PreparedSpreadsheet>({
      loadCards: async () => {
        const context = contextRef.current;
        if (!context.ownerId) return await context.loadAllCards(null) ?? context.cards;
        // Counted before the read, so a card added meanwhile can only make the file larger than the minimum.
        const expected = await context.countAllCards(context.ownerId);
        const loaded = await context.loadAllCards(context.ownerId);
        return loaded && loaded.length >= expected ? loaded : null;
      },
      prepare: async cards => {
        const module = await import('@e965/xlsx/dist/xlsx.mini.min') as XlsxMiniModule & { default?: XlsxMiniModule };
        const xlsx = module.default ?? module;
        const worksheet = xlsx.utils.json_to_sheet(cardsToSpreadsheetRows([...cards]));
        const workbook = xlsx.utils.book_new();
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Flashcards');
        return { xlsx, workbook };
      },
      write: prepared => prepared.xlsx.writeFile(prepared.workbook, 'SonFlash_Export.xlsx'),
      onPhase: setPhase,
    });
  }

  const exportLibrary = useCallback(async () => {
    const context = contextRef.current;
    const result = await exporterRef.current!.run({
      minimumExpectedCards: context.minimumExpectedCards,
      isCurrent: () => contextRef.current.generation === context.generation,
    });
    if (result.status === 'failed') contextRef.current.reportError(result.message);
    if (result.status === 'completed') contextRef.current.notify(i18n._(msg({
      id: 'library.export.completed',
      message: '{count, plural, one {Exported # card from all your courses.} other {Exported # cards from all your courses.}}',
    }).id, { count: result.exportedCount }));
  }, []);

  return { exportLibrary, phase, isExporting: phase !== 'idle' };
}
