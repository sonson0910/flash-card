import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAiGenerationConfig, MAX_AI_OUTPUT_TOKENS } from '../src/aiGeneration.js';

describe('AI generation limits', () => {
  it('uses explicit, bounded output-token budgets for every vocabulary action', () => {
    expect(MAX_AI_OUTPUT_TOKENS).toEqual({
      word: 2_048,
      story: 1_024,
      translate: 1_536,
    });

    for (const maximum of Object.values(MAX_AI_OUTPUT_TOKENS)) {
      expect(Number.isSafeInteger(maximum)).toBe(true);
      expect(maximum).toBeGreaterThan(0);
      expect(maximum).toBeLessThanOrEqual(2_048);
    }
  });

  it('adds the selected limit without dropping structured-output settings', () => {
    expect(createAiGenerationConfig('word', {
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT' },
    })).toEqual({
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT' },
      maxOutputTokens: 2_048,
    });

    expect(createAiGenerationConfig('translate')).toEqual({
      maxOutputTokens: 1_536,
    });
  });

  it('wires the bounded configuration into every model request', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

    for (const action of ['word', 'story', 'translate']) {
      expect(source).toContain(`config: createAiGenerationConfig('${action}'`);
    }
  });

  it('keeps AI generation on one instance and fails closed when budget storage is unavailable', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const generateVocabulary = source.slice(
      source.indexOf('export const generateVocabulary'),
      source.indexOf('export const findVocabularyImage'),
    );

    expect(generateVocabulary).toMatch(/maxInstances:\s*1/);
    const budgetCall = generateVocabulary.slice(
      generateVocabulary.indexOf('await consumeBudget'),
      generateVocabulary.indexOf('const ai'),
    );
    expect(generateVocabulary.match(/await consumeBudget/g)).toHaveLength(1);
    expect(budgetCall).toMatch(/budget\.message,\s*'gemini',\s*MAX_GEMINI_CALLS_PER_HOUR/);
    expect(source).toContain('consumeRateLimitFailClosed');
    expect(source).toContain('consumeServiceBudget');
    expect(source).not.toContain('createMemoryRateLimitStore');
    expect(source).not.toContain('consumeRateLimitWithMemoryFallback');
  });
});
