/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useState, useEffect } from "react";
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { HapticsProvider } from "./context/HapticsContext";
import { MobileViewportProvider } from "./context/MobileViewportContext";
import { SplashScreen } from "./components/SplashScreen";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { hideNativeSplashScreen } from "./lib/native/app";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getNativePlatform, isNativePlatform } from "./lib/native/platform";
import { initializeNativeApp } from "./lib/native/app";
import { startup } from "./lib/startup";

const Layout = lazy(() => import("./components/Layout"));
const Chat = lazy(() => import("./pages/Chat"));
const Breathe = lazy(() => import("./pages/Breathe"));
const Intentions = lazy(() => import("./pages/Intentions"));
const Confession = lazy(() => import("./pages/Confession"));
const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Paywall = lazy(() => import("./pages/Paywall"));

// Loading fallbacks reuse the splash artwork without starting another animation.
// Only the app-level splash gets an entrance transition.
const FullScreenLoader = () => <SplashScreen animated={false} />;

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

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, hasCompletedOnboarding, isSubscribed } = useAuth();
  const location = useLocation();
  const hasActiveIdentity = Boolean(user);
  const isAndroidNative = isNativePlatform() && getNativePlatform() === "android";
  
  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!hasActiveIdentity) {
    return <Navigate to="/login" replace />;
  }

  if (!hasCompletedOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  // The native Android app must have an active entitlement before entering
  // the main experience. The web app remains accessible because its current
  // billing flow is Android-only.
  if (
    isAndroidNative &&
    hasCompletedOnboarding &&
    !isSubscribed &&
    location.pathname !== "/paywall"
  ) {
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
  const prefersReducedMotion = useReducedMotion();
  return (
    <motion.div
      style={{ display: "contents" }}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
};

const AnimatedRoutes = () => {
  const location = useLocation();
  // Only animate the top-level auth flow routes, not in-app sub-routes
  const topKey = location.pathname.startsWith("/") 
    ? ["login","onboarding","paywall"].find(r => location.pathname === `/${r}`) ?? "app"
    : "app";

  return (
    <AnimatePresence mode="sync" initial={false}>
      <React.Fragment key={topKey}>
      <Routes location={location}>
        <Route path="/login" element={<PageFade><Login /></PageFade>} />
        <Route path="/onboarding" element={<AuthGuard><PageFade><Onboarding /></PageFade></AuthGuard>} />
        <Route path="/paywall" element={<AuthGuard><PageFade><Paywall /></PageFade></AuthGuard>} />
        <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
          <Route index element={<Chat />} />
          <Route path="breathe" element={<Breathe />} />
          <Route path="intentions" element={<Intentions />} />
          <Route path="confess" element={<Confession />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </React.Fragment>
    </AnimatePresence>
  );
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const [hasRenderedAppFrame, setHasRenderedAppFrame] = useState(false);
  const Router = isNativePlatform() ? HashRouter : BrowserRouter;

  useEffect(() => {
    startup.mark("app-mounted");
    void initializeNativeApp().catch((error) => {
      console.warn("Native initialization did not complete:", error);
      startup.mark("native-initialization-failed");
    });

    const root = document.documentElement;
    const isAndroid = isNativePlatform() && getNativePlatform() === "android";
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
  }, []);

  useEffect(() => {
    if (!hasRenderedAppFrame) return;

    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    const isAndroid = isNativePlatform() && getNativePlatform() === "android";
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, prefersReducedMotion ? 200 : isAndroid ? 1000 : 1800);

    return () => clearTimeout(timer);
  }, [hasRenderedAppFrame]);

  useEffect(() => {
    let frameOne = 0;
    let frameTwo = 0;

    frameOne = window.requestAnimationFrame(() => {
        frameTwo = window.requestAnimationFrame(() => {
          setHasRenderedAppFrame(true);
          startup.mark("first-frame-painted");
        });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, []);

  useEffect(() => {
    if (!hasRenderedAppFrame) return;
    void hideNativeSplashScreen().then(() => {
      startup.mark("native-splash-hidden");
    });
  }, [hasRenderedAppFrame]);

  return (
    <ThemeProvider>
      <MobileViewportProvider>
        <HapticsProvider>
          <AuthProvider>
            <ErrorBoundary>
              <Router>
                <Suspense fallback={<FullScreenLoader />}>
                  <AnimatedRoutes />
                </Suspense>
              </Router>
            </ErrorBoundary>
          </AuthProvider>
        </HapticsProvider>

        <AnimatePresence mode="wait">
          {showSplash && (
            <motion.div key="splash" style={{ position: "fixed", inset: 0, zIndex: 100 }}>
              <SplashScreen />
            </motion.div>
          )}
        </AnimatePresence>
        <ConnectivityNotice />
      </MobileViewportProvider>
    </ThemeProvider>
  );
}
