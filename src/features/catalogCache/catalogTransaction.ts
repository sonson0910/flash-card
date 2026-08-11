export function observeCatalogTransaction(
  transaction: IDBTransaction,
  abortedMessage: string,
  failedMessage: string,
): Promise<void> {
  const completion = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error(abortedMessage));
    transaction.onerror = () => reject(transaction.error ?? new Error(failedMessage));
  });
  // A request/cursor can reject before its caller reaches `await completion`.
  // Observe immediately so an abort in that gap never becomes an orphaned
  // unhandled rejection; awaiting the original promise still rejects normally.
  void completion.catch(() => undefined);
  return completion;
}
