export interface PersonalLibraryPathInput {
  readonly total: number;
  readonly dueToday: number;
  readonly learning: number;
  readonly learned: number;
}

export interface PersonalLibraryPathPresentation {
  readonly total: number;
  readonly dueToday: number;
  readonly learning: number;
  readonly learned: number;
}

const safeCount = (value: number): number => Number.isFinite(value)
  ? Math.max(0, Math.floor(value))
  : 0;

export function createPersonalLibraryPathPresentation(
  input: PersonalLibraryPathInput,
): PersonalLibraryPathPresentation {
  const learning = safeCount(input.learning);
  const learned = safeCount(input.learned);
  const total = Math.max(safeCount(input.total), learning, learned);
  return {
    total,
    dueToday: Math.min(total, safeCount(input.dueToday)),
    learning: Math.min(total, learning),
    learned: Math.min(total, learned),
  };
}
