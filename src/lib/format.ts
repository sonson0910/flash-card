let activeLocale = 'en';

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormats = new Map<string, Intl.RelativeTimeFormat>();
const listFormats = new Map<string, Intl.ListFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

const cacheKey = (locale: string, options: object = {}): string => `${locale}:${JSON.stringify(
  Object.entries(options).sort(([left], [right]) => left.localeCompare(right)),
)}`;

const memoize = <T>(
  cache: Map<string, T>,
  create: () => T,
  options: object,
): T => {
  const key = cacheKey(activeLocale, options);
  const cached = cache.get(key);
  if (cached) return cached;
  const formatter = create();
  cache.set(key, formatter);
  return formatter;
};

export const getFormatLocale = (): string => activeLocale;

export const setFormatLocale = (locale: string): void => {
  activeLocale = locale;
};

export const getNumberFormat = (options: Intl.NumberFormatOptions = {}): Intl.NumberFormat =>
  memoize(numberFormats, () => new Intl.NumberFormat(activeLocale, options), options);

export const getDateTimeFormat = (options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat =>
  memoize(dateTimeFormats, () => new Intl.DateTimeFormat(activeLocale, options), options);

export const getRelativeTimeFormat = (options: Intl.RelativeTimeFormatOptions = {}): Intl.RelativeTimeFormat =>
  memoize(relativeTimeFormats, () => new Intl.RelativeTimeFormat(activeLocale, options), options);

export const getListFormat = (options: Intl.ListFormatOptions = {}): Intl.ListFormat =>
  memoize(listFormats, () => new Intl.ListFormat(activeLocale, options), options);

export const getPluralRules = (options: Intl.PluralRulesOptions = {}): Intl.PluralRules =>
  memoize(pluralRules, () => new Intl.PluralRules(activeLocale, options), options);

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
  getNumberFormat(options).format(value);

export const formatCompactNumber = (value: number, options: Intl.NumberFormatOptions = {}): string =>
  formatNumber(value, { notation: 'compact', maximumFractionDigits: 1, ...options });

export const formatPercent = (value: number, options: Intl.NumberFormatOptions = {}): string =>
  formatNumber(value, { style: 'percent', ...options });

export const formatCurrency = (
  value: number,
  currency: string,
  options: Intl.NumberFormatOptions = {},
): string => formatNumber(value, { style: 'currency', currency, ...options });

export const formatDate = (value: number | Date, options?: Intl.DateTimeFormatOptions): string =>
  getDateTimeFormat(options).format(value);

export const formatRelativeTime = (
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
): string => getRelativeTimeFormat(options).format(value, unit);

export const formatList = (values: Iterable<string>, options?: Intl.ListFormatOptions): string =>
  getListFormat(options).format(values);

export const selectPlural = (value: number, options?: Intl.PluralRulesOptions): Intl.LDMLPluralRule =>
  getPluralRules(options).select(value);
