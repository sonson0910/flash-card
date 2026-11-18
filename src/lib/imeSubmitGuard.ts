export function createImeSubmitGuard() {
  let composing = false;
  let compositionJustEnded = false;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    onCompositionStart() {
      if (resetTimer) clearTimeout(resetTimer);
      composing = true;
      compositionJustEnded = false;
    },
    onCompositionEnd() {
      composing = false;
      compositionJustEnded = true;
      resetTimer = setTimeout(() => { compositionJustEnded = false; }, 0);
    },
    shouldBlockKeyDown(event: { readonly key: string; readonly isComposing?: boolean; readonly keyCode?: number }) {
      return event.key === 'Enter' && (composing || compositionJustEnded || event.isComposing === true || event.keyCode === 229);
    },
    shouldBlockSubmit(event: { readonly isComposing?: boolean; readonly keyCode?: number }, submittedByPointer = false) {
      return composing || event.isComposing === true || event.keyCode === 229 || (compositionJustEnded && !submittedByPointer);
    },
  };
}
