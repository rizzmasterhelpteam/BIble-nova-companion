import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Check, Star, AlertCircle, ShieldCheck } from "lucide-react";
import { AppLogo } from "../components/AppLogo";
import { motion } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { isNativePlatform } from "../lib/native/platform";
import { useMobileViewport } from "../context/MobileViewportContext";
import { apiFetch } from "../lib/apiClient";
import {
  getCurrentOffering,
  openSubscriptionManagement,
  purchasePackage as purchaseNativePackage,
  restorePurchases,
  type SubscriptionPackage,
} from "../lib/native/purchases";

type Plan = "monthly" | "yearly";

export default function Paywall() {
  useDocumentTitle("Subscribe | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const shouldTopAlign = isShortPhone;
  const nativeStoreAvailable = isNativePlatform();
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
  const { session, subscribe, user } = useAuth();
  const navigate = useNavigate();
  const subscribeTimeoutRef = useRef<number | null>(null);
  const errorTimeoutRef = useRef<number | null>(null);
  const yearlyRef = useRef<HTMLButtonElement | null>(null);
  const monthlyRef = useRef<HTMLButtonElement | null>(null);

  const clearTimers = () => {
    if (subscribeTimeoutRef.current) window.clearTimeout(subscribeTimeoutRef.current);
    if (errorTimeoutRef.current) window.clearTimeout(errorTimeoutRef.current);
    subscribeTimeoutRef.current = null;
    errorTimeoutRef.current = null;
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

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
    (!nativeStoreAvailable || Boolean(selectedNativePackage));
  const selectedPlanLabel =
    nativeStoreAvailable && selectedNativePackage
      ? selectedNativePackage.product.title
      : selectedPlan === "yearly"
      ? "Yearly"
      : "Monthly";

  const handleSubscribe = async () => {
    clearTimers();
    setError(null);
    if (!canSubscribe) return;
    setIsLoading(true);

    if (nativeStoreAvailable) {
      try {
        if (!selectedNativePackage) {
          throw new Error(
            iapReady
              ? "This plan is not available in the native store yet."
              : "In-app purchases are not configured yet. Add IAP product IDs/base plans and store products.",
          );
        }

        await purchaseNativePackage(selectedNativePackage);
        subscribe();
        navigate("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Purchase could not be completed.");
      } finally {
        setIsLoading(false);
      }
      return;
    }

    subscribeTimeoutRef.current = window.setTimeout(() => {
      clearTimers();
      subscribe();
      navigate("/");
    }, 1500);

    errorTimeoutRef.current = window.setTimeout(() => {
      clearTimers();
      setError("Something held this up. Please try again.");
      setIsLoading(false);
    }, 6000);
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
      await restorePurchases();
      subscribe();
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

  const planSummary =
    selectedPlan === "yearly"
      ? "Best value for a steady long-term practice."
      : "A flexible monthly option with a short free trial.";
  const promoButtonLabel = "Have a promo code?";

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
        className={cn(
          "relative z-10 flex min-h-full w-full flex-1 flex-col items-center p-4 sm:py-12",
          shouldTopAlign ? "justify-start" : "justify-center",
        )}
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "app-panel w-full max-w-sm rounded-[2rem]",
            !shouldTopAlign && "my-auto",
            isCompactPhone ? "p-5" : "p-6 sm:p-7",
          )}
        >
          <div className={cn("flex justify-center", isShortPhone ? "mb-4" : "mb-8")}>
            <div className={cn("app-logo-badge flex items-center justify-center overflow-hidden rounded-full ring-1 ring-white/10", isShortPhone ? "h-12 w-12" : "h-16 w-16")}>
              <AppLogo className="h-full w-full object-cover" />
            </div>
          </div>

          <div className={cn("text-center", isShortPhone ? "mb-5" : "mb-6 sm:mb-8")}>
            <span className={cn("app-accent-badge mb-4 inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest", isShortPhone && "mb-3")}>
              Your path is ready
            </span>
            <h1 className={cn("app-heading mb-3 pb-1 font-serif leading-[1.24]", isShortPhone ? "text-[1.85rem]" : isCompactPhone ? "text-[2rem]" : "text-3xl")}>
              Unlock your spiritual journey
            </h1>
            <p className={cn("app-muted px-2 font-light", isShortPhone && "text-[14px] leading-relaxed")}>
              Commit to your growth with full access to Bible Nova Companion.
            </p>
          </div>

          <div role="radiogroup" aria-label="Subscription plan" className={cn("mb-4 grid grid-cols-2", isCompactPhone ? "gap-3" : "gap-4")}>
            <button
              ref={monthlyRef}
              role="radio"
              aria-checked={selectedPlan === "monthly"}
              disabled={nativeStoreAvailable && !iapPackages.monthly}
              tabIndex={selectedPlan === "monthly" ? 0 : -1}
              onClick={() => setSelectedPlan("monthly")}
              onKeyDown={handlePlanKey}
              className={cn("touch-target relative flex flex-col items-center justify-center rounded-card border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "p-3" : "p-4")}
              style={{
                background: selectedPlan === "monthly" ? "var(--app-accent-soft)" : "var(--app-card-bg)",
                borderColor:
                  selectedPlan === "monthly"
                    ? "color-mix(in srgb, var(--app-accent) 36%, transparent)"
                    : "var(--app-card-border)",
                boxShadow: selectedPlan === "monthly" ? "0 16px 34px rgba(0,0,0,0.08)" : "none",
              }}
            >
              <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md" style={{ background: "var(--app-heading)" }}>
                3 days free
              </div>
              <div className="app-muted mb-2 text-xs font-medium uppercase tracking-wider">
                {monthlyTitle}
              </div>
              <div className={cn("app-heading font-serif", isCompactPhone ? "text-[1.65rem]" : "text-2xl")}>{monthlyPrice}</div>
              <div className="app-muted mt-1 text-center text-[10px]">
                /month
                <br />
                after trial
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
              className={cn("touch-target relative flex flex-col items-center justify-center rounded-card border text-left transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "p-3" : "p-4")}
              style={{
                background: selectedPlan === "yearly" ? "var(--app-accent-soft)" : "var(--app-card-bg)",
                borderColor:
                  selectedPlan === "yearly"
                    ? "color-mix(in srgb, var(--app-accent) 36%, transparent)"
                    : "var(--app-card-border)",
                boxShadow: selectedPlan === "yearly" ? "0 16px 34px rgba(0,0,0,0.08)" : "none",
              }}
            >
              <div className="app-primary-button absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
                <Star className="w-3 h-3" fill="currentColor" />
                Popular
              </div>
              <div className="app-accent mb-2 text-xs font-medium uppercase tracking-wider">
                {yearlyTitle}
              </div>
              <div className={cn("app-heading font-serif", isCompactPhone ? "text-[1.65rem]" : "text-2xl")}>{yearlyPrice}</div>
              <div className="app-muted mt-1 text-xs">/year ($7.50/mo)</div>
            </button>
          </div>

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

          <button
            onClick={handleSubscribe}
            disabled={!canSubscribe}
            aria-busy={isLoading}
            className={cn("touch-target app-primary-button mb-4 flex w-full items-center justify-center gap-2 rounded-pill font-medium text-white transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-70 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "py-3.5" : "py-4")}
          >
            {isLoading ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : isLoadingOffering ? (
              "Loading store..."
            ) : nativeSelectedPlanUnavailable ? (
              "Plan unavailable"
            ) : (
              `Continue with ${selectedPlanLabel}`
            )}
          </button>

          <div className={cn("app-success-panel flex items-start gap-3 rounded-card px-4 py-3", isShortPhone ? "mb-4" : "mb-6")}>
            <ShieldCheck className="mt-0.5 h-4 w-4" style={{ color: "var(--app-success)" }} />
            <div>
              <p className="text-sm app-heading">{planSummary}</p>
              <p className="app-muted mt-1 text-[11px]">
                You can change plans later in a real billing setup.
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
              {promoButtonLabel}
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
              Promo codes are tied to your signed-in Google or email account so the 15-day trial follows you across devices.
            </p>
          </div>

          <div className={cn("space-y-3", isShortPhone ? "mb-5" : "mb-6 sm:mb-8")}>
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full" style={{ background: "var(--app-accent-soft)" }}>
                  <Check className="w-3 h-3 app-accent" strokeWidth={3} />
                </div>
                <span className="text-sm font-medium app-heading">{feature}</span>
              </div>
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
                Enter your promo code below. The free trial is attached to your signed-in
                Google or email account, not just this device.
              </p>
              <p className="app-muted text-sm leading-relaxed">
                Current launch code: <span className="app-heading font-medium">GETNOW</span> for 15 days of full access.
              </p>
              <div className="relative">
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
              </div>
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
