import { Component, type ErrorInfo, type ReactNode } from 'react';

interface EChartLoadErrorBoundaryProps {
  children: ReactNode;
  height: number;
}

interface EChartLoadErrorBoundaryState {
  failed: boolean;
}

/**
 * A stale tab can ask a freshly deployed web container for an old hashed
 * ECharts chunk. Keep that operational failure inside the dashboard widget
 * instead of letting React Router render its technical default error page.
 */
export class EChartLoadErrorBoundary extends Component<
  EChartLoadErrorBoundaryProps,
  EChartLoadErrorBoundaryState
> {
  override state: EChartLoadErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): EChartLoadErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {
    // The visible fallback is intentional. Avoid logging the exception here:
    // React Router already records route errors, while this boundary turns a
    // recoverable stale-build failure into an explicit user action.
  }

  override render() {
    if (this.state.failed) {
      return (
        <div
          role="alert"
          style={{ minHeight: this.props.height }}
          className="flex w-full flex-col items-center justify-center gap-3 rounded border border-amber-300 bg-amber-50 p-4 text-center text-sm text-amber-950"
        >
          <p>No se ha podido cargar el gráfico. Actualiza la pantalla e inténtalo de nuevo.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-amber-700 px-3 py-2 font-medium text-white hover:bg-amber-800"
          >
            Actualizar pantalla
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
