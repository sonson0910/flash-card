import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PronunciationVideo, pronunciationLessons, pronunciationEmbedUrl } from './PronunciationVideo';

describe('pronunciation lesson pilot', () => {
  it('offers ten verified word mappings without loading an external player before consent', () => {
    expect(Object.keys(pronunciationLessons)).toHaveLength(10);
    const html = renderToStaticMarkup(<PronunciationVideo word=" Water " />);
    expect(html).toContain('Load pronunciation video');
    expect(html).toContain('Full pronunciation lesson');
    expect(html).not.toContain('<iframe');
    expect(renderToStaticMarkup(<PronunciationVideo word="not-in-pilot" />)).toBe('');
  });
  it('restricts player identity and time bounds', () => {
    const url = new URL(pronunciationEmbedUrl(pronunciationLessons.water));
    expect(url.origin).toBe('https://www.youtube-nocookie.com');
    expect(url.searchParams.get('autoplay')).toBe('0');
    expect(url.searchParams.get('start')).toBe('0');
    expect(url.searchParams.get('end')).toBe('288');
    expect(() => pronunciationEmbedUrl({ ...pronunciationLessons.water, videoId: '../evil' })).toThrow();
    expect(() => pronunciationEmbedUrl({ ...pronunciationLessons.water, end: -1 })).toThrow();
  });
});
