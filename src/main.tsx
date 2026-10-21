// Position is load-bearing: the transport must be installed before any other
// module's evaluation can reach an invoke() — this import stays FIRST.
import "@/lib/transport/install-desktop";
import { QueryClientProvider } from "@tanstack/react-query";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorDialog } from "@/features/errors/ErrorDialog";
import { initAnalytics, trackCaughtError } from "@/lib/analytics";
import {
  changeAppLanguage,
  getAppLanguage,
  i18n,
  initializeI18n,
  syncNativeLanguage,
} from "@/lib/i18n";
import { calmTransition } from "@/lib/motion";
import { queryClient } from "@/lib/query-client";
import { loadSettings } from "@/lib/settings/api";
import { commitTheme, initTheme } from "@/lib/theme";
import App from "./App.tsx";
import "./App.css";
// Position is load-bearing: the vendored diff-view CSS must be imported plain
// (UNLAYERED) and LAST, so its rules win utility-name ties on the library's own
// markup — e.g. the add-widget "+" button reveals via `group-hover:visible`,
// which our `.invisible` utility would otherwise beat if this sheet were demoted
// into a cascade layer. Its two harmful `color: initial` slot-resets are stripped
// at build time instead (see vite.config.ts), so no layering is needed.
import "@git-diff-view/react/styles/diff-view.css";

// Apply the saved theme (System / Light / Dark / Slate) before first paint,
// reading a localStorage mirror synchronously so a saved override doesn't flash
// through the OS default; the authoritative store value reconciles below.
initTheme();

// Boot analytics after settings load — never blocks the render. Session replay
// stays off unless the user opted in (recordReplay).
loadSettings()
  .then((s) => {
    // Reconcile the flash-mirror against the authoritative persisted value.
    commitTheme(s.theme);
    // The early native-menu sync may have run before Tauri setup finished.
    // Retry after the authoritative settings store is available, even when the
    // UI locale already matches the flash mirror.
    syncNativeLanguage(s.language);
    if (s.language !== getAppLanguage()) {
      void changeAppLanguage(s.language).catch(() => undefined);
    }
    initAnalytics(s.analyticsEnabled, s.recordReplay);
  })
  .catch(() => {
    // Analytics is best-effort — never surface its failures.
  });

// Wire up unhandled errors to PostHog after the page loads. trackCaughtError
// dedupes by identity, so errors already reported by an ErrorBoundary (fatal)
// aren't re-counted here as non-fatal.
window.addEventListener("error", (e) => {
  trackCaughtError(e.error ?? e.message, false);
});
window.addEventListener("unhandledrejection", (e) => {
  trackCaughtError(e.reason, false);
});

const root = createRoot(document.getElementById("root")!);

function renderApp() {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <ErrorBoundary>
              <Suspense
                fallback={<div className="min-h-full" aria-busy="true" />}
              >
                {/* One calm motion baseline: reducedMotion="user" disables transform/
                    layout motion for users who ask (opacity still fades); LazyMotion +
                    `m` keeps the bundle small (use m.*, never motion.*). */}
                <LazyMotion features={domAnimation} strict>
                  <MotionConfig
                    reducedMotion="user"
                    transition={calmTransition}
                  >
                    <App />
                  </MotionConfig>
                </LazyMotion>
                <Toaster position="bottom-right" closeButton />
                <ErrorDialog />
              </Suspense>
            </ErrorBoundary>
          </TooltipProvider>
        </I18nextProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

// Load the first localized resources before React paints. Later feature
// namespaces load on demand and suspend inside this root boundary while their
// local JSON chunks resolve.
void initializeI18n().then(renderApp, renderApp);
