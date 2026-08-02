/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useCallback, useState, useEffect } from "react";
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { EntitlementProvider, useEntitlement } from "./context/EntitlementContext";
import { AppStorageProvider } from "./context/AppStorageContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { HapticsProvider } from "./context/HapticsContext";
import { MobileViewportProvider } from "./context/MobileViewportContext";
import { VoiceSessionProvider } from "./context/VoiceSessionContext";
import { hideNativeSplashScreen } from "./lib/native/app";
import { isNativePlatform } from "./lib/native/platform";
import { getPlatformAdapter } from "./lib/native/platform";
import { isNativeRuntimeCompatible } from "./lib/native/runtime";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initializeNativeApp } from "./lib/native/app";
import { startup } from "./lib/startup";
import { isNativeAndroidDevice } from "./hooks/usePerformanceMode";
import AppBootShell from "./components/AppBootShell";
import RouteContentFallback from "./components/RouteContentFallback";
import UpdateRequiredScreen from "./components/UpdateRequiredScreen";
import ToastViewport from "./components/ToastViewport";
import ConnectivityStatus from "./components/ConnectivityStatus";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import Paywall from "./pages/Paywall";

const Breathe = lazy(() => import("./pages/Breathe"));
const Intentions = lazy(() => import("./pages/Intentions"));
const Confession = lazy(() => import("./pages/Confession"));

// Gentle page entrance for auth-flow routes (login → onboarding → paywall).
// useReducedMotion is used here so it respects user preferences.
const PageFade = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="app-route-enter flex min-h-0 w-full flex-1 flex-col">
      {children}
    </div>
  );
};

const AuthoritativeAuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, hasCompletedOnboarding } = useAuth();
  const { snapshot, isRefreshing, refresh } = useEntitlement();
  const location = useLocation();

  if (isLoading) return <AppBootShell message="Checking your secure session..." />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasCompletedOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (snapshot.state === "initializing" || (snapshot.state === "refreshing" && !snapshot.active)) {
    return <AppBootShell message={isRefreshing ? "Confirming your reflection space..." : "Checking your membership..."} />;
  }
  if (snapshot.state === "unknown" && !snapshot.active) {
    return <EntitlementUnavailableScreen error={snapshot.error} onRetry={() => void refresh(true)} />;
  }
  if (!snapshot.active && snapshot.state === "inactive" && location.pathname !== "/paywall") {
    return <Navigate to="/paywall" replace />;
  }
  if (hasCompletedOnboarding && (location.pathname === "/onboarding" || location.pathname === "/paywall")) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
};

const EntitlementUnavailableScreen = ({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) => (
  <div className="app-screen flex min-h-full flex-1 items-center justify-center px-6 py-12 text-center">
    <div className="app-panel w-full max-w-sm rounded-card border p-6 shadow-sm">
      <p className="app-kicker">Membership check</p>
      <h1 className="app-heading mt-3 text-2xl font-serif">We could not verify your access.</h1>
      <p className="app-muted mt-3 text-sm leading-relaxed">
        A temporary verification error will not move you to a free plan. Check again when your connection is available.
      </p>
      {error && <p className="app-muted mt-2 text-xs">{error}</p>}
      <button
        type="button"
        className="touch-target mt-5 rounded-pill px-5 py-3 text-sm font-semibold"
        style={{ background: "var(--app-accent)", color: "var(--app-accent-contrast)" }}
        onClick={onRetry}
      >
        Retry membership check
      </button>
    </div>
  </div>
);

const AnimatedRoutes = () => {
  const location = useLocation();

  return (
    <Routes location={location}>
      <Route path="/login" element={<PageFade><Login /></PageFade>} />
      <Route path="/onboarding" element={<AuthoritativeAuthGuard><PageFade><Onboarding /></PageFade></AuthoritativeAuthGuard>} />
      <Route path="/paywall" element={<AuthoritativeAuthGuard><PageFade><Paywall /></PageFade></AuthoritativeAuthGuard>} />
      <Route path="/" element={<AuthoritativeAuthGuard><Layout /></AuthoritativeAuthGuard>}>
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
  const nativeRuntime = getPlatformAdapter().runtime;
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
    <AppStorageProvider>
      <ThemeProvider>
      {!isNativeRuntimeCompatible(nativeRuntime) ? (
        <UpdateRequiredScreen runtime={nativeRuntime} />
      ) : (
        <ToastProvider>
          <MobileViewportProvider>
            <HapticsProvider>
              <AuthProvider>
                <EntitlementProvider>
                  <VoiceSessionProvider>
                    <ErrorBoundary>
                      <Router>
                        <Suspense fallback={<RouteContentFallback />}>
                          <AnimatedRoutes />
                        </Suspense>
                      </Router>
                    </ErrorBoundary>
                  </VoiceSessionProvider>
                </EntitlementProvider>
              </AuthProvider>
            </HapticsProvider>

            {!hasPaintedReactShell && <AppBootShell onPainted={handleBootShellPainted} />}
            <ToastViewport />
            <ConnectivityStatus />
          </MobileViewportProvider>
        </ToastProvider>
      )}
      </ThemeProvider>
    </AppStorageProvider>
  );
}
