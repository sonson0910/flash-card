import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  IncomingSharePreview,
  OutgoingShareDetails,
  ShareManagementButton,
} from './AppOverlays';

describe('share overlays', () => {
  it('renders an explicit, write-free incoming preview decision', () => {
    const html = renderToStaticMarkup(
      <IncomingSharePreview
        preview={{
          shareId: 'deck-1',
          category: 'IELTS',
          cardCount: 100,
          sampleWords: ['airport', 'boarding pass'],
        }}
        isSharing={false}
        onAccept={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain('Review shared deck');
    expect(html).toContain('IELTS');
    expect(html).toContain('100 cards');
    expect(html).toContain('airport');
    expect(html).toContain('Nothing will be added until you accept');
    expect(html).toContain('Accept deck');
    expect(html).toContain('Cancel');
  });

  it('keeps truncation guidance inside the outgoing share dialog', () => {
    const warning = 'This link includes the first 100 of 120 cards. Split this category into smaller decks to share the rest.';
    const html = renderToStaticMarkup(
      <OutgoingShareDetails
        shareLink="https://example.test/?share=deck-1"
        shareWarning={warning}
        copied={false}
        copyFailed={false}
        canRevokeShare
        isSharing={false}
        onCopy={vi.fn()}
        onDismissCopyError={vi.fn()}
        onRevoke={vi.fn()}
      />,
    );

    expect(html).toContain(warning);
    expect(html).toContain('Revoke link');
  });

  it('offers a visible way to reopen management after the dialog closes', () => {
    const html = renderToStaticMarkup(<ShareManagementButton onClick={vi.fn()} />);

    expect(html).toContain('Manage shared link');
  });
});

describe('practice chooser', () => {
  it('groups modes by learning goal and uses concise product names', () => {
    const source = readFileSync(fileURLToPath(new URL('./AppOverlays.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('data-overlay-grammar="cold-mineral"');
    expect(source).toContain('app-overlay-dialog');
    expect(source).toContain('data-practice-group="recall"');
    expect(source).toContain('data-practice-group="fluency"');
    expect(source).toContain('data-practice-group="apply"');
    for (const goal of ['Recall &amp; accuracy', 'Speed &amp; fluency', 'Speak &amp; apply']) expect(source).toContain(goal);
    expect(source).toContain('title="Word match"');
    expect(source).toContain('title="Shadowing"');
    expect(source).toContain('transition-[filter,border-color,background-color,translate]');
    expect(source).not.toContain('Word Match (60s Speed-run)');
    expect(source).not.toContain('Shadowing Arena');
  });
});
