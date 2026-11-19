import { useTheme } from '../../features/theme/ThemeProvider';

/**
 * The three card treatments the canvas defines: Midnight Aurora (classic dark),
 * Ink & Paper (classic light) and Crystal Star (both modes share one layout).
 */
export type CardLook = 'aurora' | 'paper' | 'crystal';

export function useCardLook(): CardLook {
  const { family, mode } = useTheme();
  if (family === 'crystal') return 'crystal';
  return mode === 'light' ? 'paper' : 'aurora';
}
