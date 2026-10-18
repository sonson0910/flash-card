const APP_ORIGINS: Record<string, string> = {
  'encoded-hangout-433912-h2': 'https://sonflash.app',
  'sonflash-staging-20260906': 'https://sonflash-staging-20260906.web.app',
  'demo-lingoflash': 'http://127.0.0.1:4173',
};

export function reminderTodayUrl(projectId: string, locale: string): string {
  const origin = Object.hasOwn(APP_ORIGINS, projectId) ? APP_ORIGINS[projectId] : undefined;
  if (!origin) throw new Error('Reminder app origin is not configured for this Firebase project.');
  return `${origin}${locale === 'vi' ? '/vi/' : '/'}?view=today`;
}
