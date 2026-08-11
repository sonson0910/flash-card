import { OperationTimeoutError, withTimeout } from '../../lib/async';

export type LibraryExportPhase = 'idle' | 'loading' | 'preparing' | 'writing';

export type LibraryExportResult =
  | { status: 'completed'; exportedCount: number }
  | { status: 'busy' }
  | {
    status: 'failed';
    reason: 'empty' | 'incomplete' | 'timeout' | 'stale' | 'load' | 'prepare' | 'write';
    message: string;
  };

interface LibraryExportOperationOptions<Card, Prepared> {
  loadCards(): Promise<readonly Card[] | null>;
  prepare(cards: readonly Card[]): Promise<Prepared>;
  write(prepared: Prepared): void;
  onPhase?(phase: LibraryExportPhase): void;
  timeoutMs?: number;
}

const messages = {
  empty: 'There are no cards to export.',
  incomplete: 'Could not load your complete library, so no incomplete export was downloaded. Check your connection and try again.',
  timeout: 'Export preparation took too long. Nothing was downloaded; check your connection and try again.',
  stale: 'The signed-in library changed while exporting. Nothing was downloaded; start the export again.',
  load: 'Could not load the cards for export. Check your connection and try again.',
  prepare: 'Could not prepare the spreadsheet. No file was downloaded; please try again.',
  write: 'The export was prepared, but the browser could not download it. Check download permissions and try again.',
} as const;

export function createLibraryExportOperation<Card, Prepared>({
  loadCards,
  prepare,
  write,
  onPhase = () => undefined,
  timeoutMs = 20_000,
}: LibraryExportOperationOptions<Card, Prepared>) {
  let active = false;

  const publishPhase = (phase: LibraryExportPhase) => {
    try {
      onPhase(phase);
    } catch {
      // Presentation feedback must never change export correctness.
    }
  };

  const run = async ({ minimumExpectedCards = 0, isCurrent = () => true }: {
    minimumExpectedCards?: number;
    isCurrent?: () => boolean;
  } = {}): Promise<LibraryExportResult> => {
    if (active) return { status: 'busy' };
    active = true;
    let phase: Exclude<LibraryExportPhase, 'idle'> = 'loading';
    publishPhase(phase);

    try {
      const cards = await withTimeout(
        Promise.resolve().then(loadCards),
        timeoutMs,
        messages.timeout,
      );
      if (!isCurrent()) {
        return { status: 'failed', reason: 'stale', message: messages.stale };
      }
      if (!cards || cards.length < Math.max(0, minimumExpectedCards)) {
        return { status: 'failed', reason: 'incomplete', message: messages.incomplete };
      }
      if (cards.length === 0) {
        return { status: 'failed', reason: 'empty', message: messages.empty };
      }

      phase = 'preparing';
      publishPhase(phase);
      const prepared = await withTimeout(
        Promise.resolve().then(() => prepare(cards)),
        timeoutMs,
        messages.timeout,
      );
      if (!isCurrent()) {
        return { status: 'failed', reason: 'stale', message: messages.stale };
      }

      phase = 'writing';
      publishPhase(phase);
      write(prepared);
      return { status: 'completed', exportedCount: cards.length };
    } catch (error) {
      if (error instanceof OperationTimeoutError) {
        return { status: 'failed', reason: 'timeout', message: messages.timeout };
      }
      const reason = phase === 'loading' ? 'load' : phase === 'preparing' ? 'prepare' : 'write';
      return { status: 'failed', reason, message: messages[reason] };
    } finally {
      active = false;
      publishPhase('idle');
    }
  };

  return { run };
}
