import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Check, Star, AlertCircle, ShieldCheck } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { motion } from "motion/react";
import { useDocumentTitle } from "../lib/utils";
import { isNativePlatform } from "../lib/native/platform";
import {
  getCurrentOffering,
  purchasePackage as purchaseRevenueCatPackage,
  restorePurchases,
} from "../lib/native/purchases";
import type { PurchasesPackage } from "@revenuecat/purchases-capacitor";

type Plan = "monthly" | "yearly";

export default function Paywall() {
  useDocumentTitle("Subscribe | Bible Nova Companion");
  const [selectedPlan, setSelectedPlan] = useState<Plan>("yearly");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iapPackages, setIapPackages] = useState<Partial<Record<Plan, PurchasesPackage>>>({});
  const [iapReady, setIapReady] = useState(false);
  const { subscribe } = useAuth();
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
    if (!isNativePlatform()) return;

    getCurrentOffering()
      .then((offering) => {
        if (!offering) return;
        setIapPackages({
          monthly: offering.monthly || undefined,
          yearly: offering.annual || undefined,
        });
        setIapReady(Boolean(offering.monthly || offering.annual));
      })
      .catch((err) => {
        console.warn("Could not load native offerings:", err);
      });
  }, []);

  const selectedNativePackage = iapPackages[selectedPlan];

  const monthlyPrice = useMemo(
    () => iapPackages.monthly?.product.priceString || "$9.99",
    [iapPackages.monthly],
  );

  const yearlyPrice = useMemo(
    () => iapPackages.yearly?.product.priceString || "$89.99",
    [iapPackages.yearly],
  );

  const handleSubscribe = async () => {
    clearTimers();
    setError(null);
    setIsLoading(true);

    if (isNativePlatform()) {
      try {
        if (!selectedNativePackage) {
          throw new Error(
            iapReady
              ? "This plan is not available in the native store yet."
              : "In-app purchases are not configured yet. Add RevenueCat keys and store products.",
          );
        }

        await purchaseRevenueCatPackage(selectedNativePackage);
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

  const handlePlanKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedPlan("yearly");
      yearlyRef.current?.focus();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
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

  return (
    <div
      className="app-screen relative flex min-h-[100svh] flex-col overflow-hidden"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 1rem)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 1rem)",
      }}
    >
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-10%] top-[-20%] h-[26rem] w-[26rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-10%] h-[28rem] w-[28rem]" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 sm:py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="app-panel w-full max-w-sm rounded-[2rem] p-6 sm:p-7"
        >
          <div className="flex justify-center mb-8">
            <div className="app-logo-badge flex h-16 w-16 items-center justify-center rounded-full ring-1 ring-white/10">
              <ChristianCross className="w-8 h-8 text-white" strokeWidth={2.5} />
            </div>
          </div>

          <div className="text-center mb-6 sm:mb-8">
            <span className="app-accent-badge inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest mb-4">
              Your path is ready
            </span>
            <h1 className="app-heading mb-3 pb-1 text-3xl font-serif leading-[1.24]">
              Unlock your spiritual journey
            </h1>
            <p className="app-muted px-2 font-light">
              Commit to your growth with full access to Bible Nova Companion.
            </p>
          </div>

          <div className="space-y-4 mb-6 sm:mb-8">
            {features.map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full" style={{ background: "var(--app-accent-soft)" }}>
                  <Check className="w-3 h-3 app-accent" strokeWidth={3} />
                </div>
                <span className="text-sm font-medium app-heading">{feature}</span>
              </div>
            ))}
          </div>

          <div role="radiogroup" aria-label="Subscription plan" className="grid grid-cols-2 gap-4 mb-4">
            <button
              ref={monthlyRef}
              role="radio"
              aria-checked={selectedPlan === "monthly"}
              tabIndex={selectedPlan === "monthly" ? 0 : -1}
              onClick={() => setSelectedPlan("monthly")}
              onKeyDown={handlePlanKey}
              className="relative flex flex-col items-center justify-center rounded-card border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
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
                Monthly
              </div>
              <div className="app-heading text-2xl font-serif">{monthlyPrice}</div>
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
              tabIndex={selectedPlan === "yearly" ? 0 : -1}
              onClick={() => setSelectedPlan("yearly")}
              onKeyDown={handlePlanKey}
              className="relative flex flex-col items-center justify-center rounded-card border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
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
                Yearly
              </div>
              <div className="app-heading text-2xl font-serif">{yearlyPrice}</div>
              <div className="app-muted mt-1 text-xs">/year ($7.50/mo)</div>
            </button>
          </div>

          <div className="app-success-panel mb-6 flex items-start gap-3 rounded-card px-4 py-3">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-emerald-500" />
            <div>
              <p className="text-sm app-heading">{planSummary}</p>
              <p className="app-muted mt-1 text-[11px]">
                You can change plans later in a real billing setup.
              </p>
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 mb-4 px-4 py-3 rounded-card bg-rose-500/10 border border-rose-500/30 text-rose-500 dark:text-rose-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={handleSubscribe}
            disabled={isLoading}
            aria-busy={isLoading}
            className="app-primary-button mb-4 flex w-full items-center justify-center gap-2 rounded-pill py-4 font-medium text-white transition-all hover:opacity-95 active:scale-[0.98] disabled:opacity-70 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            {isLoading ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              `Continue with ${selectedPlan === "yearly" ? "Yearly" : "Monthly"}`
            )}
          </button>

          {isNativePlatform() && (
            <button
              onClick={handleRestorePurchases}
              disabled={isLoading}
              className="app-ghost-button mb-4 w-full rounded-pill py-3 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            >
              Restore purchases
            </button>
          )}

          <p className="app-muted px-4 text-center text-[11px] leading-relaxed">
            By subscribing, you agree to the Terms of Service and Privacy Policy. Subscriptions automatically renew unless canceled.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
