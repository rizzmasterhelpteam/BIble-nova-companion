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
import { AnimatePresence } from "motion/react";
import { hideNativeSplashScreen } from "./lib/native/app";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isNativePlatform } from "./lib/native/platform";

const Layout = lazy(() => import("./components/Layout"));
const Chat = lazy(() => import("./pages/Chat"));
const Breathe = lazy(() => import("./pages/Breathe"));
const Intentions = lazy(() => import("./pages/Intentions"));
const Confession = lazy(() => import("./pages/Confession"));
const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Paywall = lazy(() => import("./pages/Paywall"));

const FullScreenLoader = () => <SplashScreen />;

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, hasCompletedOnboarding, isSubscribed } = useAuth();
  const location = useLocation();
  
  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Enforce flow: Onboarding -> Paywall -> Main App
  if (!hasCompletedOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (hasCompletedOnboarding && !isSubscribed && location.pathname !== "/paywall" && location.pathname !== "/onboarding") {
    return <Navigate to="/paywall" replace />;
  }
  
  // Prevent users from going back to paywall or onboarding if already in the app properly
  if (hasCompletedOnboarding && isSubscribed && (location.pathname === "/onboarding" || location.pathname === "/paywall")) {
     return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default function App() {
  const [showSplash, setShowSplash] = useState(true);
  const Router = isNativePlatform() ? HashRouter : BrowserRouter;

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;

    const timer = setTimeout(() => {
      setShowSplash(false);
    }, prefersReducedMotion ? 250 : 800);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    let frameOne = 0;
    let frameTwo = 0;

    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        void hideNativeSplashScreen();
      });
    });

    return () => {
      window.cancelAnimationFrame(frameOne);
      window.cancelAnimationFrame(frameTwo);
    };
  }, []);

  return (
    <ThemeProvider>
      <MobileViewportProvider>
        <HapticsProvider>
          <AuthProvider>
            <ErrorBoundary>
              <Router>
                <Suspense fallback={<FullScreenLoader />}>
                  <Routes>
                    <Route path="/login" element={<Login />} />

                    {/* Guarded App Routes */}
                    <Route path="/onboarding" element={<AuthGuard><Onboarding /></AuthGuard>} />
                    <Route path="/paywall" element={<AuthGuard><Paywall /></AuthGuard>} />

                    <Route path="/" element={<AuthGuard><Layout /></AuthGuard>}>
                      <Route index element={<Chat />} />
                      <Route path="breathe" element={<Breathe />} />
                      <Route path="intentions" element={<Intentions />} />
                      <Route path="confess" element={<Confession />} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
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
      </MobileViewportProvider>
    </ThemeProvider>
  );
}
