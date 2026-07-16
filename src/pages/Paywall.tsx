import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Check, Star, AlertCircle, ShieldCheck } from "lucide-react";
import { AppLogo } from "../components/AppLogo";
import { motion } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { useMobileViewport } from "../context/MobileViewportContext";
import { apiFetch } from "../lib/apiClient";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
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

export default function Paywall() {
  useDocumentTitle("Subscribe | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const shouldTopAlign = isShortPhone;
  const nativeStoreAvailable =
    isNativePlatform() && getNativePlatform() === "android";
  const [selectedPlan, setSelectedPlan] = useState<Plan>("yearly");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoRedeemOpen, setPromoRedeemOpen] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [promoStatus, setPromoStatus] = useState<string | null>(null);
  const [isRedeemingPromo, setIsRedeemingPromo] = useState(false);
  const [iapPackages, setIapPackages] = useState<Partial<Record<Plan, SubscriptionPackage>>>({});
  const [iapReady, setIapReady] = useState(false);
  const [isLoadingOffering, setIsLoadingOffering] = useState(nativeStoreAvailable);
  const [iapLoadError, setIapLoadError] = useState<string | null>(null);
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

  const monthlyTitle = nativeStoreAvailable
    ? iapPackages.monthly?.product.title || "Monthly"
    : "Monthly";
  const yearlyTitle = nativeStoreAvailable
    ? iapPackages.yearly?.product.title || "Yearly"
    : "Yearly";
  const nativeSelectedPlanUnavailable =
    nativeStoreAvailable && !isLoadingOffering && !selectedNativePackage;
  const canSubscribe =
    !isLoading &&
    !isLoadingOffering &&
    nativeStoreAvailable &&
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
  ) => {
    if (!user) {
      throw new Error("Sign in with Google or email before linking Google Play premium.");
    }

    const accessToken = await getFreshAccessToken();
    if (!accessToken) {
      throw new Error("Your session expired. Please sign in again before linking Google Play premium.");
    }

    const productId = purchase.productIdentifier?.trim();
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

  const handleRedeemPromoCode = async () => {
    const normalizedCode = promoCode.trim().toUpperCase();
    setPromoStatus(null);
    setError(null);

    if (!normalizedCode) {
      setPromoStatus("Enter a promo code.");
      return;
    }

    if (!user || !session?.access_token) {
      setPromoStatus("Sign in with Google or email before redeeming a promo code.");
      return;
    }

    setIsRedeemingPromo(true);

    try {
      const response = await apiFetch("/api/promo-redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not redeem the promo code.");
      }

      subscribe("promo_server");
      setPromoRedeemOpen(false);
      setPromoCode("");
      setPromoStatus(
        data.alreadyRedeemed
          ? `Promo access is already active until ${new Date(data.trialEndsAt).toLocaleDateString()}.`
          : `${data.code} applied. Your free trial is active until ${new Date(data.trialEndsAt).toLocaleDateString()}.`,
      );
      navigate("/");
    } catch (err) {
      setPromoStatus(err instanceof Error ? err.message : "Could not redeem the promo code.");
    } finally {
      setIsRedeemingPromo(false);
    }
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

      await syncNativeSubscriptionForAccount(
        restoredPurchase,
        getConfiguredPlanIdForProduct(restoredPurchase.productIdentifier),
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
    "Unlimited spiritual guidance",
    "Personalized prayer support",
    "Deeper reflections and daily intentions",
    "Ad-free sanctuary experience",
    "Priority access to new teachings",
  ];

  const showAndroidBillingUnavailable = !nativeStoreAvailable;
  const planSummary = showAndroidBillingUnavailable
    ? "Google Play billing is available in the Android app."
    : selectedPlan === "yearly"
    ? "Best value for a steady long-term practice."
    : "A flexible monthly option with a short free trial.";

  return (
    <div
      className="app-screen-scroll w-full relative flex flex-col overflow-x-hidden"
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "0.75rem" : "1rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${isShortPhone ? "0.75rem" : "1rem"})`,
      }}
    >
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-10%] top-[-20%] h-[26rem] w-[26rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-10%] h-[28rem] w-[28rem]" />
      </div>

      <div
        className="relative z-10 flex min-h-full w-full flex-1 flex-col items-center justify-start p-4 sm:py-12"
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className={cn(
            "app-panel shrink-0 w-full max-w-md rounded-[2rem]",
            !shouldTopAlign && "my-auto",
            isCompactPhone ? "p-5" : "p-6 sm:p-7",
          )}
        >
          <div className={cn("flex justify-center", isShortPhone ? "mb-4" : "mb-6")}>
            <div
              className={cn(
                "app-badge-glow flex items-center justify-center overflow-hidden rounded-full ring-2 ring-white/10",
                isShortPhone ? "h-14 w-14" : "h-18 w-18"
              )}
              style={{ width: isShortPhone ? "3.5rem" : "4.5rem", height: isShortPhone ? "3.5rem" : "4.5rem" }}
            >
              <AppLogo className="h-full w-full object-cover" />
            </div>
          </div>

          <div className={cn("text-center", isShortPhone ? "mb-5" : "mb-6 sm:mb-8")}>
            <span className={cn("app-accent-badge mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest", isShortPhone && "mb-3")}>
              Full access
            </span>
            <h1 className={cn("app-heading mb-3 pb-1 font-serif leading-[1.24]", isShortPhone ? "text-[1.85rem]" : isCompactPhone ? "text-[2rem]" : "text-3xl")}>
              Continue your reflection practice
            </h1>
            <p className={cn("app-muted px-2 font-light", isShortPhone && "text-[14px] leading-relaxed")}>
              Unlimited spiritual guidance, prayer support, and private tools in one calm Android experience.
            </p>
          </div>

          <div
            className={cn("mb-4 rounded-card border px-4 py-3", isShortPhone ? "text-[13px]" : "text-sm")}
            style={{
              background: "color-mix(in srgb, var(--app-card-soft) 88%, transparent)",
              borderColor: "var(--app-card-border)",
            }}
          >
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: "var(--app-success)" }} />
              <p className="app-muted leading-relaxed">
                Google Play handles subscriptions, renewals, restores, and any store-managed offers for the Android app.
              </p>
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
          <div role="radiogroup" aria-label="Subscription plan" className={cn("mb-4 grid grid-cols-2", isCompactPhone ? "gap-3" : "gap-4")}>
            <button
              ref={monthlyRef}
              role="radio"
              aria-checked={selectedPlan === "monthly"}
              disabled={nativeStoreAvailable && !iapPackages.monthly}
              tabIndex={selectedPlan === "monthly" ? 0 : -1}
              onClick={() => setSelectedPlan("monthly")}
              onKeyDown={handlePlanKey}
              className={cn("touch-target relative flex min-h-[9.5rem] flex-col items-stretch justify-between rounded-card border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "p-3" : "p-4")}
              style={{
                background: selectedPlan === "monthly" ? "var(--app-accent-soft)" : "var(--app-card-bg)",
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
                  <div className="app-heading mt-1 break-words text-[13px] font-medium leading-tight">
                    {monthlyTitle}
                  </div>
                </div>
                <span className="shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ background: "var(--app-card-soft)", color: "var(--app-text-muted)" }}>
                  Flexible
                </span>
              </div>
              <div>
                <div className={cn("app-heading break-words font-serif leading-none", isCompactPhone ? "text-[1.5rem]" : "text-2xl")}>{monthlyPrice}</div>
                <div className="app-muted mt-2 text-[11px] leading-snug">
                  Billed monthly after any store trial.
                </div>
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
              className={cn("touch-target relative flex min-h-[9.5rem] flex-col items-stretch justify-between rounded-card border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "p-3" : "p-4")}
              style={{
                background: selectedPlan === "yearly" ? "var(--app-accent-soft)" : "var(--app-card-bg)",
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
                    Yearly
                  </div>
                  <div className="app-heading mt-1 break-words text-[13px] font-medium leading-tight">
                    {yearlyTitle}
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white" style={{ background: "var(--app-accent-gradient)" }}>
                  <Star className="h-3 w-3" fill="currentColor" />
                  Popular
                </span>
              </div>
              <div>
                <div className={cn("app-heading break-words font-serif leading-none", isCompactPhone ? "text-[1.5rem]" : "text-2xl")}>{yearlyPrice}</div>
                <div className="app-muted mt-2 text-[11px] leading-snug">Best value for steady use.</div>
              </div>
            </button>
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

          {promoStatus && (
            <div
              role="status"
              className="mb-4 flex items-start gap-2 rounded-card px-4 py-3 text-sm"
              style={{
                background: "var(--app-success-soft)",
                border: "1px solid color-mix(in srgb, var(--app-success) 28%, transparent)",
                color: "var(--app-text)",
              }}
            >
              <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: "var(--app-success)" }} />
              <span>{promoStatus}</span>
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
            <button
              onClick={handleSubscribe}
              disabled={!canSubscribe}
              aria-busy={isLoading}
              className={cn("touch-target app-primary-button mb-4 flex w-full items-center justify-center gap-2 rounded-pill font-medium text-white transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-70 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "py-3.5" : "py-4")}
            >
              {isLoading ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isLoadingOffering ? (
                "Loading Google Play..."
              ) : nativeSelectedPlanUnavailable ? (
                "Plan unavailable"
              ) : (
                `Continue with ${selectedPlanLabel}`
              )}
            </button>
          )}

          <div className={cn("app-success-panel flex items-start gap-3 rounded-card px-4 py-3", isShortPhone ? "mb-4" : "mb-6")}>
            <ShieldCheck className="mt-0.5 h-4 w-4" style={{ color: "var(--app-success)" }} />
            <div>
              <p className="text-sm app-heading">{planSummary}</p>
              <p className="app-muted mt-1 text-[11px]">
                {nativeStoreAvailable
                  ? "Manage or restore eligible subscriptions from this screen."
                  : "Billing is managed in the Android app through Google Play."}
              </p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-1 gap-2">
            <button
              onClick={() => {
                setPromoStatus(null);
                setPromoRedeemOpen(true);
              }}
              className="touch-target app-ghost-button w-full rounded-pill py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            >
              Have a promo code?
            </button>
            {nativeStoreAvailable && (
              <>
              <button
                onClick={handleRestorePurchases}
                disabled={isLoading}
                className="touch-target app-ghost-button w-full rounded-pill py-3 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                Restore purchases
              </button>
              <button
                onClick={handleManageSubscriptions}
                disabled={isLoading}
                className="touch-target app-ghost-button w-full rounded-pill py-3 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                Manage subscriptions
              </button>
              </>
            )}
            <p className="app-muted px-2 text-center text-[11px] leading-relaxed">
              {nativeStoreAvailable
                ? "Google Play manages subscription renewals, restores, and any store-level offers outside the app."
                : "Open this account on Android to subscribe or restore premium through Google Play."}
            </p>
          </div>

          <div className={cn("space-y-3", isShortPhone ? "mb-5" : "mb-6 sm:mb-8")}>
            {features.map((feature, index) => (
              <motion.div
                key={feature}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.04 * index, duration: 0.2 }}
                className="flex items-center gap-3"
              >
                <div
                  className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
                  style={{ background: "var(--app-accent-soft)", border: "1px solid color-mix(in srgb, var(--app-accent) 25%, transparent)" }}
                >
                  <Check className="w-3 h-3 app-accent" strokeWidth={3} />
                </div>
                <span className="text-sm font-medium app-heading">{feature}</span>
              </motion.div>
            ))}
          </div>

          <p className="app-muted px-4 text-center text-[11px] leading-relaxed">
            By subscribing, you agree to the Terms of Service and Privacy Policy. Subscriptions automatically renew unless canceled.
          </p>
        </motion.div>
      </div>

      {promoRedeemOpen && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center px-4 pb-4 pt-safe sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Close promo code dialog"
            onClick={() => setPromoRedeemOpen(false)}
            className="app-overlay absolute inset-0 backdrop-blur-sm"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="promo-code-dialog-title"
            className="app-panel-strong relative z-10 w-full max-w-md rounded-[2rem] border p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-4">
              <p className="app-kicker mb-2">Promo code</p>
              <h2 id="promo-code-dialog-title" className="app-heading text-xl font-semibold">
                Unlock 15 days free
              </h2>
            </div>

            <div className="space-y-3">
              <p className="app-muted text-sm leading-relaxed">
                Enter your promo code below. The free trial is attached to your signed-in Google or email account, not just this device.
              </p>
              <input
                type="text"
                value={promoCode}
                onChange={(event) => setPromoCode(event.target.value.toUpperCase())}
                placeholder="Enter promo code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="app-input w-full rounded-card px-4 py-3.5 text-[15px] uppercase tracking-[0.16em] transition-all"
              />
              {promoStatus && (
                <div
                  className="rounded-card px-4 py-3 text-sm"
                  style={{
                    background: "var(--app-card-soft)",
                    border: "1px solid var(--app-card-border)",
                    color: "var(--app-text)",
                  }}
                >
                  {promoStatus}
                </div>
              )}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setPromoRedeemOpen(false)}
                className="touch-target app-secondary-button flex-1 rounded-pill px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRedeemPromoCode}
                disabled={isRedeemingPromo}
                className="touch-target app-primary-button flex-1 rounded-pill px-3 py-3 text-sm font-medium text-white transition-all disabled:opacity-70 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                {isRedeemingPromo ? "Redeeming..." : "Redeem code"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
