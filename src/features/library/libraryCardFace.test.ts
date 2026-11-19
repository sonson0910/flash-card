import { describe, expect, it } from 'vitest';
import { getLibraryCoverTone, splitStressedWord } from './libraryCardFace';

describe('getLibraryCoverTone', () => {
  it('gives every card of a category the same tone', () => {
    expect(getLibraryCoverTone('Healthcare')).toBe(getLibraryCoverTone(' healthcare '));
    expect(['teal', 'violet', 'amber']).toContain(getLibraryCoverTone('Energy'));
  });

  it('falls back to a stable tone without a category', () => {
    expect(getLibraryCoverTone(undefined)).toBe(getLibraryCoverTone(''));
  });
});

describe('splitStressedWord', () => {
  it('highlights the syllable the IPA marks with primary stress', () => {
    expect(splitStressedWord('Spelling', '/ˈspelɪŋ/', 'en')).toEqual({ before: '', stressed: 'Spel', after: 'ling' });
    expect(splitStressedWord('Permanent', '/ˈpɜːmənənt/', 'en')).toEqual({ before: '', stressed: 'Per', after: 'manent' });
    expect(splitStressedWord('Ambition', '/æmˈbɪʃn/', 'en')).toEqual({ before: 'Am', stressed: 'bi', after: 'tion' });
  });

  it('accepts an ASCII apostrophe as the primary stress mark and skips secondary stress', () => {
    expect(splitStressedWord('Immediate', "/ɪ'miːdiət/", 'en')?.stressed).toBe('me');
    expect(splitStressedWord('Recharge', '/ˌriːˈtʃɑːdʒ/', 'en')).toEqual({ before: 'Re', stressed: 'charge', after: '' });
  });

  it('highlights a single-syllable word whole', () => {
    expect(splitStressedWord('Nurse', '/nɜːs/', 'en')).toEqual({ before: '', stressed: 'Nurse', after: '' });
  });

  it('never guesses when the IPA cannot place the stress', () => {
    expect(splitStressedWord('Permanent', undefined, 'en')).toBeNull();
    expect(splitStressedWord('Permanent', '/pɜːmənənt/', 'en')).toBeNull();
    expect(splitStressedWord('look up', '/lʊk ˈʌp/', 'en')).toBeNull();
    expect(splitStressedWord('Arbeit', '/ˈaʁbaɪ̯t/', 'de')).toBeNull();
  });
});

describe('splitStressedWord syllables', () => {
  it('keeps consonant digraphs and final silent e inside one syllable', () => {
    expect(splitStressedWord('Exact', '/ɪɡˈzækt/', 'en')).toEqual({ before: 'Ex', stressed: 'act', after: '' });
    expect(splitStressedWord('Warden', '/ˈwɔːdn/', 'en')).toEqual({ before: '', stressed: 'War', after: 'den' });
    expect(splitStressedWord('Centre', '/ˈsentə/', 'en')).toEqual({ before: '', stressed: 'Cen', after: 'tre' });
    expect(splitStressedWord('Instant', '/ˈɪnstənt/', 'en')).toEqual({ before: '', stressed: 'In', after: 'stant' });
  });
});
