/**
 * P12-T12.4 (D-055) — Simple React ErrorBoundary for Studio.
 * Catches render errors, reports to Sentry, and shows a recovery UI.
 */
import { Component, type ReactNode, type ErrorInfo } from "react";
import { captureException } from "../../client/sentry/index.js";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error);
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{ padding: "2rem", maxWidth: "40rem", margin: "4rem auto" }}>
          <h2>Something went wrong</h2>
          <p style={{ color: "#666" }}>An error occurred in the Studio.</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: "1rem", padding: "0.5rem 1rem", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
