import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { trackCaughtError } from "@/lib/analytics";

interface State {
  error: Error | null;
}

class ErrorBoundaryImpl extends Component<{
  children: ReactNode;
  t: (key: string) => string;
}, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Runs before React re-dispatches the same error to window.onerror, so this
    // (fatal) report registers the error and the global handler skips it.
    trackCaughtError(error, true);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-3 p-8">
          <p className="text-sm font-medium">{this.props.t("errorBoundary.title")}</p>
          <p className="max-w-lg text-center text-xs text-muted-foreground">
            {this.state.error.message}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => this.setState({ error: null })}>
              {this.props.t("errorBoundary.retry")}
            </Button>
            {/* Escape hatch when the error is deterministic and "Try again" just
                re-renders into the same crash — a full reload resets everything. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              {this.props.t("errorBoundary.reload")}
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation("components");
  return <ErrorBoundaryImpl t={t}>{children}</ErrorBoundaryImpl>;
}
