import { describe, expect, it } from 'vitest';
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft } from './onboardingDraft';

class FakeStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('onboarding draft', () => {
  it('recovers the selected course and pace for its owner, then clears after completion', () => {
    const storage = new FakeStorage();
    const draft = {
      nativeLanguage: 'vi', targetLanguage: 'zh', goalKind: 'hsk', goalLevel: '4',
      goalTargetDate: '2027-03-15', zhScript: 'hant', pace: 15,
    } as const;
    writeOnboardingDraft('owner-1', draft, storage);
    expect(readOnboardingDraft('owner-1', storage)).toEqual(draft);
    expect(readOnboardingDraft('owner-2', storage)).toBeNull();
    clearOnboardingDraft('owner-1', storage);
    expect(readOnboardingDraft('owner-1', storage)).toBeNull();
  });

  it('does not use malformed or impossible saved choices', () => {
    const storage = new FakeStorage();
    storage.setItem('sonflash_onboarding_draft_v1_owner-1', JSON.stringify({
      nativeLanguage: 'en', targetLanguage: 'en', goalKind: null, goalLevel: '',
      goalTargetDate: '', zhScript: null, pace: 10,
    }));
    expect(readOnboardingDraft('owner-1', storage)).toBeNull();
    storage.setItem('sonflash_onboarding_draft_v1_owner-1', '{broken');
    expect(readOnboardingDraft('owner-1', storage)).toBeNull();
    storage.setItem('sonflash_onboarding_draft_v1_owner-1', JSON.stringify({
      nativeLanguage: 'vi', targetLanguage: 'ko', goalKind: 'hsk', goalLevel: '4',
      goalTargetDate: '', zhScript: null, pace: 10,
    }));
    expect(readOnboardingDraft('owner-1', storage)).toBeNull();
  });
});
