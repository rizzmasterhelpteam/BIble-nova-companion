import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Check, Star, AlertCircle, ShieldCheck, Sparkles, HeartHandshake, Lock, BookOpen } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { useMobileViewport } from "../context/MobileViewportContext";
import { apiFetch } from "../lib/apiClient";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  getConfiguredProductIdForIdentifier,
  getConfiguredPlanIdForProduct,
  getConfiguredMonthlyOfferId,
  getCurrentOffering,
  openSubscriptionManagement,
  purchasePackage as purchaseNativePackage,
  restorePurchases,
  type SubscriptionPackage,
} from "../lib/native/purchases";

type Plan = "monthly" | "yearly";

type NativePurchaseTransaction = {
  productIdentifier?: string;
  orderId?: string;
  purchaseToken?: string;
};

type NativeSubscriptionSyncResponse = {
  subscription?: {
    source?: string;
    productId?: string;
    planId?: string;
  };
  error?: string;
};

type ApiStatusResponse = {
  nativeSubscriptionSyncReady?: boolean;
};

export default function Paywall() {
  useDocumentTitle("Subscribe | Bible Nova Companion");
  const { isShortPhone } = useMobileViewport();
  const prefersReducedMotion = useReducedMotion();
  const isPerformanceMode = Boolean(
    prefersReducedMotion ||
      (isNativePlatform() && getNativePlatform() === "android") ||
      (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches),
  );
  const nativeStoreAvailable = isNativePlatform() && getNativePlatform() === "android";
  const [selectedPlan, setSelectedPlan] = useState<Plan>("yearly");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iapPackages, setIapPackages] = useState<Partial<Record<Plan, SubscriptionPackage>>>({});
  const [iapReady, setIapReady] = useState(false);
  const [isLoadingOffering, setIsLoadingOffering] = useState(nativeStoreAvailable);
  const [iapLoadError, setIapLoadError] = useState<string | null>(null);
  const [subscriptionSyncReady, setSubscriptionSyncReady] = useState<boolean | null>(null);
  const { isSubscribed, session, subscribe, user } = useAuth();
  const navigate = useNavigate();
  const yearlyRef = useRef<HTMLButtonElement | null>(null);
  const monthlyRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isSubscribed) return;
    navigate("/", { replace: true });
  }, [isSubscribed, navigate]);

  useEffect(() => {
    if (!nativeStoreAvailable) return;
    let isMounted = true;
    setIsLoadingOffering(true);
    setIapLoadError(null);
    getCurrentOffering()
      .then((offering) => {
        if (!isMounted) return;
        if (!offering) {
          setIapReady(false);
          setIapPackages({});
          setIapLoadError(
            "Native subscription products are not configured. Set the IAP product IDs and Android base plan IDs before shipping.",
          );
          return;
        }
        const nextPackages = {
          monthly: offering.monthly || undefined,
          yearly: offering.annual || undefined,
        };
        const hasPackages = Boolean(nextPackages.monthly || nextPackages.yearly);
        setIapPackages(nextPackages);
        setIapReady(hasPackages);
        if (!hasPackages) {
          setIapLoadError(
            "No native subscription products were returned. Check the IAP product IDs, Android base plan IDs, and store product status.",
          );
        }
      })
      .catch((err) => {
        console.warn("Could not load native offerings:", err);
        if (isMounted) {
          setIapReady(false);
          setIapLoadError(err instanceof Error ? err.message : "Could not load native subscription products.");
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingOffering(false);
      });

    return () => { isMounted = false; };
  }, [nativeStoreAvailable]);

  useEffect(() => {
    if (!nativeStoreAvailable) return;
    let isMounted = true;
    apiFetch("/api/status")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as ApiStatusResponse;
      })
      .then((status) => {
        if (!isMounted || !status || typeof status.nativeSubscriptionSyncReady !== "boolean") return;
        setSubscriptionSyncReady(status.nativeSubscriptionSyncReady);
        if (!status.nativeSubscriptionSyncReady) {
          setIapLoadError(
            "Premium purchases are temporarily unavailable while secure Google Play verification is being configured. Please try again later.",
          );
        }
      })
      .catch(() => {});
    return () => { isMounted = false; };
  }, [nativeStoreAvailable]);

  useEffect(() => {
    if (!nativeStoreAvailable || isLoadingOffering || iapPackages[selectedPlan]) return;
    if (iapPackages.yearly) setSelectedPlan("yearly");
    else if (iapPackages.monthly) setSelectedPlan("monthly");
  }, [iapPackages, isLoadingOffering, nativeStoreAvailable, selectedPlan]);

  const selectedNativePackage = iapPackages[selectedPlan];
  const monthlyPrice = useMemo(
    () =>
      nativeStoreAvailable
        ? iapPackages.monthly?.baseProduct?.priceString ||
          iapPackages.monthly?.product.priceString ||
          (isLoadingOffering ? "Loading..." : "Unavailable")
        : "$9.99",
    [iapPackages.monthly, isLoadingOffering, nativeStoreAvailable],
  );

  const yearlyPrice = useMemo(
    () =>
      nativeStoreAvailable
        ? iapPackages.yearly?.baseProduct?.priceString ||
          iapPackages.yearly?.product.priceString ||
          (isLoadingOffering ? "Loading..." : "Unavailable")
        : "$89.99",
    [iapPackages.yearly, isLoadingOffering, nativeStoreAvailable],
  );

  const configuredMonthlyOfferId = getConfiguredMonthlyOfferId();
  const monthlyTrialConfigured = configuredMonthlyOfferId === "trial";
  const monthlyTrialSelected =
    monthlyTrialConfigured && iapPackages.monthly?.product.offerId === configuredMonthlyOfferId;
  const monthlyTrialLabel = nativeStoreAvailable
    ? "7-day first-time subscription trial"
    : "7-day first-time subscription trial on Android";

  const nativeSelectedPlanUnavailable = nativeStoreAvailable && !isLoadingOffering && !selectedNativePackage;
  const canSubscribe =
    !isLoading &&
    !isLoadingOffering &&
    nativeStoreAvailable &&
    subscriptionSyncReady !== false &&
    Boolean(selectedNativePackage);
  const selectedPlanLabel = selectedPlan === "yearly" ? "Yearly" : "Monthly";

  const handleSubscribe = async () => {
    setError(null);
    if (!canSubscribe) return;
    setIsLoading(true);
    try {
      if (!selectedNativePackage) {
        throw new Error(
          iapReady
            ? "This plan is not available in Google Play yet."
            : "Google Play subscriptions are not configured yet. Add the product IDs, base plans, and Play Console products.",
        );
      }
      const purchase = await purchaseNativePackage(selectedNativePackage);
      await syncNativeSubscriptionForAccount(
        purchase,
        selectedNativePackage.androidBasePlanId,
        selectedNativePackage.productId,
      );
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase could not be completed.");
    } finally {
      setIsLoading(false);
    }
  };

  const getFreshAccessToken = async () => {
    if (!isSupabaseConfigured) return session?.access_token || null;
    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn("Could not refresh session before syncing subscription:", error.message);
    return data.session?.access_token || session?.access_token || null;
  };

  const syncNativeSubscriptionForAccount = async (
    purchase: NativePurchaseTransaction,
    planId?: string,
    expectedProductId?: string,
  ) => {
    if (!user) throw new Error("Sign in with Google or email before linking Google Play premium.");
    const accessToken = await getFreshAccessToken();
    if (!accessToken) throw new Error("Your session expired. Please sign in again before linking Google Play premium.");
    const productId = purchase.productIdentifier
      ? getConfiguredProductIdForIdentifier(purchase.productIdentifier) || purchase.productIdentifier.trim()
      : expectedProductId?.trim();
    if (!productId) throw new Error("The native purchase was missing its product ID.");
    const response = await apiFetch("/api/subscription/native-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        productId,
        planId,
        orderId: purchase.orderId?.trim() || undefined,
        purchaseToken: purchase.purchaseToken?.trim() || undefined,
        platform: "android",
      }),
    });
    const data = (await response.json().catch(() => ({}))) as NativeSubscriptionSyncResponse;
    if (!response.ok) throw new Error(data.error || "Could not link this subscription to your account.");
    subscribe("native_google_play");
    return data.subscription;
  };

  const handleRestorePurchases = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const purchases = await restorePurchases();
      const restoredPurchase =
        (purchases.find((p) => Boolean((p as NativePurchaseTransaction).productIdentifier)) ||
          purchases[0]) as NativePurchaseTransaction | undefined;
      if (!restoredPurchase?.productIdentifier) throw new Error("Could not determine which subscription to restore.");
      const restoredProductId = getConfiguredProductIdForIdentifier(restoredPurchase.productIdentifier);
      if (!restoredProductId) throw new Error("The restored purchase does not match a configured subscription.");
      await syncNativeSubscriptionForAccount(
        restoredPurchase,
        getConfiguredPlanIdForProduct(restoredProductId),
        restoredProductId,
      );
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore purchases.");
      setIsLoading(false);
    }
  };

  const handleManageSubscriptions = async () => {
    setError(null);
    setIsLoading(true);
    try {
      await openSubscriptionManagement();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open subscription management.");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlanKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      if (nativeStoreAvailable && !iapPackages.yearly) return;
      setSelectedPlan("yearly");
      yearlyRef.current?.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      if (nativeStoreAvailable && !iapPackages.monthly) return;
      setSelectedPlan("monthly");
      monthlyRef.current?.focus();
    }
  };

  const features = [
    { text: "Unlimited scripture-grounded reflections", icon: <BookOpen className="w-5 h-5" style={{ color: "#f59e0b" }} /> },
    { text: "Personalized prayers & practical steps", icon: <HeartHandshake className="w-5 h-5" style={{ color: "#f43f5e" }} /> },
    { text: "A private, distraction-free space", icon: <Lock className="w-5 h-5" style={{ color: "#10b981" }} /> },
  ];

  const yearlyMonthly = useMemo(() => {
    if (nativeStoreAvailable && iapPackages.yearly) return null;
    return "≈ $7.50/mo";
  }, [nativeStoreAvailable, iapPackages.yearly]);

  // Show pricing UI on web for preview/demo — only gate subscribe action on native
  const showPricingCards = true;

  const containerVariants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 18 },
    show: { opacity: 1, y: 0, transition: { duration: 0.44, ease: [0.22, 1, 0.36, 1] } },
  };

  return (
    <div
      className="relative w-full text-white"
      style={{ minHeight: "100dvh", overflowY: "auto", overflowX: "hidden", background: "#0F0F12" }}
    >
      {/* Blurred infinite orbs are desktop-only; they cause sustained GPU work on touch devices. */}
      {!isPerformanceMode && (
        <>
          <motion.div
            animate={{ scale: [1, 1.2, 1], opacity: [0.25, 0.42, 0.25], x: [0, 50, 0], y: [0, -30, 0] }}
            transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            className="pointer-events-none absolute -top-[20%] -left-[10%] h-[600px] w-[600px] rounded-full"
            style={{ background: "rgba(245,158,11,0.08)", filter: "blur(120px)" }}
          />
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.3, 0.15], x: [0, -40, 0], y: [0, 40, 0] }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear", delay: 2 }}
            className="pointer-events-none absolute top-[40%] -right-[20%] h-[500px] w-[500px] rounded-full"
            style={{ background: "rgba(239,68,68,0.06)", filter: "blur(100px)" }}
          />
        </>
      )}

      <div
        className={cn(
          "relative z-10 flex w-full flex-col items-center justify-start px-4 pb-4 sm:pb-12",
          isShortPhone ? "" : "pt-8 sm:pt-12",
        )}
        style={{ paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "2rem" : "3rem"})` }}
      >
        <motion.div
          variants={isPerformanceMode ? undefined : containerVariants}
          initial={isPerformanceMode ? { opacity: 1 } : "hidden"}
          animate={isPerformanceMode ? undefined : "show"}
          className="w-full max-w-md mx-auto"
        >
          {/* Header Section */}
          <motion.div variants={isPerformanceMode ? undefined : itemVariants} className="flex flex-col items-center text-center mb-8">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase mb-4 text-amber-400"
              style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.22)" }}>
              <Sparkles className="w-3.5 h-3.5" />
              Bible Nova Premium
            </span>
            
            <h1 className="text-3xl sm:text-4xl font-serif font-medium mb-3 tracking-tight"
              style={{ background: "linear-gradient(180deg, #fff, rgba(255,255,255,0.6))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Deepen Your Journey
            </h1>
            <p className="text-[15px] leading-relaxed max-w-[300px]" style={{ color: "rgba(255,255,255,0.55)" }}>
              Unlock unlimited personalized reflections, prayers, and a distraction-free spiritual sanctuary.
            </p>
          </motion.div>

          {/* Premium Features */}
          <motion.div variants={isPerformanceMode ? undefined : itemVariants} className="space-y-3 mb-8">
            {features.map((feature) => (
              <div key={feature.text}
                className="flex items-center gap-4 rounded-2xl p-4"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex-shrink-0 p-2 rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }}>
                  {feature.icon}
                </div>
                <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.88)" }}>{feature.text}</p>
              </div>
            ))}
          </motion.div>

          {/* Android unavailable notice (only shown on web when native store unavailable) */}
          {!nativeStoreAvailable && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants}
              className="mb-6 flex items-start gap-3 rounded-2xl p-4"
              style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.18)" }}>
              <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm leading-relaxed" style={{ color: "rgba(245,158,11,0.9)" }}>
                Subscriptions are managed via the Android app. Download it on Google Play to subscribe.
              </p>
            </motion.div>
          )}

          {/* Pricing Cards */}
          {showPricingCards && (
            <motion.div role="radiogroup" aria-label="Subscription plan" variants={isPerformanceMode ? undefined : itemVariants} className="mb-8 space-y-3">
              {/* Yearly — dominant */}
              <button
                ref={yearlyRef}
                onClick={() => setSelectedPlan("yearly")}
                onKeyDown={handlePlanKey}
                role="radio"
                aria-checked={selectedPlan === "yearly"}
                className={cn(
                  "w-full relative flex items-center justify-between p-5 rounded-[1.5rem] text-left transition-all duration-300",
                )}
                style={{
                  background: selectedPlan === "yearly" ? "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(245,158,11,0.04))" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${selectedPlan === "yearly" ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                  boxShadow: selectedPlan === "yearly" ? "0 0 30px rgba(245,158,11,0.12)" : "none",
                }}
              >
                {selectedPlan === "yearly" && (
                  <motion.div
                    layoutId="plan-outline"
                    className="absolute inset-0 rounded-[1.5rem] pointer-events-none"
                    style={{ border: "2px solid rgba(245,158,11,0.9)" }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-lg text-white">Yearly</span>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-amber-950"
                      style={{ background: "#f59e0b" }}>
                      <Star className="w-2.5 h-2.5 fill-current" /> Best Value
                    </span>
                  </div>
                  {yearlyMonthly && (
                    <p className="text-sm font-medium text-amber-400">{yearlyMonthly} billed annually</p>
                  )}
                </div>
                <div className="text-right pl-3 shrink-0">
                  <div className="text-2xl font-bold font-serif text-white">{yearlyPrice}</div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>/year</div>
                </div>
              </button>

              {/* Monthly */}
              <button
                ref={monthlyRef}
                onClick={() => setSelectedPlan("monthly")}
                onKeyDown={handlePlanKey}
                role="radio"
                aria-checked={selectedPlan === "monthly"}
                className="w-full relative flex items-center justify-between p-5 rounded-[1.5rem] text-left transition-all duration-300"
                style={{
                  background: selectedPlan === "monthly" ? "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(245,158,11,0.04))" : "rgba(255,255,255,0.04)",
                  border: `1px solid ${selectedPlan === "monthly" ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                  boxShadow: selectedPlan === "monthly" ? "0 0 30px rgba(245,158,11,0.12)" : "none",
                }}
              >
                {selectedPlan === "monthly" && (
                  <motion.div
                    layoutId="plan-outline"
                    className="absolute inset-0 rounded-[1.5rem] pointer-events-none"
                    style={{ border: "2px solid rgba(245,158,11,0.9)" }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-lg text-white">Monthly</span>
                    {monthlyTrialSelected && (
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-950" style={{ background: "#f59e0b" }}>
                        7-day trial
                      </span>
                    )}
                  </div>
                  <p className="text-sm mt-1" style={{ color: monthlyTrialSelected ? "#fbbf24" : "rgba(255,255,255,0.45)" }}>
                    {monthlyTrialSelected ? monthlyTrialLabel : "Flexible, cancel anytime"}
                  </p>
                </div>
                <div className="text-right pl-3 shrink-0">
                  <div className="text-2xl font-bold font-serif text-white">{monthlyPrice}</div>
                  <div className="text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>/month</div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Errors */}
          {(error || iapLoadError) && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants}
              className="mb-6 flex items-start gap-3 rounded-2xl p-4"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "#f87171" }} />
              <p className="text-sm leading-relaxed" style={{ color: "rgba(248,113,113,0.9)" }}>{error || iapLoadError}</p>
            </motion.div>
          )}

          {/* CTA — native only */}
          {nativeStoreAvailable && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants} className="space-y-4">
              <button
                onClick={handleSubscribe}
                disabled={!canSubscribe}
                className="relative w-full overflow-hidden group font-bold text-lg rounded-2xl py-4 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #f59e0b, #d97706)",
                  color: "#422006",
                  boxShadow: "0 8px 30px rgba(245,158,11,0.32)",
                }}
              >
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none" />
                {isLoading ? (
                  <div className="w-6 h-6 border-2 rounded-full animate-spin" style={{ borderColor: "rgba(66,32,6,0.3)", borderTopColor: "#422006" }} />
                ) : isLoadingOffering ? (
                  "Loading..."
                ) : nativeSelectedPlanUnavailable ? (
                  "Plan unavailable"
                ) : (
                  <>{monthlyTrialSelected && selectedPlan === "monthly" ? "Start 7-day trial" : `Continue with ${selectedPlanLabel}`}</>
                )}
              </button>

              <div className="flex items-center justify-center gap-1.5 text-xs" style={{ color: "rgba(255,255,255,0.42)" }}>
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Secure payment via Google Play. Cancel anytime.</span>
              </div>

              <div className="flex items-center justify-center gap-4 pt-1">
                <button onClick={handleRestorePurchases} disabled={isLoading}
                  className="text-xs transition-colors"
                  style={{ color: "rgba(255,255,255,0.42)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.42)"; }}>
                  Restore Purchase
                </button>
                <div className="w-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
                <button onClick={handleManageSubscriptions} disabled={isLoading}
                  className="text-xs transition-colors"
                  style={{ color: "rgba(255,255,255,0.42)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.42)"; }}>
                  Manage Billing
                </button>
              </div>
            </motion.div>
          )}

          <motion.p
            variants={isPerformanceMode ? undefined : itemVariants}
            className="text-center text-[10px] mt-8 mb-6 max-w-xs mx-auto leading-relaxed"
            style={{ color: "rgba(255,255,255,0.25)" }}
          >
            By continuing, you agree to our Terms of Service and Privacy Policy. Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period.
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
