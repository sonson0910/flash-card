import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  grantPendingFlushLease,
  getPendingOperationCardId,
  isTrustedLocalDeviceRequest,
  mergeLocalPendingOperations,
} from './dev/sharedDeviceStoreAdapter';

describe('local pending flush lease', () => {
  it('only lets an explicit retry reclaim an unexpired lease', () => {
    const leases = new Map([['owner', 10_000]]);

    expect(grantPendingFlushLease(leases, 'owner', 1_000, false)).toBe(false);
    expect(grantPendingFlushLease(leases, 'owner', 1_000, true)).toBe(true);
    expect(leases.get('owner')).toBe(121_000);
  });
});

describe('local device endpoint request boundary', () => {
  const request = (headers: Record<string, string>, method = 'POST') => ({ headers, method });

  it('accepts same-origin JSON mutations', () => {
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json; charset=utf-8',
    }))).toBe(true);
  });

  it('rejects cross-site, mismatched-origin and non-JSON mutations', () => {
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    }))).toBe(false);
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain',
    }))).toBe(false);
    expect(isTrustedLocalDeviceRequest(request({
      host: 'attacker.example:3000',
      origin: 'http://attacker.example:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    }))).toBe(false);
  });

  it('requires browser provenance even for read and event-stream requests', () => {
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
    }, 'GET'))).toBe(true);
    expect(isTrustedLocalDeviceRequest(request({ host: '127.0.0.1:3000' }, 'GET'))).toBe(false);
  });
});

describe('local pending operation helpers', () => {
  it('targets patches by cardId and retains every distinct pending operation', () => {
    const patch = { type: 'patch', cardId: 'card-1', fields: { bookmarked: true }, updatedAt: '2' };
    expect(getPendingOperationCardId(patch)).toBe('card-1');

    const operations = Array.from({ length: 5_100 }, (_, index) => ({
      type: 'delete',
      cardId: `card-${index}`,
      updatedAt: String(index),
    }));
    expect(mergeLocalPendingOperations([], operations)).toHaveLength(5_100);
  });
});

describe('Shared Device Store adapter boundary', () => {
  it('keeps Vite declarative and the development adapter explicitly typed', () => {
    const configSource = readFileSync(fileURLToPath(new URL('./vite.config.ts', import.meta.url)), 'utf8');
    const adapterSource = readFileSync(fileURLToPath(new URL('./dev/sharedDeviceStoreAdapter.ts', import.meta.url)), 'utf8');

    expect(configSource.split('\n').length).toBeLessThan(120);
    expect(configSource).toContain('sharedDeviceStorePlugin()');
    expect(configSource).not.toMatch(/configureServer|readBody|writeJsonFileAtomically|device-cards\/events/);
    expect(adapterSource).toContain('configureServer(server)');
    expect(adapterSource).not.toMatch(/\bany\b/);
    expect(configSource).not.toMatch(/\bany\b/);
  });
});
