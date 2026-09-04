import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appRuntimeSource = readFileSync(
  fileURLToPath(new URL('../../app/AppRuntime.tsx', import.meta.url)),
  'utf8',
);

describe('UndoToast integration', () => {
  it('passes a stable dismiss callback from AppRuntime', () => {
    expect(appRuntimeSource).toMatch(
      /const dismissUndoToast = useCallback\(\(\) => \{\s*setUndoToast\(null\);\s*\}, \[\]\);/,
    );
    expect(appRuntimeSource).toContain(
      '<UndoToast toast={undoToast} onDismiss={dismissUndoToast} />',
    );
  });
});
