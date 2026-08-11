import { getProtectedFunctionUserMessage } from './protectedFunctionsCapability';

export const CLIPBOARD_COPY_FAILURE_MESSAGE =
  'The link could not be copied. Copy it manually or try the copy button again.';

export const EXPLANATION_TRANSLATION_FAILURE_MESSAGE =
  'The explanation could not be translated. Check your connection and try again.';

interface ClipboardWriter {
  writeText: (value: string) => Promise<void>;
}

type ClipboardCopyResult = { status: 'copied' } | { status: 'failed' };

type ExplanationTranslationResult =
  | { status: 'translated'; value: string }
  | { status: 'failed'; message?: string };

export async function copyTextToClipboard(
  clipboard: ClipboardWriter | null | undefined,
  value: string,
): Promise<ClipboardCopyResult> {
  if (!clipboard) return { status: 'failed' };

  try {
    await clipboard.writeText(value);
    return { status: 'copied' };
  } catch {
    return { status: 'failed' };
  }
}

export async function translateExplanationSafely(
  translate: (value: string) => Promise<string>,
  explanation: string,
): Promise<ExplanationTranslationResult> {
  try {
    const value = await translate(explanation);
    return value.trim() ? { status: 'translated', value } : { status: 'failed' };
  } catch (error) {
    const message = getProtectedFunctionUserMessage(error);
    return message ? { status: 'failed', message } : { status: 'failed' };
  }
}
