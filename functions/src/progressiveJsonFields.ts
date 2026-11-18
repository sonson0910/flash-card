/** Returns complete top-level JSON fields from a growing structured-output stream. */
export function completedJsonFields(text: string, emitted: ReadonlySet<string>): Array<[string, unknown]> {
  const fields: Array<[string, unknown]> = [];
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') depth--;
    if ((char !== ',' || depth !== 1) && (char !== '}' || depth !== 0)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(char === ',' ? `${text.slice(0, index)}}` : text.slice(0, index + 1)); }
    catch { continue; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    for (const [name, value] of Object.entries(parsed)) {
      if (!emitted.has(name) && !fields.some(([field]) => field === name)) fields.push([name, value]);
    }
  }
  return fields;
}

const stringFields = new Set([
  'translation', 'explanation', 'explanationTranslation', 'phonetic', 'emoji', 'category',
  'partOfSpeech', 'cefrLevel', 'exampleSentence', 'exampleTranslation', 'register',
  'commonMistake', 'mnemonic', 'imageSearchQuery',
]);
const listFields = new Set(['collocations', 'synonyms', 'antonyms']);

export async function collectStructuredWordStream(
  chunks: AsyncIterable<{ text?: string; usageMetadata?: unknown }>,
  onField: (field: string, value: unknown) => Promise<void>,
): Promise<{ text: string; usageMetadata?: unknown }> {
  let text = '';
  let usageMetadata: unknown;
  const emitted = new Set<string>();
  for await (const chunk of chunks) {
    text += chunk.text ?? '';
    if (text.length > 40_000) throw new Error('AI structured output is too large.');
    if (chunk.usageMetadata !== undefined) usageMetadata = chunk.usageMetadata;
    for (const [field, value] of completedJsonFields(text, emitted)) {
      const valid = stringFields.has(field) ? typeof value === 'string'
        : listFields.has(field) ? Array.isArray(value) && value.every(item => typeof item === 'string')
          : field === 'wordFamily' && value !== null && typeof value === 'object' && !Array.isArray(value);
      if (!valid) continue;
      emitted.add(field);
      await onField(field, value);
    }
  }
  return { text, usageMetadata };
}
