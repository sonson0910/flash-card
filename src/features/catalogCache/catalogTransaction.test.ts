import { describe, expect, it } from 'vitest';
import { observeCatalogTransaction } from './catalogTransaction';

const fakeTransaction = () => ({
  error: new Error('IndexedDB request failed'),
  oncomplete: null,
  onabort: null,
  onerror: null,
}) as unknown as IDBTransaction;

describe('catalog transaction completion', () => {
  it('keeps rejection observable without creating an orphaned unhandled promise', async () => {
    const transaction = fakeTransaction();
    const completion = observeCatalogTransaction(transaction, 'aborted', 'failed');

    transaction.onerror?.(new Event('error'));

    await expect(completion).rejects.toThrow('IndexedDB request failed');

    const orphanTransaction = fakeTransaction();
    const safelyObserved = observeCatalogTransaction(orphanTransaction, 'aborted', 'failed');
    void safelyObserved;
    orphanTransaction.onerror?.(new Event('error'));
    await Promise.resolve();
  });
});
