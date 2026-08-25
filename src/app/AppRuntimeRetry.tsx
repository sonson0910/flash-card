import { lazy, Suspense, type ComponentProps } from 'react';

const AppRuntime = lazy(() => import('./AppRuntime'));

export default function AppRuntimeRetry(props: ComponentProps<typeof AppRuntime>) {
  return (
    <Suspense fallback={null}>
      <AppRuntime {...props} />
    </Suspense>
  );
}
