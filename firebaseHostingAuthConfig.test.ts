import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const firebaseConfig = JSON.parse(fs.readFileSync('firebase.json', 'utf8')) as {
  hosting: {
    headers: Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
  };
};

const globalHeaders = firebaseConfig.hosting.headers.find(entry => entry.source === '**')?.headers ?? [];
const contentSecurityPolicy = globalHeaders.find(header => header.key === 'Content-Security-Policy')?.value ?? '';

describe('Firebase Hosting authentication policy', () => {
  it('allows the same-origin Firebase Auth frame and Google identity bootstrap script', () => {
    expect(contentSecurityPolicy).toMatch(/frame-src[^;]*'self'/);
    expect(contentSecurityPolicy).toMatch(/script-src[^;]*https:\/\/apis\.google\.com(?:\/|\s|;)/);
  });
});
