const wordCharacter = /^[\p{L}\p{N}_]$/u;

const isWordCharacter = (value: string | undefined): boolean => (
  value !== undefined && wordCharacter.test(value)
);

export function replaceClozeAnswer(
  source: string,
  answer: string,
  allowEmbedded = false,
): string | null {
  if (!source || !answer) return null;
  const normalizedSource = source.toLocaleLowerCase();
  const normalizedAnswer = answer.toLocaleLowerCase();
  let searchFrom = 0;
  let unchangedFrom = 0;
  let result = '';
  let replaced = false;

  for (;;) {
    const index = normalizedSource.indexOf(normalizedAnswer, searchFrom);
    if (index < 0) break;
    const end = index + answer.length;
    if (source.slice(index, end).toLocaleLowerCase() !== normalizedAnswer) {
      searchFrom = index + 1;
      continue;
    }
    const before = Array.from(source.slice(0, index)).at(-1);
    const after = Array.from(source.slice(end))[0];
    if (allowEmbedded || (!isWordCharacter(before) && !isWordCharacter(after))) {
      result += `${source.slice(unchangedFrom, index)}_____`;
      unchangedFrom = end;
      replaced = true;
    }
    searchFrom = end;
  }

  return replaced ? `${result}${source.slice(unchangedFrom)}` : null;
}
