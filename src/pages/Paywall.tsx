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
import { selectNewestConfiguredNativePurchase } from "../lib/native/subscriptionSync";

type Plan = "monthly" | "yearly";

type NativePurchaseTransaction = {
  productIdentifier?: string;
  orderId?: string;
  purchaseToken?: string;
};

type NativeSubscriptionSyncResponse = {
  subscription?: {
    source?: string;
    accessActive?: boolean;
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
  const [subscriptionSyncError, setSubscriptionSyncError] = useState<string | null>(null);
  const [offeringReloadKey, setOfferingReloadKey] = useState(0);
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
  }, [nativeStoreAvailable, offeringReloadKey]);

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
          setSubscriptionSyncError(
            "Premium purchases are temporarily unavailable while secure Google Play verification is being configured. Please try again later.",
          );
        } else {
          setSubscriptionSyncError(null);
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
    monthlyTrialConfigured && iapPackages.monthly?.androidOfferId === configuredMonthlyOfferId;
  const monthlyTrialLabel = "7-day free trial";

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
    if (data.subscription?.accessActive !== true) {
      throw new Error("Google Play verified this purchase, but it is not currently active.");
    }
    subscribe("native_google_play");
    return data.subscription;
  };

  const handleRestorePurchases = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const purchases = await restorePurchases();
      const restoredPurchase = selectNewestConfiguredNativePurchase(
        purchases as NativePurchaseTransaction[],
      ) as NativePurchaseTransaction | undefined;
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
    { text: "Unlimited scripture-grounded reflections", icon: <BookOpen className="app-accent h-5 w-5" /> },
    { text: "Personalized prayers & practical steps", icon: <HeartHandshake className="app-accent h-5 w-5" /> },
    { text: "A private, distraction-free space", icon: <Lock className="app-accent h-5 w-5" /> },
  ];

  const yearlyMonthly = useMemo(() => {
    if (nativeStoreAvailable && iapPackages.yearly) return null;
    return "≈ $7.50/mo";
  }, [nativeStoreAvailable, iapPackages.yearly]);

  // Google Play is the only supported billing surface today. Keep the web
  // screen informative without presenting pricing cards that cannot be bought.
  const showPricingCards = nativeStoreAvailable;

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
      className="paywall-screen app-screen-scroll relative w-full"
      style={{ minHeight: "100dvh", overflowX: "hidden" }}
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
            <span className="app-accent-badge inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold tracking-widest uppercase mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              Bible Nova Premium
            </span>
            
            <h1 className="app-heading text-3xl sm:text-4xl font-serif font-medium mb-3 tracking-tight">
              Deepen Your Journey
            </h1>
            <p className="app-muted text-[15px] leading-relaxed max-w-[300px]">
              Unlock unlimited personalized reflections, prayers, and a distraction-free spiritual sanctuary.
            </p>
          </motion.div>

          {/* Premium Features */}
          <motion.div variants={isPerformanceMode ? undefined : itemVariants} className="space-y-3 mb-8">
            {features.map((feature) => (
              <div key={feature.text}
                className="app-paywall-panel flex items-center gap-4 rounded-2xl p-4">
                <div className="flex-shrink-0 rounded-xl p-2" style={{ background: "var(--app-accent-soft)" }}>
                  {feature.icon}
                </div>
                <p className="app-heading text-sm font-medium">{feature.text}</p>
              </div>
            ))}
          </motion.div>

          {/* Android unavailable notice (only shown on web when native store unavailable) */}
          {!nativeStoreAvailable && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants}
              className="app-paywall-panel mb-6 flex items-start gap-3 rounded-2xl p-4">
              <ShieldCheck className="app-accent mt-0.5 h-5 w-5 shrink-0" />
              <p className="app-accent text-sm leading-relaxed">
                Subscriptions are managed via the Android app. Download it on Google Play to subscribe.
              </p>
            </motion.div>
          )}

          {!nativeStoreAvailable && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants} className="app-paywall-panel mb-8 rounded-[1.5rem] p-5 text-left">
              <p className="app-kicker mb-2">Web preview</p>
              <h2 className="app-heading text-xl font-serif">Your reflection space is ready for Android.</h2>
              <p className="app-muted mt-2 text-sm leading-relaxed">
                Premium plans are purchased and restored through Google Play in the Android app. This web view is available for exploring the experience; it will not start a checkout.
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
                  "paywall-plan-card touch-target w-full relative flex items-center justify-between p-5 rounded-[1.5rem] text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]",
                )}
              >
                {selectedPlan === "yearly" && (
                  <motion.div
                    layoutId="plan-outline"
                    className="paywall-plan-outline absolute inset-0 rounded-[1.5rem] pointer-events-none"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="app-heading font-semibold text-lg">Yearly</span>
                    <span className="app-accent-badge inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                      <Star className="w-2.5 h-2.5 fill-current" /> Best Value
                    </span>
                  </div>
                  {yearlyMonthly && (
                    <p className="app-accent text-sm font-medium">{yearlyMonthly} billed annually</p>
                  )}
                </div>
                <div className="text-right pl-3 shrink-0">
                  <div className="app-heading text-2xl font-bold font-serif">{yearlyPrice}</div>
                  <div className="app-muted text-xs">/year</div>
                </div>
              </button>

              {/* Monthly */}
              <button
                ref={monthlyRef}
                onClick={() => setSelectedPlan("monthly")}
                onKeyDown={handlePlanKey}
                role="radio"
                aria-checked={selectedPlan === "monthly"}
                className="paywall-plan-card touch-target w-full relative flex items-center justify-between p-5 rounded-[1.5rem] text-left transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                {selectedPlan === "monthly" && (
                  <motion.div
                    layoutId="plan-outline"
                    className="paywall-plan-outline absolute inset-0 rounded-[1.5rem] pointer-events-none"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="app-heading font-semibold text-lg">Monthly</span>
                    {monthlyTrialSelected && (
                      <span className="app-accent-badge rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                        7-day free trial
                      </span>
                    )}
                  </div>
                  <p className={cn("mt-1 text-sm", monthlyTrialSelected ? "app-accent" : "app-muted")}>
                    {monthlyTrialSelected ? monthlyTrialLabel : "Flexible, cancel anytime"}
                  </p>
                </div>
                <div className="text-right pl-3 shrink-0">
                  <div className="app-heading text-2xl font-bold font-serif">{monthlyPrice}</div>
                  <div className="app-muted text-xs">/month</div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Errors */}
          {(error || iapLoadError || subscriptionSyncError) && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants}
              className="app-danger-panel mb-6 flex items-start gap-3 rounded-2xl p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <p className="text-sm leading-relaxed">{error || iapLoadError || subscriptionSyncError}</p>
              {!error && iapLoadError && <button type="button" onClick={() => { setIapLoadError(null); setOfferingReloadKey((value) => value + 1); }} disabled={isLoadingOffering} className="touch-target shrink-0 rounded-pill px-3 py-2 text-xs font-semibold underline-offset-4 hover:underline disabled:opacity-50">Retry</button>}
            </motion.div>
          )}

          {/* CTA — native only */}
          {nativeStoreAvailable && (
            <motion.div variants={isPerformanceMode ? undefined : itemVariants} className="space-y-4">
              <button
                onClick={handleSubscribe}
                disabled={!canSubscribe}
                className="app-primary-button touch-target relative w-full overflow-hidden group font-bold text-lg rounded-2xl py-4 flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none" />
                {isLoading ? (
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-current/25 border-t-current" />
                ) : isLoadingOffering ? (
                  "Loading..."
                ) : nativeSelectedPlanUnavailable ? (
                  "Plan unavailable"
                ) : (
                  <>{monthlyTrialSelected && selectedPlan === "monthly" ? "Start free trial" : `Continue with ${selectedPlanLabel}`}</>
                )}
              </button>

              <div className="app-muted flex items-center justify-center gap-1.5 text-xs">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Secure payment via Google Play. Cancel anytime.</span>
              </div>

              <div className="flex items-center justify-center gap-4 pt-1">
                <button type="button" onClick={handleRestorePurchases} disabled={isLoading}
                  className="touch-target app-ghost-button rounded-pill px-3 py-2 text-xs transition-colors disabled:opacity-50">
                  Restore Purchase
                </button>
                <div className="h-1 w-1 rounded-full" style={{ background: "var(--app-divider)" }} />
                <button type="button" onClick={handleManageSubscriptions} disabled={isLoading}
                  className="touch-target app-ghost-button rounded-pill px-3 py-2 text-xs transition-colors disabled:opacity-50">
                  Manage Billing
                </button>
              </div>
            </motion.div>
          )}

          <motion.p
            variants={isPerformanceMode ? undefined : itemVariants}
            className="app-soft text-center text-[10px] mt-8 mb-6 max-w-xs mx-auto leading-relaxed"
          >
            By continuing, you agree to our Terms of Service and Privacy Policy. Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period.
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
