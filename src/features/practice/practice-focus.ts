/**
 * Practice screens move focus when a step changes (a new question heading, the Next button, a
 * story title) so screen readers announce the new context. The ring on that element follows the
 * learner's input: after a key press it is drawn as usual; after a pointer press, or before any
 * input at all, the element is marked quiet and the ring stays hidden until the next key press.
 * Elements a learner reaches with Tab keep their ring, because the Tab key press clears the mark.
 */
const QUIET_FOCUS = 'data-quiet-focus';

type InputSource = 'keyboard' | 'pointer' | null;

let lastInput: InputSource = null;
let listening = false;

function listenForInputSource() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    lastInput = 'keyboard';
    document.querySelectorAll(`[${QUIET_FOCUS}]`).forEach(element => element.removeAttribute(QUIET_FOCUS));
  }, true);
  document.addEventListener('pointerdown', () => { lastInput = 'pointer'; }, true);
}

listenForInputSource();

/** Focuses `element` for an announcement, drawing its ring only for keyboard use. */
export function moveFocus(element: HTMLElement | null | undefined) {
  if (!element) return;
  if (lastInput === 'keyboard') element.removeAttribute(QUIET_FOCUS);
  else element.setAttribute(QUIET_FOCUS, '');
  element.focus();
}
