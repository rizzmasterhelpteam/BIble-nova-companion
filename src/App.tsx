/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Loader2 } from "lucide-react";
import { ThemeProvider } from "./context/ThemeContext";
import { HapticsProvider } from "./context/HapticsContext";

const Layout = lazy(() => import("./components/Layout"));
const Chat = lazy(() => import("./pages/Chat"));
const Breathe = lazy(() => import("./pages/Breathe"));
const Intentions = lazy(() => import("./pages/Intentions"));
const Confession = lazy(() => import("./pages/Confession"));
const Login = lazy(() => import("./pages/Login"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Paywall = lazy(() => import("./pages/Paywall"));

const FullScreenLoader = () => (
  <div className="app-screen flex h-[100dvh] w-full items-center justify-center">
    <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--app-accent)" }} />
  </div>
);

const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { user, isLoading, isGuest, hasCompletedOnboarding, isSubscribed } = useAuth();
  const location = useLocation();
  
  if (isLoading) {
    return <FullScreenLoader />;
  }

  if (!user && !isGuest) {
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
  if (isSubscribed && (location.pathname === "/onboarding" || location.pathname === "/paywall")) {
     return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default function App() {
  return (
    <ThemeProvider>
      <HapticsProvider>
        <AuthProvider>
          <BrowserRouter>
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
          </BrowserRouter>
        </AuthProvider>
      </HapticsProvider>
    </ThemeProvider>
  );
}
