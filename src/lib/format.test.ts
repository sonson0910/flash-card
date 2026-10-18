import { afterEach, describe, expect, it } from 'vitest';
import {
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  getDateTimeFormat,
  getListFormat,
  getNumberFormat,
  getPluralRules,
  getRelativeTimeFormat,
  setFormatLocale,
  selectPlural,
} from './format';

describe('localized formatters', () => {
  afterEach(() => setFormatLocale('en'));

  it('formats numbers with the active locale and reuses formatters', () => {
    setFormatLocale('en');
    expect(formatNumber(12_480.5)).toBe('12,480.5');
    expect(getNumberFormat()).toBe(getNumberFormat());

    setFormatLocale('vi');
    expect(formatNumber(12_480.5)).toBe('12.480,5');

    setFormatLocale('de');
    expect(formatNumber(12_480.5)).toBe('12.480,5');

    setFormatLocale('ko');
    expect(formatNumber(12_480.5)).toBe('12,480.5');
  });

  it('formats compact numbers, percentages, and currencies', () => {
    setFormatLocale('en');
    expect(formatCompactNumber(12_480)).toBe('12.5K');
    expect(formatPercent(0.25)).toBe('25%');
    expect(formatCurrency(12.5, 'USD')).toBe('$12.50');
  });

  it('formats dates, relative time, lists, and plurals with the active locale', () => {
    setFormatLocale('ja');
    expect(formatDate(new Date('2026-09-23T12:00:00Z'), { dateStyle: 'full', timeZone: 'UTC' }))
      .toBe('2026年9月23日水曜日');
    expect(formatRelativeTime(-1, 'day', { numeric: 'auto' })).toBe('昨日');
    expect(formatList(['A', 'B', 'C'])).toBe('A、B、C');
    expect(selectPlural(1)).toBe('other');
    expect(getDateTimeFormat()).toBe(getDateTimeFormat());
    expect(getRelativeTimeFormat()).toBe(getRelativeTimeFormat());
    expect(getListFormat()).toBe(getListFormat());
    expect(getPluralRules()).toBe(getPluralRules());
  });
});
