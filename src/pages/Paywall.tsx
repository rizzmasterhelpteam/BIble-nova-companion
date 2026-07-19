import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Check, Star, AlertCircle, ShieldCheck, Sparkles } from "lucide-react";
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
  const nativeStoreAvailable =
    isNativePlatform() && getNativePlatform() === "android";
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
      .catch(() => {
        // The purchase endpoint still returns a precise error if the API is unavailable.
      });

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

  const nativeSelectedPlanUnavailable =
    nativeStoreAvailable && !isLoadingOffering && !selectedNativePackage;
  const canSubscribe =
    !isLoading &&
    !isLoadingOffering &&
    nativeStoreAvailable &&
    subscriptionSyncReady !== false &&
    Boolean(selectedNativePackage);
  const selectedPlanLabel =
    selectedNativePackage
      ? selectedNativePackage.product.title
      : selectedPlan === "yearly"
      ? "Yearly"
      : "Monthly";

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
    "Unlimited scripture-grounded reflections",
    "Personalized prayers and practical next steps",
    "A private, ad-free space for your spiritual rhythm",
  ];

  const showAndroidBillingUnavailable = !nativeStoreAvailable;

  return (
    <div
      className={cn("app-screen-scroll sanctuary-screen relative flex w-full flex-col overflow-x-hidden", isShortPhone && "px-3")}
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "0.75rem" : "1.25rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${isShortPhone ? "0.75rem" : "1rem"})`,
      }}
    >
      <div className="sanctuary-atmosphere" />

      <div className={cn("relative z-10 flex w-full flex-1 flex-col items-center justify-start", isShortPhone ? "py-2" : "px-4 py-2 sm:py-10")}>
        <motion.div
          initial={isPerformanceMode ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1 }}
          transition={{ duration: isPerformanceMode ? 0 : 0.2, ease: "easeOut" }}
          className={cn(
            "sanctuary-surface shrink-0 w-full max-w-lg rounded-[1.35rem]",
            !shouldTopAlign && "sm:my-auto",
            isShortPhone ? "p-4" : isCompactPhone ? "p-5" : "p-6 sm:p-7",
          )}
        >
          <div className={cn("flex items-center justify-between gap-3", isShortPhone ? "mb-4" : "mb-5")}>
            <div
              className={cn(
                "sanctuary-brand-mark flex items-center justify-center overflow-hidden",
                isShortPhone ? "h-12 w-12" : "h-14 w-14"
              )}
              style={{ width: isShortPhone ? "3rem" : "3.5rem", height: isShortPhone ? "3rem" : "3.5rem" }}
            >
              <AppLogo className="h-full w-full object-cover" />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="app-kicker text-[9px]">Bible Nova Premium</p>
              <p className="app-muted mt-1 text-[11px]">A private rhythm for reflection</p>
            </div>
            <span className="app-accent-badge shrink-0 rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]">
              Premium
            </span>
          </div>

          <div className={cn("text-left", isShortPhone ? "mb-4" : "mb-5")}>
            <h1 className={cn("app-heading mb-2 pb-1 font-serif leading-[1.12]", isShortPhone ? "text-[1.8rem]" : isCompactPhone ? "text-[2rem]" : "text-3xl")}>
              A quieter place to return to.
            </h1>
            <p className={cn("app-muted max-w-md font-light", isShortPhone ? "text-[13px] leading-relaxed" : "text-[14px] leading-relaxed")}>
              Scripture-grounded guidance, personalized prayer, and one clear next step whenever you need it.
            </p>
          </div>

          <div className={cn("app-paywall-panel mb-5 rounded-[1.25rem]", isShortPhone ? "p-3.5" : "p-4")}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="app-kicker text-[9px]">Inside Premium</p>
              <Sparkles className="h-4 w-4 app-accent" aria-hidden="true" />
            </div>
            <p className="scripture-copy app-heading text-xl leading-snug">A quiet prompt, a fitting scripture, and a prayer shaped for what you’re carrying.</p>
            <div className="app-muted mt-3 flex items-center gap-2 text-[11px]">
              <Check className="h-3.5 w-3.5 app-accent" strokeWidth={2.5} />
              Available whenever you need a moment to reset
            </div>
          </div>

          {showAndroidBillingUnavailable ? (
            <div
              className="mb-4 flex items-start gap-3 rounded-card px-4 py-4 text-sm"
              style={{
                background: "color-mix(in srgb, var(--app-card-strong) 90%, var(--bg-base) 10%)",
                border: "1px solid var(--app-card-border)",
                color: "var(--app-text)",
              }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: "var(--app-accent-strong)" }} />
              <p className="leading-relaxed">
                Premium purchase is available only in the Android app through Google Play. Sign in on Android with this account to subscribe, restore access, or manage billing.
              </p>
            </div>
          ) : (
          <div>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="app-kicker text-[9px]">Choose your rhythm</p>
                <p className="app-muted mt-1 text-[11px]">Switch anytime from your account.</p>
              </div>
              <span className="app-soft shrink-0 text-[10px]">2 plans</span>
            </div>
          <div role="radiogroup" aria-label="Subscription plan" className="mb-4 grid grid-cols-2 gap-2.5">
            <button
              ref={monthlyRef}
              role="radio"
              aria-checked={selectedPlan === "monthly"}
              disabled={nativeStoreAvailable && !iapPackages.monthly}
              tabIndex={selectedPlan === "monthly" ? 0 : -1}
              onClick={() => setSelectedPlan("monthly")}
              onKeyDown={handlePlanKey}
              className={cn("touch-target app-paywall-plan relative order-2 flex min-h-[8rem] flex-col items-stretch justify-between rounded-[1rem] border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "p-2.5" : "p-3")}
              style={{
                backgroundColor: selectedPlan === "monthly" ? "var(--app-surface-muted)" : "var(--app-surface-solid)",
                backgroundImage: selectedPlan === "monthly" ? "linear-gradient(135deg, color-mix(in srgb, var(--app-accent) 12%, transparent), transparent 72%)" : "none",
                borderColor:
                  selectedPlan === "monthly"
                    ? "color-mix(in srgb, var(--app-accent) 36%, transparent)"
                    : "var(--app-card-border)",
                boxShadow: selectedPlan === "monthly" ? "0 16px 34px rgba(0,0,0,0.08)" : "none",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="app-muted text-[11px] font-semibold uppercase tracking-wider">
                    Monthly
                  </div>
                </div>
                {selectedPlan === "monthly" && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--app-accent)" }}>
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                )}
              </div>
              <div>
                <div className={cn("app-heading break-words font-serif leading-none", isShortPhone ? "text-[1.35rem]" : isCompactPhone ? "text-[1.5rem]" : "text-2xl")}>{monthlyPrice}</div>
                <div className="app-muted mt-2 text-[11px] leading-snug">Flexible, billed monthly</div>
              </div>
            </button>

            <button
              ref={yearlyRef}
              role="radio"
              aria-checked={selectedPlan === "yearly"}
              disabled={nativeStoreAvailable && !iapPackages.yearly}
              tabIndex={selectedPlan === "yearly" ? 0 : -1}
              onClick={() => setSelectedPlan("yearly")}
              onKeyDown={handlePlanKey}
              className={cn("touch-target app-paywall-plan relative order-1 flex min-h-[8rem] flex-col items-stretch justify-between rounded-[1rem] border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "p-2.5" : "p-3")}
              style={{
                backgroundColor: selectedPlan === "yearly" ? "var(--app-surface-muted)" : "var(--app-surface-solid)",
                backgroundImage: selectedPlan === "yearly" ? "linear-gradient(135deg, color-mix(in srgb, var(--app-accent) 12%, transparent), transparent 72%)" : "none",
                borderColor:
                  selectedPlan === "yearly"
                    ? "color-mix(in srgb, var(--app-accent) 36%, transparent)"
                    : "var(--app-card-border)",
                boxShadow: selectedPlan === "yearly"
                  ? "0 0 0 1px color-mix(in srgb, var(--app-accent) 18%, transparent), 0 16px 34px rgba(0,0,0,0.08)"
                  : "none",
              }}
            >
              {selectedPlan === "yearly" && (
                <div
                  className="absolute top-0 left-0 right-0 h-0.5 rounded-t-card"
                  style={{ background: "var(--app-accent-gradient)" }}
                />
              )}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="app-accent text-[11px] font-semibold uppercase tracking-wider">
                    Yearly · recommended
                  </div>
                </div>
                <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider", selectedPlan === "yearly" ? "text-white" : "app-accent")} style={{ background: selectedPlan === "yearly" ? "var(--app-accent-gradient)" : "var(--app-accent-soft)" }}>
                  {selectedPlan === "yearly" ? <Check className="h-3 w-3" strokeWidth={3} /> : <Star className="h-3 w-3" fill="currentColor" />}
                  Best value
                </span>
              </div>
              <div>
                <div className={cn("app-heading break-words font-serif leading-none", isShortPhone ? "text-[1.35rem]" : isCompactPhone ? "text-[1.5rem]" : "text-2xl")}>{yearlyPrice}</div>
                <div className="app-muted mt-2 text-[11px] leading-snug">Best value over a full year.</div>
              </div>
            </button>
          </div>
          </div>
          )}

          {error && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-card px-4 py-3 text-sm"
              style={{
                background: "var(--app-danger-soft)",
                border: "1px solid color-mix(in srgb, var(--app-danger) 28%, transparent)",
                color: "var(--app-danger)",
              }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {nativeStoreAvailable && iapLoadError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2 rounded-card px-4 py-3 text-sm"
              style={{
                background: "color-mix(in srgb, var(--app-accent-soft) 78%, transparent)",
                border: "1px solid color-mix(in srgb, var(--app-accent) 26%, transparent)",
                color: "var(--app-accent-strong)",
              }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{iapLoadError}</span>
            </div>
          )}

          {nativeStoreAvailable && (
            <div className="sanctuary-action mb-4">
              <button
                onClick={handleSubscribe}
                disabled={!canSubscribe}
                aria-busy={isLoading}
                className={cn("touch-target app-primary-button flex w-full items-center justify-center gap-2 rounded-[1rem] font-semibold text-white transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-70 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "py-3.5" : "py-4")}
              >
                {isLoading ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : isLoadingOffering ? (
                  "Loading Google Play..."
                ) : nativeSelectedPlanUnavailable ? (
                  "Plan unavailable"
                ) : (`Continue with ${selectedPlanLabel}`)}
              </button>
              <div className="mt-3 flex items-center justify-center gap-2 text-center">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--app-success)" }} />
                <p className="app-muted text-[11px] leading-relaxed">
                  Secure payment through Google Play. Cancel anytime in Google Play.
                </p>
              </div>
            </div>
          )}

          <div
            className={cn("mb-4 rounded-[1.15rem] border", isShortPhone ? "px-3.5 py-3" : "px-4 py-3.5")}
            style={{
              backgroundColor: "var(--app-surface-solid)",
              borderColor: "var(--app-card-border)",
            }}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="app-kicker text-[9px]">Included with Premium</p>
              <Check className="h-4 w-4 app-accent" aria-hidden="true" />
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {features.map((feature) => (
                <div key={feature} className="flex items-start gap-2">
                  <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full" style={{ background: "var(--app-accent-soft)", border: "1px solid color-mix(in srgb, var(--app-accent) 25%, transparent)" }}>
                    <Check className="h-2.5 w-2.5 app-accent" strokeWidth={3} />
                  </div>
                  <span className="app-muted text-[11px] leading-snug">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4 flex items-center justify-center gap-2">
            {nativeStoreAvailable && (
              <>
              <button
                onClick={handleRestorePurchases}
                disabled={isLoading}
                className="touch-target app-ghost-button flex-1 rounded-pill px-2 py-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                Restore purchases
              </button>
              <button
                onClick={handleManageSubscriptions}
                disabled={isLoading}
                className="touch-target app-ghost-button flex-1 rounded-pill px-2 py-2.5 text-[12px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                Manage subscriptions
              </button>
              </>
            )}
          </div>

          <p className="app-muted px-4 text-center text-[11px] leading-relaxed">
            By subscribing, you agree to the Terms of Service and Privacy Policy. Subscriptions automatically renew unless canceled.
          </p>
        </motion.div>
      </div>

    </div>
  );
}
