import { describe, expect, it } from 'vitest';
import { normalizeCardData } from '../../lib/cardNormalization';
import {
  countJapaneseMora,
  resolveStaticJapanesePitchAccent,
  resolveStoredJapanesePitchAccent,
  parseUniDicKanaAccentRow,
} from './japanesePitch';

describe('Japanese UniDic pitch subset', () => {
  it('normalizes a UniDic katakana reading and preserves a verified downstep', () => {
    const accent = resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' });

    expect(accent).toMatchObject({
      readingKana: 'にっぽん',
      moraCount: 4,
      downstep: 3,
      source: { dataset: 'unidic-kana-accent', version: '2.1.2' },
    });
    expect(countJapaneseMora('ニッポン')).toBe(4);
  });

  it('uses the source kana and row identity from the pinned archive', () => {
    expect(resolveStaticJapanesePitchAccent({ word: '形態', phonetic: 'けーたい' })).toMatchObject({
      readingKana: 'けーたい',
      source: { row: '235745|形態|ケータイ|0|C2|*' },
    });
    expect(resolveStaticJapanesePitchAccent({ word: '形態', phonetic: 'けいたい' })).toBeUndefined();
    expect(resolveStaticJapanesePitchAccent({ word: '空港', phonetic: 'くーこー' })).toMatchObject({
      readingKana: 'くーこー',
      source: { row: '215091|空港|クーコー|0|C2|*' },
    });
  });

  it('rejects compound, modified, and ambiguous source forms', () => {
    expect(parseUniDicKanaAccentRow({
      word: '例', kana: 'レイ', aType: '1,2', aConType: '*', aModType: '*',
    })).toBeUndefined();
    expect(parseUniDicKanaAccentRow({
      word: '例', kana: 'レイ', aType: '1', aConType: '*', aModType: 'M1@1',
    })).toBeUndefined();
    expect(resolveStaticJapanesePitchAccent({ word: '面白い', phonetic: 'おもしろい' })).toBeUndefined();
  });

  it('requires stored provenance to match the pinned source candidate', () => {
    const candidate = resolveStaticJapanesePitchAccent({ word: '形態', phonetic: 'けーたい' });
    expect(candidate).toBeDefined();

    expect(resolveStoredJapanesePitchAccent({
      word: '形態',
      phonetic: 'けーたい',
      japanesePitchAccent: candidate!,
    })).toEqual(candidate);
    expect(resolveStoredJapanesePitchAccent({
      word: '形態',
      phonetic: 'けーたい',
      japanesePitchAccent: { ...candidate!, downstep: 1 },
    })).toBeUndefined();
    expect(resolveStoredJapanesePitchAccent({
      word: '形態',
      phonetic: 'けーたい',
      japanesePitchAccent: { ...candidate!, source: undefined },
    } as never)).toBeUndefined();
    expect(resolveStoredJapanesePitchAccent({
      word: '形態',
      phonetic: 'けーたい',
    })).toBeUndefined();
  });

  it('keeps verified metadata through a card read', () => {
    const accent = resolveStaticJapanesePitchAccent({ word: '日本', phonetic: 'にっぽん' });
    const card = normalizeCardData({
      word: '日本', phonetic: 'にっぽん', language: 'ja', japanesePitchAccent: accent,
    }, 'japanese-card');

    expect(resolveStoredJapanesePitchAccent(card)).toEqual(accent);
  });
});
