import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_RATE_SCOPES } from '../src/accountData.js';
import { getVocabularyAiBudget, type VocabularyAiAction } from '../src/aiRequestBudget.js';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const covered = new Set<string>(ACCOUNT_RATE_SCOPES);

describe('per-owner rate-limit budgets removed with an account', () => {
  it('covers every vocabulary AI budget scope', () => {
    const actions: VocabularyAiAction[] = ['word', 'story', 'translate', 'tutor', 'mnemonic', 'extract', 'dialogue', 'conversation'];
    for (const action of actions) expect(covered, action).toContain(getVocabularyAiBudget(action).scope);
  });

  it('covers every literal owner scope a callable consumes, and the owner twin of every service scope', () => {
    const ownerScopes = [...indexSource.matchAll(/consumeBudget\(\s*userId,\s*'([a-z0-9-]+)'/g)].map(match => match[1]);
    const serviceTwins = [...indexSource.matchAll(/'([a-z0-9-]+-service)',\s*MAX_/g)].map(match => `${match[1]}-owner`);
    const directOwnerScopes = [...indexSource.matchAll(/consumeOwnerAndServiceBudget\(\s*database,\s*userId,\s*'([a-z0-9-]+)'/g)]
      .map(match => match[1]);
    expect(ownerScopes.length).toBeGreaterThan(20);
    expect(serviceTwins).toContain('pronunciation-assessment-service-owner');
    // A callable that names a shared budget and a per-owner maximum for it spends `<shared scope>-owner` as well.
    const sharedBudgetTwins = [...indexSource.matchAll(/'([a-z0-9-]+)',\s*MAX_[A-Z_]+,\s*MAX_[A-Z_]*OWNER[A-Z_]*/g)]
      .map(match => `${match[1]}-owner`);
    expect(sharedBudgetTwins).toContain('gemini-owner');
    expect(directOwnerScopes).toContain('image-provider-owner');
    for (const scope of [...ownerScopes, ...serviceTwins, ...sharedBudgetTwins, ...directOwnerScopes]) {
      expect(covered, scope).toContain(scope);
    }
  });

  it('lists no scope that no callable consumes', () => {
    expect(covered.has('ai-tutor-turn')).toBe(false);
    expect(new Set(ACCOUNT_RATE_SCOPES).size).toBe(ACCOUNT_RATE_SCOPES.length);
  });
});
