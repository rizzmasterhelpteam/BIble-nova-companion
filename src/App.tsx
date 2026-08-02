/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useState, useEffect } from "react";
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { HapticsProvider } from "./context/HapticsContext";
import { MobileViewportProvider } from "./context/MobileViewportContext";
import { VoiceSessionProvider } from "./context/VoiceSessionContext";
import { hideNativeSplashScreen } from "./lib/native/app";
import { isNativePlatform } from "./lib/native/platform";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeNativeApp } from "./lib/native/app";
import { startup } from "./lib/startup";
import { isNativeAndroidDevice } from "./hooks/usePerformanceMode";
import AppBootShell from "./components/AppBootShell";
import RouteContentFallback from "./components/RouteContentFallback";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Paywall from "./pages/Paywall";
import {
  shouldRedirectToPaywall,
  shouldWaitForSubscriptionResolution,
} from "./lib/subscriptionAccess";

const Breathe = lazy(() => import("./pages/Breathe"));
const Intentions = lazy(() => import("./pages/Intentions"));
const Confession = lazy(() => import("./pages/Confession"));

const ConnectivityNotice = () => {
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      className="fixed inset-x-3 bottom-3 z-[120] flex items-center justify-between gap-3 rounded-card border px-4 py-3 shadow-xl"
      role="alert"
      style={{
        backgroundColor: "var(--app-surface-elevated)",
        backgroundImage: "var(--app-shell-highlight)",
        borderColor: "var(--app-card-border)",
        color: "var(--app-text)",
      }}
    >
      <span className="text-sm">You’re offline. Reconnect to continue using Bible Nova Companion.</span>
      <button
        type="button"
        className="touch-target rounded-pill px-3 py-2 text-sm font-medium"
        style={{ background: "var(--app-accent)", color: "var(--app-accent-contrast)" }}
        onClick={() => window.location.reload()}
      >
        Retry
      </button>
    </div>
  );
};

const SubscriptionRefreshNotice = () => {
  const {
    isSubscribed,
    isSubscriptionResolved,
    subscriptionRevalidationError,
  } = useAuth();

  if (
    !isSubscribed ||
    !isSubscriptionResolved ||
    !subscriptionRevalidationError
  ) {
    return null;
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-3 z-40 rounded-card border px-4 py-3 text-sm shadow-xl"
      role="status"
      style={{
        bottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))",
        backgroundColor: "var(--app-surface-elevated)",
        backgroundImage: "var(--app-shell-highlight)",
        borderColor: "var(--app-card-border)",
        color: "var(--app-text)",
      }}
    >
      {subscriptionRevalidationError}
    </div>
  );
};

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const {
    user,
    isLoading,
    hasCompletedOnboarding,
    isSubscribed,
    isSubscriptionResolved,
  } = useAuth();
  const location = useLocation();
  const hasActiveIdentity = Boolean(user);
  
  if (isLoading) {
    return <AppBootShell message="Checking your secure session…" />;
  }

  if (!hasActiveIdentity) {
    return <Navigate to="/login" replace />;
  }

  if (!hasCompletedOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (
    shouldWaitForSubscriptionResolution({
      hasCompletedOnboarding,
      isSubscriptionResolved,
    })
  ) {
    return <AppBootShell message="Confirming your reflection space…" />;
  }

  // Every completed-onboarding account must have a verified server entitlement
  // before entering the main experience. Billing is still completed on Android.
  if (shouldRedirectToPaywall({
    hasCompletedOnboarding,
    isSubscribed,
    pathname: location.pathname,
  })) {
    return <Navigate to="/paywall" replace />;
  }

  if (
    hasCompletedOnboarding &&
    (location.pathname === "/onboarding" ||
      (location.pathname === "/paywall" && isSubscribed))
  ) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Gentle page entrance for auth-flow routes (login → onboarding → paywall).
// useReducedMotion is used here so it respects user preferences.
const PageFade = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="app-route-enter flex min-h-0 w-full flex-1 flex-col">
      {children}
    </div>
  );
};

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <Routes location={location}>
      <Route path="/login" element={<PageFade><Login /></PageFade>} />
      <Route path="/onboarding" element={<AuthGuard><PageFade><Onboarding /></PageFade></AuthGuard>} />
      <Route path="/paywall" element={<AuthGuard><PageFade><Paywall /></PageFade></AuthGuard>} />
      <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
        <Route index element={<Home />} />
        <Route path="breathe" element={<Breathe />} />
        <Route path="intentions" element={<Intentions />} />
        <Route path="confess" element={<Confession />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default function App() {
  const [hasPaintedReactShell, setHasPaintedReactShell] = useState(false);
  const isNativeApp = isNativePlatform();
  const Router = isNativeApp ? HashRouter : BrowserRouter;

  const handleBootShellPainted = useCallback(() => {
    startup.mark("first-frame-painted");
    startup.mark("initial-route-ready");
    setHasPaintedReactShell(true);
  }, []);

  useEffect(() => {
    startup.mark("app-mounted");
    void initializeNativeApp().catch((error) => {
      console.warn("Native initialization did not complete:", error);
      startup.mark("native-initialization-failed");
    });

    const root = document.documentElement;
    const isAndroid = isNativeAndroidDevice();
    root.classList.toggle("native-android", isAndroid);
    const mediaQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updatePerformanceMode = () => {
      root.classList.toggle("app-performance-mode", isAndroid || Boolean(mediaQuery?.matches));
    };

    updatePerformanceMode();
    mediaQuery?.addEventListener("change", updatePerformanceMode);

    return () => {
      mediaQuery?.removeEventListener("change", updatePerformanceMode);
      root.classList.remove("native-android", "app-performance-mode");
    };
  }, [isNativeApp]);

  useEffect(() => {
    const safetyTimer = window.setTimeout(() => {
      setHasPaintedReactShell((hasPainted) => {
        if (!hasPainted) startup.mark("native-splash-safety-timeout");
        return true;
      });
    }, 6000);

    return () => window.clearTimeout(safetyTimer);
  }, []);

  useEffect(() => {
    if (!hasPaintedReactShell) return;
    startup.mark("native-splash-hide-start");
    void hideNativeSplashScreen().then(() => {
      startup.mark("native-splash-hide-complete");
      startup.mark("native-splash-hidden");
    });
  }, [hasPaintedReactShell]);

  return (
    <ThemeProvider>
      <MobileViewportProvider>
        <HapticsProvider>
          <AuthProvider>
            <VoiceSessionProvider>
              <ErrorBoundary>
                <Router>
                  <Suspense fallback={<RouteContentFallback />}>
                    <AnimatedRoutes />
                  </Suspense>
                </Router>
              </ErrorBoundary>
            </VoiceSessionProvider>
            <SubscriptionRefreshNotice />
          </AuthProvider>
        </HapticsProvider>

        {!hasPaintedReactShell && <AppBootShell onPainted={handleBootShellPainted} />}

        <ConnectivityNotice />
      </MobileViewportProvider>
    </ThemeProvider>
  );
}
