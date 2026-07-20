import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Check, Star, AlertCircle, ShieldCheck, Sparkles, HeartHandshake, Zap, Lock } from "lucide-react";
import { AppLogo } from "../components/AppLogo";
import { motion, useReducedMotion } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { useMobileViewport } from "../context/MobileViewportContext";
import { apiFetch } from "../lib/apiClient";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  getConfiguredProductIdForIdentifier,
  getConfiguredPlanIdForProduct,
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
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const shouldTopAlign = isShortPhone;
  const prefersReducedMotion = useReducedMotion();
  const isPerformanceMode = Boolean(
    prefersReducedMotion || (isNativePlatform() && getNativePlatform() === "android"),
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

    return () => {
      isMounted = false;
    };
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
    return () => {
      isMounted = false;
    };
  }, [nativeStoreAvailable]);

  useEffect(() => {
    if (!nativeStoreAvailable || isLoadingOffering || iapPackages[selectedPlan]) return;
    if (iapPackages.yearly) {
      setSelectedPlan("yearly");
    } else if (iapPackages.monthly) {
      setSelectedPlan("monthly");
    }
  }, [iapPackages, isLoadingOffering, nativeStoreAvailable, selectedPlan]);

  const selectedNativePackage = iapPackages[selectedPlan];
  const monthlyPrice = useMemo(
    () =>
      nativeStoreAvailable
        ? iapPackages.monthly?.product.priceString || (isLoadingOffering ? "Loading..." : "Unavailable")
        : "$9.99",
    [iapPackages.monthly, isLoadingOffering, nativeStoreAvailable],
  );

  const yearlyPrice = useMemo(
    () =>
      nativeStoreAvailable
        ? iapPackages.yearly?.product.priceString || (isLoadingOffering ? "Loading..." : "Unavailable")
        : "$89.99",
    [iapPackages.yearly, isLoadingOffering, nativeStoreAvailable],
  );

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
    if (error) {
      console.warn("Could not refresh session before syncing subscription:", error.message);
    }
    return data.session?.access_token || session?.access_token || null;
  };

  const syncNativeSubscriptionForAccount = async (
    purchase: NativePurchaseTransaction,
    planId?: string,
    expectedProductId?: string,
  ) => {
    if (!user) {
      throw new Error("Sign in with Google or email before linking Google Play premium.");
    }
    const accessToken = await getFreshAccessToken();
    if (!accessToken) {
      throw new Error("Your session expired. Please sign in again before linking Google Play premium.");
    }
    const productId = purchase.productIdentifier
      ? getConfiguredProductIdForIdentifier(purchase.productIdentifier) || purchase.productIdentifier.trim()
      : expectedProductId?.trim();
    if (!productId) {
      throw new Error("The native purchase was missing its product ID.");
    }
    const response = await apiFetch("/api/subscription/native-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        productId,
        planId,
        orderId: purchase.orderId?.trim() || undefined,
        purchaseToken: purchase.purchaseToken?.trim() || undefined,
        platform: "android",
      }),
    });
    const data = (await response.json().catch(() => ({}))) as NativeSubscriptionSyncResponse;
    if (!response.ok) {
      throw new Error(data.error || "Could not link this subscription to your account.");
    }
    subscribe("native_google_play");
    return data.subscription;
  };

  const handleRestorePurchases = async () => {
    setError(null);
    setIsLoading(true);
    try {
      const purchases = await restorePurchases();
      const restoredPurchase =
        (purchases.find((purchase) => Boolean((purchase as NativePurchaseTransaction).productIdentifier)) ||
          purchases[0]) as NativePurchaseTransaction | undefined;
      if (!restoredPurchase?.productIdentifier) {
        throw new Error("Could not determine which subscription to restore.");
      }
      const restoredProductId = getConfiguredProductIdForIdentifier(restoredPurchase.productIdentifier);
      if (!restoredProductId) {
        throw new Error("The restored purchase does not match a configured subscription.");
      }
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
    { text: "Unlimited scripture-grounded reflections", icon: <BookOpen className="w-5 h-5 text-amber-500" /> },
    { text: "Personalized prayers & practical steps", icon: <HeartHandshake className="w-5 h-5 text-rose-500" /> },
    { text: "A private, distraction-free space", icon: <Lock className="w-5 h-5 text-emerald-500" /> },
  ];

  const showAndroidBillingUnavailable = !nativeStoreAvailable;

  const yearlyMonthly = useMemo(() => {
    if (nativeStoreAvailable && iapPackages.yearly) return null;
    return "≈ $7.50/mo";
  }, [nativeStoreAvailable, iapPackages.yearly]);

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 },
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0F0F12] text-white">
      {/* Animated Background Orbs */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          opacity: [0.3, 0.5, 0.3],
          x: [0, 50, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute -top-[20%] -left-[10%] h-[600px] w-[600px] rounded-full bg-amber-500/10 blur-[120px] pointer-events-none"
      />
      <motion.div
        animate={{
          scale: [1, 1.3, 1],
          opacity: [0.2, 0.4, 0.2],
          x: [0, -40, 0],
          y: [0, 40, 0],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear", delay: 2 }}
        className="absolute top-[40%] -right-[20%] h-[500px] w-[500px] rounded-full bg-rose-500/10 blur-[100px] pointer-events-none"
      />

      <div className={cn("relative z-10 flex w-full flex-col items-center justify-start px-4", isShortPhone ? "py-4" : "py-8 sm:py-12")}>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="w-full max-w-md mx-auto"
        >
          {/* Header Section */}
          <motion.div variants={itemVariants} className="flex flex-col items-center text-center mb-8">
            <div className="relative mb-6">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                className="absolute -inset-2 rounded-full border border-amber-500/30 border-t-amber-500/80"
              />
              <div className="h-20 w-20 rounded-full overflow-hidden shadow-[0_0_40px_rgba(245,158,11,0.3)] bg-gradient-to-br from-[#1a1a1e] to-[#0F0F12] p-1 flex items-center justify-center">
                <AppLogo className="h-full w-full object-cover rounded-full" />
              </div>
            </div>
            
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs font-bold tracking-widest uppercase mb-4">
              <Sparkles className="w-3.5 h-3.5" />
              Bible Nova Premium
            </span>
            
            <h1 className="text-3xl sm:text-4xl font-serif font-medium mb-3 tracking-tight bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
              Deepen Your Journey
            </h1>
            <p className="text-white/60 text-[15px] leading-relaxed max-w-[300px]">
              Unlock unlimited personalized reflections, prayers, and a distraction-free spiritual sanctuary.
            </p>
          </motion.div>

          {/* Premium Features Grid */}
          <motion.div variants={itemVariants} className="space-y-3 mb-8">
            {features.map((feature, idx) => (
              <div key={idx} className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl p-4 backdrop-blur-md">
                <div className="flex-shrink-0 bg-white/5 p-2 rounded-xl">
                  {feature.icon}
                </div>
                <p className="text-sm font-medium text-white/90">{feature.text}</p>
              </div>
            ))}
          </motion.div>

          {/* Social Proof */}
          <motion.div variants={itemVariants} className="mb-8">
            <div className="relative bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 rounded-2xl p-5 overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Star className="w-16 h-16 text-amber-500 rotate-12" />
              </div>
              <p className="text-[17px] font-serif italic leading-relaxed text-white/90 relative z-10">
                "Bible Nova completely changed how I start my mornings. The reflections feel incredibly personal."
              </p>
              <div className="mt-3 flex items-center gap-2">
                <div className="flex text-amber-400">
                  {[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 fill-current" />)}
                </div>
                <span className="text-xs text-white/50 font-medium">— Sarah M.</span>
              </div>
            </div>
          </motion.div>

          {/* Android Unavailable Warning */}
          {showAndroidBillingUnavailable ? (
            <motion.div variants={itemVariants} className="mb-6 flex items-start gap-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
              <ShieldCheck className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-100/80 leading-relaxed">
                Premium subscriptions are currently managed via the Android app on Google Play. Please sign in on an Android device to subscribe or restore.
              </p>
            </motion.div>
          ) : (
            /* Pricing Options */
            <motion.div variants={itemVariants} className="mb-8 space-y-3">
              <button
                ref={yearlyRef}
                onClick={() => setSelectedPlan("yearly")}
                className={cn(
                  "w-full relative flex items-center justify-between p-5 rounded-[1.5rem] border text-left transition-all duration-300",
                  selectedPlan === "yearly" 
                    ? "bg-gradient-to-br from-amber-500/15 to-transparent border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,0.15)] scale-[1.02]" 
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                )}
              >
                {selectedPlan === "yearly" && (
                  <motion.div layoutId="plan-outline" className="absolute inset-0 border-2 border-amber-500 rounded-[1.5rem] pointer-events-none" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-lg">Yearly</span>
                    <span className="bg-amber-500 text-amber-950 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full flex items-center gap-1">
                      <Star className="w-3 h-3 fill-current" /> Best Value
                    </span>
                  </div>
                  {yearlyMonthly && <p className="text-amber-400 text-sm font-medium">{yearlyMonthly} billed annually</p>}
                </div>
                <div className="text-right pl-4">
                  <div className="text-2xl font-bold font-serif">{yearlyPrice}</div>
                  <div className="text-xs text-white/50">/year</div>
                </div>
              </button>

              <button
                ref={monthlyRef}
                onClick={() => setSelectedPlan("monthly")}
                className={cn(
                  "w-full relative flex items-center justify-between p-5 rounded-[1.5rem] border text-left transition-all duration-300",
                  selectedPlan === "monthly" 
                    ? "bg-gradient-to-br from-amber-500/15 to-transparent border-amber-500/50 shadow-[0_0_30px_rgba(245,158,11,0.15)] scale-[1.02]" 
                    : "bg-white/5 border-white/10 hover:bg-white/10"
                )}
              >
                {selectedPlan === "monthly" && (
                  <motion.div layoutId="plan-outline" className="absolute inset-0 border-2 border-amber-500 rounded-[1.5rem] pointer-events-none" />
                )}
                <div className="flex-1">
                  <span className="font-semibold text-lg">Monthly</span>
                  <p className="text-white/50 text-sm mt-1">Flexible, cancel anytime</p>
                </div>
                <div className="text-right pl-4">
                  <div className="text-2xl font-bold font-serif">{monthlyPrice}</div>
                  <div className="text-xs text-white/50">/month</div>
                </div>
              </button>
            </motion.div>
          )}

          {/* Errors */}
          {(error || iapLoadError) && (
            <motion.div variants={itemVariants} className="mb-6 flex items-start gap-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-100/80">{error || iapLoadError}</p>
            </motion.div>
          )}

          {/* CTA & Footer */}
          {nativeStoreAvailable && (
            <motion.div variants={itemVariants} className="space-y-4">
              <button
                onClick={handleSubscribe}
                disabled={!canSubscribe}
                className="relative w-full overflow-hidden group bg-gradient-to-r from-amber-500 to-amber-600 text-amber-950 font-bold text-lg rounded-2xl py-4 flex items-center justify-center gap-2 hover:from-amber-400 hover:to-amber-500 transition-all disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed shadow-[0_8px_30px_rgba(245,158,11,0.3)] hover:shadow-[0_8px_40px_rgba(245,158,11,0.4)] hover:-translate-y-0.5"
              >
                {/* Shimmer effect */}
                <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
                
                {isLoading ? (
                  <div className="w-6 h-6 border-2 border-amber-950/30 border-t-amber-950 rounded-full animate-spin" />
                ) : isLoadingOffering ? (
                  "Loading..."
                ) : nativeSelectedPlanUnavailable ? (
                  "Plan unavailable"
                ) : (
                  <>Continue with {selectedPlanLabel}</>
                )}
              </button>
              
              <div className="flex items-center justify-center gap-1.5 text-xs text-white/50">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Secure payment via Google Play. Cancel anytime.</span>
              </div>
              
              <div className="flex items-center justify-center gap-4 pt-2">
                <button onClick={handleRestorePurchases} disabled={isLoading} className="text-xs text-white/50 hover:text-white transition-colors">Restore Purchase</button>
                <div className="w-1 h-1 rounded-full bg-white/20" />
                <button onClick={handleManageSubscriptions} disabled={isLoading} className="text-xs text-white/50 hover:text-white transition-colors">Manage Billing</button>
              </div>
            </motion.div>
          )}
          
          <motion.p variants={itemVariants} className="text-center text-[10px] text-white/30 mt-8 mb-4 max-w-xs mx-auto">
            By continuing, you agree to our Terms of Service and Privacy Policy. Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period.
          </motion.p>
          
        </motion.div>
      </div>
    </div>
  );
}
