import { expect, test, type Page } from '@playwright/test';

const card = {
  id: 'palette-remediation',
  word: 'harmony',
  normalizedWord: 'harmony',
  translation: 'sự hài hòa',
  explanation: 'A pleasing arrangement of parts.',
  explanationTranslation: 'Sự sắp xếp cân bằng và dễ chịu giữa các thành phần.',
  phonetic: '/ˈhɑː.mə.ni/',
  emoji: '🎨',
  category: 'Design',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 6, 15, 10, 0).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
  exampleSentence: 'The interface uses color with harmony.',
  exampleTranslation: 'Giao diện sử dụng màu sắc một cách hài hòa.',
};

const expectedPalette = {
  light: {
    '--sf-canvas': '#f6f8f8',
    '--sf-surface': '#ffffff',
    '--sf-surface-raised': '#f1f5f5',
    '--sf-text': '#0f172a',
    '--sf-text-muted': '#475569',
    '--sf-border': '#d8e1e3',
    '--sf-brand': '#0891b2',
    '--sf-brand-hover': '#0e7490',
    '--sf-brand-text': '#0e7490',
    '--sf-on-brand': '#071014',
    '--sf-reward': '#fbbf24',
  },
  dark: {
    '--sf-canvas': '#071014',
    '--sf-surface': '#102229',
    '--sf-surface-raised': '#17343d',
    '--sf-text': '#f8fafc',
    '--sf-text-muted': '#a8bac2',
    '--sf-border': '#29434c',
    '--sf-brand': '#0891b2',
    '--sf-brand-hover': '#0e7490',
    '--sf-brand-text': '#67e8f9',
    '--sf-on-brand': '#071014',
    '--sf-reward': '#fbbf24',
  },
} as const;

type Palette = typeof expectedPalette.light;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(storedCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(storedCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
  }, [card]);
});

const readPalette = async (page: Page) => page.evaluate(tokenNames => {
  const styles = getComputedStyle(document.documentElement);
  const normalizeHex = (value: string) => value.replace(
    /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i,
    '#$1$1$2$2$3$3',
  ).toLowerCase();
  return Object.fromEntries(tokenNames.map(token => [token, normalizeHex(styles.getPropertyValue(token).trim())]));
}, Object.keys(expectedPalette.light));

const rgb = (hex: string) => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(index => Number.parseInt(value.slice(index, index + 2), 16));
};

const luminance = (hex: string) => {
  const [red, green, blue] = rgb(hex).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrast = (foreground: string, background: string) => {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

test('semantic palette exposes stable roles in light and dark themes', async ({ page }) => {
  await page.goto('/');
  expect(await readPalette(page)).toEqual(expectedPalette.light);

  await page.getByRole('button', { name: 'Use dark theme' }).click();
  expect(await readPalette(page)).toEqual(expectedPalette.dark);
});

test('neutral text and cyan actions meet contrast requirements', async () => {
  for (const palette of Object.values(expectedPalette) as Palette[]) {
    expect(contrast(palette['--sf-text'], palette['--sf-surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['--sf-text-muted'], palette['--sf-surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['--sf-brand-text'], palette['--sf-surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['--sf-on-brand'], palette['--sf-brand'])).toBeGreaterThanOrEqual(4.5);
  }
});
