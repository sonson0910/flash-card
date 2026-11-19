import { describe, expect, it } from 'vitest';
import { collectStructuredWordStream, completedJsonFields } from '../src/progressiveJsonFields.js';

describe('structured AI stream fields', () => {
  it('emits only complete values, including nested data and escaped punctuation', () => {
    const emitted = new Set<string>();
    const first = '{"translation":"a, \\"quote\\"","examples":["one",';
    expect(completedJsonFields(first, emitted)).toEqual([['translation', 'a, "quote"']]);
    emitted.add('translation');
    const second = `${first}"two"],"wordFamily":{"noun":"rain"},"explanation":"not finished`;
    expect(completedJsonFields(second, emitted)).toEqual([
      ['examples', ['one', 'two']], ['wordFamily', { noun: 'rain' }],
    ]);
    emitted.add('examples');
    emitted.add('wordFamily');
    expect(completedJsonFields(`${second} yet"}`, emitted)).toEqual([['explanation', 'not finished yet']]);
  });

  it('waits for a valid complete object before emitting malformed fields', () => {
    expect(completedJsonFields('{"translation": broken,', new Set())).toEqual([]);
  });

  it('forwards actual completed fields once and keeps final usage for the ledger', async () => {
    async function* chunks() {
      yield { text: '{"translation":"hello",' };
      yield { text: '"exampleSentence":"He said, ' };
      yield { text: '\\"hello\\".","unexpected":"skip"}', usageMetadata: { totalTokenCount: 12 } };
    }
    const received: Array<[string, unknown]> = [];
    const result = await collectStructuredWordStream(chunks(), async (field, value) => {
      received.push([field, value]);
    });
    expect(received).toEqual([
      ['translation', 'hello'], ['exampleSentence', 'He said, "hello".'],
    ]);
    expect(result.usageMetadata).toEqual({ totalTokenCount: 12 });
  });

  const collect = async (parts: readonly string[]) => {
    async function* chunks() { for (const text of parts) yield { text }; }
    const received: Array<[string, unknown]> = [];
    const result = await collectStructuredWordStream(chunks(), async (field, value) => { received.push([field, value]); });
    return { received, text: result.text };
  };

  it('keeps a value whole when a chunk ends inside an escape sequence or a surrogate pair', async () => {
    const emoji = '🌱';
    const { received } = await collect([
      '{"exampleSentence":"She said \\',
      '"grow\\"', ' and \\', 'u00e9tait","emoji":"', emoji[0], emoji[1], '","phonetic":"/rɪˈzɪl',
      'iənt/"}',
    ]);
    expect(received).toEqual([
      ['exampleSentence', 'She said "grow" and était'], ['emoji', emoji], ['phonetic', '/rɪˈzɪliənt/'],
    ]);
  });

  it('emits a field split across many chunks once, only after it closes', async () => {
    const events: string[] = [];
    async function* chunks() {
      for (const text of ['{"trans', 'lation":"kiên', ' cường"', ',"translationAlternatives":["bền', ' bỉ"', ']', '}']) {
        events.push(`chunk:${text}`);
        yield { text };
      }
    }
    await collectStructuredWordStream(chunks(), async field => { events.push(`field:${field}`); });
    expect(events.filter(event => event.startsWith('field:'))).toEqual(['field:translation', 'field:translationAlternatives']);
    expect(events.indexOf('field:translation')).toBeGreaterThan(events.indexOf('chunk:,"translationAlternatives":["bền'));
    expect(events.indexOf('field:translationAlternatives')).toBeGreaterThan(events.indexOf('chunk:]'));
  });

  it('emits nothing partial from output that is cut off, and returns the raw text for the final check', async () => {
    const { received, text } = await collect(['{"translation":"kiên cường","explanation":"Able to recover', ' quickly']);
    expect(received).toEqual([['translation', 'kiên cường']]);
    expect(text).toBe('{"translation":"kiên cường","explanation":"Able to recover quickly');
  });

  it('skips fields of the wrong shape, including alternative translations that are not a list of strings', async () => {
    const { received } = await collect([
      '{"translation":7,"translationAlternatives":"bền bỉ","synonyms":["tough",3],"wordFamily":["x"],',
      '"cefrLevel":"B2","collocations":["bounce back"]}',
    ]);
    expect(received).toEqual([['cefrLevel', 'B2'], ['collocations', ['bounce back']]]);
  });

  it('refuses output larger than the structured-output cap', async () => {
    await expect(collect(['{"explanation":"', 'x'.repeat(40_001)])).rejects.toThrow('AI structured output is too large.');
  });
});
