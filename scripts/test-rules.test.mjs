import { describe, expect, it } from 'vitest';
import {
  environmentWithJava,
  javaHomeCandidates,
  runRulesCommand,
} from './test-rules.mjs';

describe('Rules test Java runtime resolution', () => {
  it('prioritizes an explicitly configured JAVA_HOME and removes duplicate candidates', () => {
    expect(
      javaHomeCandidates({
        env: { JAVA_HOME: '/custom/jdk-21' },
        platformName: 'darwin',
      }),
    ).toEqual([
      '/custom/jdk-21',
      '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
      '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
      '/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
    ]);
  });

  it('uses the first usable Homebrew OpenJDK candidate on macOS', () => {
    const env = {
      PATH: '/usr/bin:/bin',
    };
    const resolved = environmentWithJava({
      env,
      platformName: 'darwin',
      executable: () => true,
      probe: () => true,
    });

    expect(resolved.JAVA_HOME).toBe(
      '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    );
    expect(resolved.PATH.startsWith(`${resolved.JAVA_HOME}/bin:`)).toBe(true);
  });

  it('keeps a valid Java 21 executable already present on PATH', () => {
    const env = {
      JAVA_HOME: '/invalid/jdk',
      PATH: '/toolchain/bin:/usr/bin',
    };
    const resolved = environmentWithJava({
      env,
      platformName: 'linux',
      executable: (filePath) => filePath === '/toolchain/bin/java',
      probe: () => true,
    });

    expect(resolved.JAVA_HOME).toBeUndefined();
    expect(resolved.PATH).toBe(env.PATH);
  });

  it('forwards a Firebase emulator failure exit code', () => {
    const exitCode = runRulesCommand({
      env: {},
      spawn: () => ({ status: 2 }),
    });

    expect(exitCode).toBe(2);
  });
});
