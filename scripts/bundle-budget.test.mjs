import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_BUNDLE_BUDGETS,
  evaluateBundleBudget,
  parseInitialAssetPaths,
  readBundleMetrics,
} from './bundle-budget.mjs';

describe('bundle budget verification', () => {
  it('discovers only initial JavaScript and CSS referenced by index.html', () => {
    const html = `
      <script type="module" src="/assets/index-abc.js"></script>
      <link rel="modulepreload" href="/assets/vendor-def.js">
      <link rel="stylesheet" href="/assets/index-ghi.css">
      <link rel="icon" href="/favicon.svg">
    `;

    expect(parseInitialAssetPaths(html)).toEqual([
      'assets/index-abc.js',
      'assets/vendor-def.js',
      'assets/index-ghi.css',
    ]);
  });

  it('rejects deferred cloud chunks in the initial asset graph', () => {
    expect(evaluateBundleBudget({
      initialAssetPaths: ['assets/index.js', 'assets/firebase-deadbeef.js'],
      initialJavaScript: { raw: 1, gzip: 1 },
      initialCss: { raw: 1, gzip: 1 },
      javaScriptChunks: [],
    }, {
      initialJavaScriptRaw: 100,
      initialJavaScriptGzip: 100,
      initialCssRaw: 100,
      initialCssGzip: 100,
      totalJavaScriptRaw: 100,
      totalJavaScriptGzip: 100,
      javaScriptChunkRaw: 100,
      javaScriptChunkGzip: 100,
    })).toEqual([
      'initial asset graph contains deferred cloud chunk: assets/firebase-deadbeef.js',
    ]);
  });

  it('reports initial and per-chunk regressions with actionable labels', () => {
    const failures = evaluateBundleBudget({
      initialJavaScript: { raw: 101, gzip: 51 },
      initialCss: { raw: 41, gzip: 21 },
      javaScriptChunks: [
        { path: 'assets/large.js', raw: 81, gzip: 31 },
      ],
    }, {
      initialJavaScriptRaw: 100,
      initialJavaScriptGzip: 50,
      initialCssRaw: 40,
      initialCssGzip: 20,
      totalJavaScriptRaw: 1_000,
      totalJavaScriptGzip: 1_000,
      javaScriptChunkRaw: 80,
      javaScriptChunkGzip: 30,
    });

    expect(failures).toEqual([
      'initial JavaScript raw: 101 B exceeds 100 B',
      'initial JavaScript gzip: 51 B exceeds 50 B',
      'initial CSS raw: 41 B exceeds 40 B',
      'initial CSS gzip: 21 B exceeds 20 B',
      'assets/large.js raw: 81 B exceeds 80 B',
      'assets/large.js gzip: 31 B exceeds 30 B',
    ]);
  });

  it('rejects aggregate JavaScript growth spread across individually-small chunks', () => {
    const failures = evaluateBundleBudget({
      initialJavaScript: { raw: 90, gzip: 40 },
      initialCss: { raw: 20, gzip: 10 },
      javaScriptChunks: [
        { path: 'assets/feature-a.js', raw: 60, gzip: 30 },
        { path: 'assets/feature-b.js', raw: 60, gzip: 30 },
        { path: 'assets/feature-c.js', raw: 60, gzip: 30 },
      ],
    }, {
      initialJavaScriptRaw: 100,
      initialJavaScriptGzip: 50,
      initialCssRaw: 40,
      initialCssGzip: 20,
      totalJavaScriptRaw: 150,
      totalJavaScriptGzip: 70,
      javaScriptChunkRaw: 80,
      javaScriptChunkGzip: 40,
    });

    expect(failures).toEqual([
      'total JavaScript raw: 180 B exceeds 150 B',
      'total JavaScript gzip: 90 B exceeds 70 B',
    ]);
  });

  it('keeps explicit production budgets close to the measured baseline', () => {
    expect(DEFAULT_BUNDLE_BUDGETS).toEqual({
      initialJavaScriptRaw: 224_000,
      initialJavaScriptGzip: 71_000,
      initialCssRaw: 206_000,
      initialCssGzip: 29_500,
      totalJavaScriptRaw: 2_760_000,
      totalJavaScriptGzip: 880_000,
      javaScriptChunkRaw: 650_000,
      javaScriptChunkGzip: 180_000,
      totalMediaRaw: 20_000_000,
    });
  });

  it('counts image and video assets separately and enforces their aggregate raw budget', () => {
    const failures = evaluateBundleBudget(
      {
        initialJavaScript: { raw: 1, gzip: 1 },
        initialCss: { raw: 1, gzip: 1 },
        javaScriptChunks: [],
        imageAssets: [
          { path: 'assets/poster.webp', raw: 80, gzip: 40 },
          { path: 'assets/logo.png', raw: 70, gzip: 35 },
        ],
        videoAssets: [{ path: 'assets/hero.mp4', raw: 90, gzip: 45 }],
        audioAssets: [{ path: 'media/listen-mvp/clip.m4a', raw: 40, gzip: 20 }],
      },
      {
        initialJavaScriptRaw: 100,
        initialJavaScriptGzip: 100,
        initialCssRaw: 100,
        initialCssGzip: 100,
        totalJavaScriptRaw: 100,
        totalJavaScriptGzip: 100,
        javaScriptChunkRaw: 100,
        javaScriptChunkGzip: 100,
        totalMediaRaw: 200,
      },
    );

    expect(failures).toEqual(['total media raw: 280 B exceeds 200 B']);
  });

  it('does not fail when media is split into individually-small files under the aggregate budget', () => {
    const failures = evaluateBundleBudget(
      {
        initialJavaScript: { raw: 1, gzip: 1 },
        initialCss: { raw: 1, gzip: 1 },
        javaScriptChunks: [],
        imageAssets: [
          { path: 'assets/poster.webp', raw: 60, gzip: 30 },
          { path: 'assets/logo.png', raw: 60, gzip: 30 },
        ],
        videoAssets: [{ path: 'assets/hero.mp4', raw: 60, gzip: 30 }],
      },
      {
        initialJavaScriptRaw: 100,
        initialJavaScriptGzip: 100,
        initialCssRaw: 100,
        initialCssGzip: 100,
        totalJavaScriptRaw: 100,
        totalJavaScriptGzip: 100,
        javaScriptChunkRaw: 100,
        javaScriptChunkGzip: 100,
        totalMediaRaw: 200,
      },
    );

    expect(failures).toEqual([]);
  });

  it('discovers supported audio assets recursively under dist/media', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-budget-'));
    try {
      fs.mkdirSync(path.join(fixture, 'assets'), { recursive: true });
      fs.mkdirSync(path.join(fixture, 'media', 'listen-mvp', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'index.html'), '<script src="/assets/index.js"></script>');
      fs.writeFileSync(path.join(fixture, 'assets', 'index.js'), 'entry');
      fs.writeFileSync(path.join(fixture, 'media', 'listen-mvp', 'clip.m4a'), 'audio');
      fs.writeFileSync(path.join(fixture, 'media', 'listen-mvp', 'nested', 'clip.ogg'), 'audio2');
      fs.writeFileSync(path.join(fixture, 'media', 'listen-mvp', 'ignore.txt'), 'ignore');

      const metrics = readBundleMetrics(fixture);

      expect(metrics.audioAssets.map(asset => asset.path)).toEqual([
        'media/listen-mvp/clip.m4a',
        'media/listen-mvp/nested/clip.ogg',
      ]);
      expect(metrics.totalMediaRaw).toBe(11);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
