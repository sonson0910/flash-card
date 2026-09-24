import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

export type LumiBubbleProps = Omit<ComponentPropsWithoutRef<'aside'>, 'children'> & {
  readonly message: ReactNode;
};

export function LumiBubble({ message, ...props }: LumiBubbleProps) {
  return <aside {...props}>{message}</aside>;
}
