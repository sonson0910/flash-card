import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settleShellAnimations } from './AppShellMotion';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AppShellMotion delivery', () => {
  it('uses the browser animation API without pulling GSAP into every first view', () => {
    const source = readFileSync(fileURLToPath(new URL('./AppShellMotion.tsx', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/from ['"](?:@gsap\/react|gsap)['"]/);
    expect(source).toContain('.animate(');
    expect(source).toContain('prefers-reduced-motion: reduce');
  });

  it('uses one restrained fade and short lift when the active view changes', () => {
    const source = readFileSync(fileURLToPath(new URL('./AppShellMotion.tsx', import.meta.url)), 'utf8');

    expect(source).toContain("{ opacity: 0, transform: 'translateY(8px)' }");
    expect(source).toContain("{ opacity: 1, transform: 'translateY(0)' }");
    expect(source).toContain('duration: 210');
  });

  it('loads shell readiness with the initial app instead of a deferred chunk', () => {
    const runtimeSource = readFileSync(fileURLToPath(new URL('../../app/AppRuntime.tsx', import.meta.url)), 'utf8');

    expect(runtimeSource).toMatch(/import\s+\{\s*AppShellMotion\s*\}\s+from/);
    expect(runtimeSource).not.toMatch(/const AppShellMotion = lazy/);
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

  it('settles through an animation-frame deadline when browser animation signals stall', () => {
    vi.useFakeTimers();
    const finish = vi.fn();
    let frameCallback: FrameRequestCallback | undefined;
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      frameCallback = callback;
      return 42;
    });
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const animation = {
      addEventListener: vi.fn(),
      get finished(): Promise<Animation> {
        return new Promise(() => undefined);
      },
    } as unknown as Animation;

    const cancel = settleShellAnimations([animation], finish);
    frameCallback?.(Number.MAX_SAFE_INTEGER);

    expect(finish).toHaveBeenCalledOnce();
    cancel();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
  });

  it('settles through a recurring deadline when timeout and animation-frame callbacks stall', () => {
    vi.useFakeTimers();
    vi.stubGlobal('setTimeout', vi.fn(() => 0));
    vi.stubGlobal('requestAnimationFrame', undefined);
    const finish = vi.fn();
    const animation = {
      addEventListener: vi.fn(),
      get finished(): Promise<Animation> {
        return new Promise(() => undefined);
      },
    } as unknown as Animation;

    settleShellAnimations([animation], finish);
    vi.advanceTimersByTime(1_000);

    expect(finish).toHaveBeenCalledOnce();
  });
});
