import { useCallback, useRef, useState } from 'react';
import type { CardData } from '../../types/card';
import { createLibraryExportOperation, type LibraryExportPhase } from './libraryExport';
import { cardsToSpreadsheetRows } from './spreadsheetModel';

interface LibraryExportOptions {
  ownerId: string | null;
  cards: readonly CardData[];
  minimumExpectedCards: number;
  loadAllCards(ownerId: string | null): Promise<readonly CardData[] | null>;
  reportError(message: string): void;
  notify(message: string): void;
}

interface PreparedSpreadsheet {
  xlsx: typeof import('@e965/xlsx');
  workbook: ReturnType<typeof import('@e965/xlsx')['utils']['book_new']>;
}

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
        const loaded = await context.loadAllCards(context.ownerId);
        return context.ownerId && !loaded ? null : loaded ?? context.cards;
      },
      prepare: async cards => {
        const xlsx = await import('@e965/xlsx');
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
    if (result.status === 'completed') contextRef.current.notify(`Exported ${result.exportedCount} cards.`);
  }, []);

  return { exportLibrary, phase, isExporting: phase !== 'idle' };
}
