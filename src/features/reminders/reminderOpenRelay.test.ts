import { describe, expect, it, vi } from 'vitest';
import { listenForReminderOpen } from './reminderOpenRelay';

const setup = (current = '/?view=library') => {
  let listener: ((event: { data: unknown }) => void) | undefined;
  const container = {
    addEventListener: vi.fn((_type: string, next: (event: { data: unknown }) => void) => { listener = next; }),
    removeEventListener: vi.fn(),
    startMessages: vi.fn(),
  };
  const [pathname, search] = current.split('?');
  const location = { pathname, search: search ? `?${search}` : '', assign: vi.fn() };
  const stop = listenForReminderOpen(container as unknown as ServiceWorkerContainer, location as unknown as Location);
  return { container, location, stop, receive: (data: unknown) => listener?.({ data }) };
};

describe('reminder notification relay', () => {
  it('opens the path a worker asks for on this page', () => {
    const { container, location, receive } = setup();

    receive({ type: 'sonflash-open-path', path: '/?view=today' });

    expect(container.startMessages).toHaveBeenCalledOnce();
    expect(location.assign).toHaveBeenCalledWith('/?view=today');
  });

  it('ignores other messages, the page it is already on and any path that leaves the app origin', () => {
    const { location, receive } = setup('/?view=today');

    receive({ type: 'sonflash-open-path', path: '/?view=today' });
    receive({ type: 'other', path: '/?view=today' });
    receive({ type: 'sonflash-open-path', path: 'https://outside.example/' });
    receive({ type: 'sonflash-open-path', path: '//outside.example/' });
    receive({ type: 'sonflash-open-path', path: '/\\outside.example/' });
    receive({ type: 'sonflash-open-path' });
    receive(null);

    expect(location.assign).not.toHaveBeenCalled();
  });

  it('stops listening when asked', () => {
    const { container, stop } = setup();
    stop();
    expect(container.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
  });
});
