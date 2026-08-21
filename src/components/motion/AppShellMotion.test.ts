import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleShellAnimations } from './AppShellMotion';

afterEach(() => {
  vi.useRealTimers();
});

describe('AppShellMotion delivery', () => {
  it('uses the browser animation API without pulling GSAP into every first view', () => {
    const source = readFileSync(fileURLToPath(new URL('./AppShellMotion.tsx', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/from ['"](?:@gsap\/react|gsap)['"]/);
    expect(source).toContain('.animate(');
    expect(source).toContain('prefers-reduced-motion: reduce');
  });

  it('loads shell readiness eagerly with the authenticated app instead of a secondary deferred chunk', () => {
    const authenticatedAppSource = readFileSync(
      fileURLToPath(new URL('../../app/AuthenticatedApp.tsx', import.meta.url)),
      'utf8',
    );

    expect(authenticatedAppSource).toMatch(/import\s+\{\s*AppShellMotion\s*\}\s+from/);
    expect(authenticatedAppSource).not.toMatch(/const AppShellMotion = lazy/);
  });

  it('arms the deadline before reading a browser animation promise that can throw', () => {
    vi.useFakeTimers();
    const finish = vi.fn();
    const animation = {
      addEventListener: vi.fn(),
      get finished(): Promise<Animation> {
        throw new Error('Animation promise unavailable');
      },
    } as unknown as Animation;

    settleShellAnimations([animation], finish);
    vi.advanceTimersByTime(1_000);

    expect(finish).toHaveBeenCalledOnce();
  });
});
