// Stands in for next/dynamic in the desktop build, so the web app's screens need no change.
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;
interface Options {
  ssr?: boolean;
  loading?: (props: { isLoading: boolean; pastDelay: boolean; error: Error | null }) => ReactNode;
}

export default function dynamic<P extends object>(load: Loader<P>, options: Options = {}): ComponentType<P> {
  const Lazy = lazy(async () => {
    const loaded = await load();
    return { default: 'default' in loaded ? loaded.default : loaded };
  });
  const fallback = options.loading ? options.loading({ isLoading: true, pastDelay: true, error: null }) : null;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={fallback}>
        {/* @ts-expect-error: the props pass straight through to the loaded component */}
        <Lazy {...props} />
      </Suspense>
    );
  };
}
