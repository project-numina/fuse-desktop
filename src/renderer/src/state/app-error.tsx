/**
 * Shared application-level error state.
 *
 * singleton whose `showApplicationError` was registered as
 * `app.config.errorHandler` and also called imperatively from the API client
 * and router. To preserve that "callable from anywhere, React or not"
 * behavior, the error message lives in a module-level store with a
 * subscribe/getSnapshot pair; the React hook reads it via
 * `useSyncExternalStore`, so imperative calls made outside the React tree
 * still update every subscribed component.
 */

import {
  Component,
  createContext,
  useContext,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';

const DEFAULT_MESSAGE = 'Something went wrong. Refresh the page and try again.';
const ROUTE_LOAD_MESSAGE =
  'This page could not be loaded. Refresh to get the latest version.';

// --- Module-level store (usable imperatively, outside React) ----------------

let currentMessage: string | null = null;
const listeners = new Set<() => void>();

function emitChange(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return currentMessage;
}

function isRouteLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('dynamically imported module') ||
    message.includes('importing a module script failed') ||
    message.includes('loading chunk')
  );
}

/**
 * Sets the application-level error message. Safe to call imperatively from
 * outside React (API client, router, error boundary). Route-load failures get
 * a "refresh to get the latest version" message; everything else the generic
 * one.
 */
export function showApplicationError(error: unknown = null): void {
  currentMessage = isRouteLoadError(error) ? ROUTE_LOAD_MESSAGE : DEFAULT_MESSAGE;
  emitChange();
}

/** Clears the application-level error message. */
export function clearApplicationError(): void {
  currentMessage = null;
  emitChange();
}

// --- React surface ----------------------------------------------------------

interface AppErrorContextValue {
  error: string | null;
  showApplicationError: (error?: unknown) => void;
  clearApplicationError: () => void;
}

const AppErrorContext = createContext<AppErrorContextValue | null>(null);

export function AppErrorProvider({ children }: { children: ReactNode }) {
  const error = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const value: AppErrorContextValue = {
    error,
    showApplicationError,
    clearApplicationError,
  };
  return (
    <AppErrorContext.Provider value={value}>
      {children}
    </AppErrorContext.Provider>
  );
}

export function useAppError(): AppErrorContextValue {
  const context = useContext(AppErrorContext);
  if (context === null) {
    throw new Error('useAppError must be used within an AppErrorProvider');
  }
  return context;
}

// --- Error boundary ---------------------------------------------------------

interface AppErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI shown once an error has been caught. */
  fallback?: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/**
 * Class-based error boundary that funnels render-time errors into the shared
 * application error store. Wrap the router (or any subtree) with it so a thrown
 * error surfaces the same banner as imperative `showApplicationError` calls.
 */
export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    showApplicationError(error);
  }

  render(): ReactNode {
    if (this.state.hasError && this.props.fallback !== undefined) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
