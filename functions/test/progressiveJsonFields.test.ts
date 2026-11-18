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
});
