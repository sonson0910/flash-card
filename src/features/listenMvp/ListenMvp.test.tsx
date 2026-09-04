import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ListenMvpLessonV1 } from './listenMvpContract';
import {
  ListenMvp,
  createListenMvpCachedAudioSource,
  getListenMvpAudioState,
  listenMvpClipKey,
} from './ListenMvp';

const lesson: ListenMvpLessonV1 = {
  clip: {
    schemaVersion: 1,
    id: 'hotel-clip',
    language: 'en',
    mediaKind: 'audio',
    path: 'media/hotel-clip.mp3',
    mimeType: 'audio/mpeg',
    byteLength: 4_096,
    durationMs: 5_000,
    contentRights: {
      schemaVersion: 1,
      registryVersion: 1,
      sourceRef: 'voa-learning-english-pilot',
      sourceAssetSha256: 'a'.repeat(64),
    },
    transcriptCues: [{
      schemaVersion: 1,
      id: 'cue-1',
      clipId: 'hotel-clip',
      language: 'en',
      startMs: 0,
      endMs: 2_000,
      text: 'I would like to book a room.',
    }],
  },
  chunk: {
    schemaVersion: 1,
    id: 'book-a-room',
    language: 'en',
    kind: 'phrase',
    text: 'book a room',
    lexemeIds: ['book'],
    contentRights: {
      schemaVersion: 1,
      registryVersion: 1,
      sourceRef: 'voa-learning-english-pilot',
      sourceAssetSha256: 'a'.repeat(64),
    },
  },
  comprehension: {
    question: 'What does the speaker want to do?',
    options: ['Book a room', 'Buy a ticket'],
    answer: 'Book a room',
  },
  sources: [{
    sourceRef: 'voa-learning-english-pilot',
    sourceUrl: 'https://learningenglish.voanews.com/example',
    licenseId: 'PUBLIC-DOMAIN',
    attribution: 'Voice of America Learning English',
  }],
};

describe('ListenMvp', () => {
  it('states clearly when no reviewed lesson is available', () => {
    const html = renderToStaticMarkup(<ListenMvp lesson={null} />);

    expect(html).toContain('Reviewed listening is not installed yet');
    expect(html).toContain('Draft media is never played.');
    expect(html).not.toContain('<audio');
  });

  it('renders accessible audio controls, captions, comprehension, and source evidence', () => {
    const html = renderToStaticMarkup(<ListenMvp lesson={lesson} onSaveChunk={vi.fn()} />);

    expect(html).toContain('<audio');
    expect(html).toContain('controls=""');
    expect(html).toContain('Listen to book a room');
    expect(html).toContain('Replay');
    expect(html).toContain('0.75×');
    expect(html).toContain('1×');
    expect(html).toContain('Captions');
    expect(html).toContain('I would like to book a room.');
    expect(html).toContain('What does the speaker want to do?');
    expect(html).toContain('Book a room');
    expect(html).toContain('Save phrase');
    expect(html).toContain('https://learningenglish.voanews.com/example');
    expect(html).toContain('PUBLIC-DOMAIN');
    expect(html).toContain('Voice of America Learning English');
  });

  it('does not expose a learner-data action unless the caller supplies the seam', () => {
    const html = renderToStaticMarkup(<ListenMvp lesson={lesson} />);

    expect(html).not.toContain('Save phrase');
    expect(html).toContain('Source and attribution');
  });

  it('creates and revokes cached audio object URLs exactly once', async () => {
    const createObjectURL = vi.fn(() => 'blob:cached-listen');
    const revokeObjectURL = vi.fn();
    const source = await createListenMvpCachedAudioSource(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/wav' } }),
      { createObjectURL, revokeObjectURL },
    );

    expect(source.url).toBe('blob:cached-listen');
    source.revoke();
    source.revoke();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cached-listen');
  });

  it('holds online playback until an optional cache lookup settles', () => {
    const clipKey = listenMvpClipKey(lesson.clip);
    const resolver = { resolveCachedClip: vi.fn() };

    expect(getListenMvpAudioState(lesson, resolver, null, null)).toEqual({
      pending: true,
      src: undefined,
    });
    expect(getListenMvpAudioState(lesson, resolver, {
      clipKey,
      status: 'ready',
    }, null)).toEqual({
      pending: false,
      src: lesson.clip.path,
    });
    expect(getListenMvpAudioState(lesson, resolver, {
      clipKey,
      status: 'ready',
    }, {
      clipKey,
      source: { url: 'blob:cached-listen', revoke: vi.fn() },
    })).toEqual({
      pending: false,
      src: 'blob:cached-listen',
    });
    expect(getListenMvpAudioState(lesson, undefined, null, null)).toEqual({
      pending: false,
      src: lesson.clip.path,
    });
  });
});
