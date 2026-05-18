import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[100dvh] w-full flex-col items-center justify-center p-6 text-center" style={{ background: "var(--app-page-bg)", color: "var(--app-text)" }}>
          <div className="mb-6 rounded-full bg-red-100 p-4 dark:bg-red-900/30">
            <AlertCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
          </div>
          <h1 className="mb-2 text-2xl font-semibold" style={{ color: "var(--app-heading)" }}>Something went wrong</h1>
          <p className="mb-8 text-sm opacity-80 max-w-sm">
            We encountered an unexpected error. Please restart the app or clear your cache.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 active:scale-95"
            style={{ background: "var(--app-accent)" }}
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
