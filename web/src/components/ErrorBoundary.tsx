import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, any uncaught render error anywhere in the tree unmounts the whole app to a
// blank white screen with no visible clue -- this turns that into a readable message instead.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-lg px-4 py-10 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
