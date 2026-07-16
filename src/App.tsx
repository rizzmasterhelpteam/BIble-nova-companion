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
import { AnimatePresence, motion } from "motion/react";
import { hideNativeSplashScreen } from "./lib/native/app";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getNativePlatform, isNativePlatform } from "./lib/native/platform";

const Layout = lazy(() => import("./components/Layout"));
const Chat = lazy(() => import("./pages/Chat"));
const Breathe = lazy(() => import("./pages/Breathe"));
const Intentions = lazy(() => import("./pages/Intentions"));
const Confession = lazy(() => import("./pages/Confession"));
const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Paywall = lazy(() => import("./pages/Paywall"));

const FullScreenLoader = () => <SplashScreen />;

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
        background: "var(--app-panel-strong)",
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
  const { user, isGuest, isLoading, hasCompletedOnboarding } = useAuth();
  const location = useLocation();
  const hasActiveIdentity = Boolean(user || isGuest);
  
  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!hasActiveIdentity) {
    return <Navigate to="/login" replace />;
  }

  if (!hasCompletedOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }
  
  if (hasCompletedOnboarding && location.pathname === "/onboarding") {
     return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

// Page fade wrapper — opacity only (no layout thrash on Android)
const PageFade = ({ children }: { children: React.ReactNode }) => {
  const isAndroid = isNativePlatform() && getNativePlatform() === "android";

  return (
    <motion.div
      initial={isAndroid ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: isAndroid ? 0 : 0.18, ease: "linear" }}
      style={{ display: "contents" }}
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
    <AnimatePresence mode="wait" initial={false}>
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
    const root = document.documentElement;
    const isAndroid = isNativePlatform() && getNativePlatform() === "android";
    root.classList.toggle("native-android", isAndroid);
    return () => root.classList.remove("native-android");
  }, []);

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    const isAndroid = isNativePlatform() && getNativePlatform() === "android";
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, prefersReducedMotion ? 250 : isAndroid ? 350 : 800);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let frameOne = 0;
    let frameTwo = 0;

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        setHasRenderedAppFrame(true);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, []);

  useEffect(() => {
    if (!hasRenderedAppFrame || showSplash) return;
    void hideNativeSplashScreen();
  }, [hasRenderedAppFrame, showSplash]);

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

        <AnimatePresence>
          {showSplash && (
            <SplashScreen key="splash" />
          )}
        </AnimatePresence>
        <ConnectivityNotice />
      </MobileViewportProvider>
    </ThemeProvider>
  );
}
