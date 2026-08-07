import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const scannerPath = fileURLToPath(new URL('./verify-build-secrets.mjs', import.meta.url));
const temporaryDirectories = [];

const cleanEnvironment = () => {
  const environment = { ...process.env };
  delete environment.GEMINI_API_KEY;
  delete environment.VITE_PEXELS_API_KEY;
  delete environment.VITE_UNSPLASH_API_KEY;
  return environment;
};

const createArtifact = (content, firebaseConfig) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-secret-scan-'));
  temporaryDirectories.push(directory);
  fs.mkdirSync(path.join(directory, 'dist'));
  fs.writeFileSync(path.join(directory, 'dist', 'index.js'), content, 'utf8');
  if (firebaseConfig) {
    fs.writeFileSync(
      path.join(directory, 'firebase-applet-config.json'),
      `${JSON.stringify(firebaseConfig)}\n`,
      'utf8',
    );
  }
  return directory;
};

const scan = (cwd, environment = cleanEnvironment()) => spawnSync(
  process.execPath,
  [scannerPath],
  { cwd, env: environment, encoding: 'utf8' },
);

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('production artifact secret scan', () => {
  it('accepts a clean artifact when no provider secrets are configured', () => {
    const directory = createArtifact('console.log("clean artifact");');

    const result = scan(directory);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('no provider secrets or private credential patterns found');
  });

  it('rejects an artifact containing an exact configured provider secret', () => {
    const secret = 'configured-provider-secret-value';
    const directory = createArtifact(`window.providerKey = "${secret}";`);
    const environment = cleanEnvironment();
    environment.GEMINI_API_KEY = secret;

    const result = scan(directory, environment);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('configured provider secret');
  });

  it('rejects a common hard-coded private credential without configured secrets', () => {
    const privateCredential = `sk-proj-${'a'.repeat(40)}`;
    const directory = createArtifact(`window.privateCredential = "${privateCredential}";`);

    const result = scan(directory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('OpenAI API key');
  });

  it('allows the exact public Firebase web API key declared by the app config', () => {
    const publicFirebaseApiKey = `AIza${'A'.repeat(35)}`;
    const directory = createArtifact(
      `window.firebaseConfig = { apiKey: "${publicFirebaseApiKey}" };`,
      { apiKey: publicFirebaseApiKey, projectId: 'demo-lingoflash' },
    );

    const result = scan(directory);

    expect(result.status, result.stderr).toBe(0);
  });

  it('rejects a Google API key that is not declared by the Firebase app config', () => {
    const publicFirebaseApiKey = `AIza${'A'.repeat(35)}`;
    const unlistedGoogleApiKey = `AIza${'B'.repeat(35)}`;
    const directory = createArtifact(
      `window.providerKey = "${unlistedGoogleApiKey}";`,
      { apiKey: publicFirebaseApiKey, projectId: 'demo-lingoflash' },
    );

    const result = scan(directory);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Google API key');
  });
});
