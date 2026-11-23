import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const hosting = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')).hosting;
const cspOf = () => {
  const rule = hosting.headers.find(entry => entry.source === '**');
  const header = rule.headers.find(item => item.key === 'Content-Security-Policy');
  return Object.fromEntries(header.value.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const [name, ...sources] = part.split(/\s+/);
    return [name, sources];
  }));
};

describe('hosting Content-Security-Policy', () => {
  it('allows images only from hosts the app actually loads', () => {
    const imgSrc = cspOf()['img-src'];
    expect(imgSrc.length).toBeGreaterThan(0);
    expect(imgSrc.filter(source => /(^|\.)figma\.site$/.test(source.replace(/^https?:\/\//, '')))).toEqual([]);
  });
});
