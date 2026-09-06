import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createOfflineShellDescriptor,
  renderOfflineServiceWorker,
} from './offline-shell.mjs';

describe('offline shell descriptor', () => {
  it('is deterministic and includes only the built shell allowlist', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-'));
    try {
      fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
      fs.mkdirSync(path.join(fixture, 'media', 'listen-mvp'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'index.html'), '<main>shell</main>');
      fs.writeFileSync(path.join(fixture, 'assets', 'entry.js'), 'entry');
      fs.writeFileSync(path.join(fixture, 'assets', 'lazy.js'), 'lazy');
      fs.writeFileSync(path.join(fixture, 'assets', 'style.css'), 'style');
      fs.writeFileSync(path.join(fixture, 'assets', 'geist.woff2'), 'font');
      fs.writeFileSync(path.join(fixture, 'assets', 'landing.mp4'), 'video');
      fs.writeFileSync(path.join(fixture, 'media', 'listen-mvp', 'clip.m4a'), 'audio');
      fs.writeFileSync(path.join(fixture, 'health.json'), '{}');
      fs.writeFileSync(path.join(fixture, 'browser-extension-privacy.html'), 'privacy');
      fs.writeFileSync(path.join(fixture, 'manifest.webmanifest'), '{}');

      const first = createOfflineShellDescriptor({ distDirectory: fixture, revision: 'revision-a' });
      const second = createOfflineShellDescriptor({ distDirectory: fixture, revision: 'revision-a' });

      expect(first).toEqual(second);
      expect(first.assets.map(asset => asset.url)).toEqual([
        '/assets/entry.js',
        '/assets/geist.woff2',
        '/assets/lazy.js',
        '/assets/style.css',
        '/index.html',
      ]);
      expect(first.assets.every(asset => /^[a-f0-9]{64}$/.test(asset.sha256))).toBe(true);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a descriptor without the SPA entry document', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-'));
    try {
      fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'assets', 'entry.js'), 'entry');

      expect(() => createOfflineShellDescriptor({
        distDirectory: fixture,
        revision: 'revision-a',
        assetUrls: ['/assets/entry.js'],
      })).toThrow(/index\.html/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('changes the fingerprint when an included asset changes', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-'));
    try {
      fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'index.html'), '<main>shell</main>');
      fs.writeFileSync(path.join(fixture, 'assets', 'entry.js'), 'entry-v1');
      const first = createOfflineShellDescriptor({ distDirectory: fixture, revision: 'revision-a' });

      fs.writeFileSync(path.join(fixture, 'assets', 'entry.js'), 'entry-v2');
      const second = createOfflineShellDescriptor({ distDirectory: fixture, revision: 'revision-a' });

      expect(second.fingerprint).not.toBe(first.fingerprint);
      expect(second.assets.find(asset => asset.url === '/assets/entry.js')?.sha256)
        .not.toBe(first.assets.find(asset => asset.url === '/assets/entry.js')?.sha256);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects missing, traversing, and oversized shell assets', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-'));
    try {
      fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'index.html'), '<main>shell</main>');
      fs.writeFileSync(path.join(fixture, 'assets', 'entry.js'), 'entry');

      expect(() => createOfflineShellDescriptor({
        distDirectory: fixture,
        revision: 'revision-a',
        assetUrls: ['/index.html', '/assets/missing.js'],
      })).toThrow(/missing/);
      expect(() => createOfflineShellDescriptor({
        distDirectory: fixture,
        revision: 'revision-a',
        assetUrls: ['/index.html', '/../outside.js'],
      })).toThrow(/traversal/);
      expect(() => createOfflineShellDescriptor({
        distDirectory: fixture,
        revision: 'revision-a',
        assetUrls: ['/index.html', '/assets/entry.js'],
        maximumBytes: 1,
      })).toThrow(/exceeds/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('rejects a shell asset that resolves through a symlink outside dist', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-outside-'));
    try {
      fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'index.html'), '<main>shell</main>');
      fs.writeFileSync(path.join(outside, 'entry.js'), 'outside');
      fs.symlinkSync(path.join(outside, 'entry.js'), path.join(fixture, 'assets', 'entry.js'));

      expect(() => createOfflineShellDescriptor({ distDirectory: fixture, revision: 'revision-a' }))
        .toThrow(/symbolic link|escapes dist/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('rejects protected paths even when they are explicitly requested', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-shell-'));
    try {
      fs.mkdirSync(path.join(fixture, 'api'), { recursive: true });
      fs.mkdirSync(path.join(fixture, '__'), { recursive: true });
      fs.mkdirSync(path.join(fixture, 'private'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'index.html'), '<main>shell</main>');
      for (const relativePath of ['api/data.js', '__/auth.js', 'private/profile.js']) {
        fs.writeFileSync(path.join(fixture, relativePath), 'protected');
        expect(() => createOfflineShellDescriptor({
          distDirectory: fixture,
          revision: 'revision-a',
          assetUrls: ['/index.html', `/${relativePath}`],
        })).toThrow(/allowlist|protected/i);
      }
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('renders a validated descriptor into the classic worker template', () => {
    const descriptor = {
      revision: 'revision-a',
      fingerprint: 'a'.repeat(64),
      assets: [{
        url: '/index.html',
        sha256: 'b'.repeat(64),
        bytes: 1,
      }],
    };

    const rendered = renderOfflineServiceWorker(
      `const descriptor = ${'/* SONFLASH_OFFLINE_SHELL_DESCRIPTOR */ null'};`,
      descriptor,
    );

    expect(rendered).toContain(JSON.stringify(descriptor));
    expect(rendered).not.toContain('SONFLASH_OFFLINE_SHELL_DESCRIPTOR');
    expect(renderOfflineServiceWorker(
      `const descriptor = ${'/* SONFLASH_OFFLINE_SHELL_DESCRIPTOR */ null'};`,
      { ...descriptor, fingerprint: 'c'.repeat(64) },
    )).not.toBe(rendered);
  });
});
