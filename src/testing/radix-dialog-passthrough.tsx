import type { ReactNode } from 'react';

/**
 * `renderToStaticMarkup` (used by static-render dialog tests) cannot render
 * Radix's real `Portal`: Portal needs a live DOM container to attach to, and
 * server rendering has none, so the whole subtree silently renders as `''`.
 * These mocks replace the Radix Dialog / AlertDialog primitives with plain
 * passthrough elements so static-render tests can assert on the real
 * component markup without a browser DOM. `Root` still gates on `open` to
 * match the real closed-state behavior (`open={false}` renders nothing).
 *
 * Radix-only props that cannot be forwarded to a plain DOM element (because
 * they are not valid HTML attributes and would trigger React "unknown DOM
 * attribute" warnings) are dropped before spreading the rest.
 */
const NON_DOM_PROPS = new Set([
  'asChild',
  'forceMount',
  'onOpenAutoFocus',
  'onCloseAutoFocus',
  'onEscapeKeyDown',
  'onPointerDownOutside',
  'onInteractOutside',
  'onFocusOutside',
]);

type PassthroughProps = {
  children?: ReactNode;
  open?: boolean;
} & Record<string, unknown>;

const domSafeProps = (props: Record<string, unknown>): Record<string, unknown> => {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (NON_DOM_PROPS.has(key)) continue;
    safe[key] = value;
  }
  return safe;
};

const passthrough = ({ children, ...rest }: PassthroughProps) =>
  <div {...domSafeProps(rest)}>{children}</div>;

const rootPassthrough = ({ open, children }: PassthroughProps) => (open ? <>{children}</> : null);

/** Use as the factory return value of `vi.mock('@radix-ui/react-dialog', () => ...)`. */
export const createRadixDialogPassthroughMock = () => ({
  Root: rootPassthrough,
  Portal: passthrough,
  Overlay: passthrough,
  Content: passthrough,
  Title: passthrough,
  Description: passthrough,
  Close: passthrough,
  Trigger: passthrough,
});

/** Use as the factory return value of `vi.mock('@radix-ui/react-alert-dialog', () => ...)`. */
export const createRadixAlertDialogPassthroughMock = () => ({
  Root: rootPassthrough,
  Portal: passthrough,
  Overlay: passthrough,
  Content: passthrough,
  Title: passthrough,
  Description: passthrough,
  Cancel: passthrough,
  Action: passthrough,
  Trigger: passthrough,
});
