import { Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useEntitlement } from "../context/EntitlementContext";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { useNavigate } from "react-router-dom";
import type { VoiceUsageSummary } from "../types/live";

type ProfileCapacityCardProps = {
  isOpen: boolean;
};

type UsageResponse = {
  eligible?: boolean;
  usage?: VoiceUsageSummary | null;
  limits?: {
    maxSessionMinutes?: number;
    monthlyMinutes?: number;
  };
};

type UsageState = {
  eligible: boolean;
  usage: VoiceUsageSummary | null;
  maxSessionMinutes: number | null;
  monthlyMinutes: number | null;
};

const asDisplayInteger = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
};

const formatResetDate = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value));
};

const formatVerifiedTime = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
};

const CapacityProgress = ({ value, muted = false }: { value: number; muted?: boolean }) => (
  <div
    className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
    style={{ background: "var(--app-secondary-bg)" }}
    aria-hidden="true"
  >
    <div
      className="h-full rounded-full"
      style={{
        width: value > 0 ? `${Math.max(2, Math.min(100, value))}%` : "0%",
        background: muted ? "var(--app-divider)" : "var(--app-accent-gradient)",
      }}
    />
  </div>
);

export default function ProfileCapacityCard({
  isOpen,
}: ProfileCapacityCardProps) {
  const { snapshot, refresh, restorationError, restoreGooglePlayPurchase } = useEntitlement();
  const navigate = useNavigate();
  // The usage endpoint independently verifies entitlement on the server. Do
  // not suppress a dashboard refresh just because the client is temporarily
  // showing its signed-session snapshot while that verification completes.
  const canRequestVoiceUsage = snapshot.active && snapshot.state !== "unknown";
  const hasActiveMembership = snapshot.active && snapshot.state !== "unknown";
  const membershipChecking = snapshot.state === "initializing" || (snapshot.state === "refreshing" && !snapshot.active);
  const [usageState, setUsageState] = useState<UsageState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [membershipActionLoading, setMembershipActionLoading] = useState(false);

  const runMembershipRefresh = async () => {
    setMembershipActionLoading(true);
    try {
      await refresh(true);
    } finally {
      setMembershipActionLoading(false);
    }
  };

  const runGooglePlayRestore = async () => {
    setMembershipActionLoading(true);
    try {
      await restoreGooglePlayPurchase();
    } finally {
      setMembershipActionLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !canRequestVoiceUsage) {
      setUsageState(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    void apiFetch("/api/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({ action: "usage" }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as UsageResponse;
        if (!response.ok) throw new Error("Could not load Voice usage.");

        const limits = data.limits || {};
        setUsageState({
          eligible: data.eligible === true,
          usage: data.usage || null,
          maxSessionMinutes: asDisplayInteger(limits.maxSessionMinutes),
          monthlyMinutes: asDisplayInteger(limits.monthlyMinutes),
        });
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Could not load Voice usage.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [canRequestVoiceUsage, isOpen, reloadKey]);

  const usage = usageState?.usage || null;
  const membershipLabel = membershipChecking
    ? "Checking…"
    : snapshot.state === "unknown"
      ? "Unavailable"
      : hasActiveMembership
        ? "Premium"
        : "Free";
  const membershipStatus = membershipChecking
    ? "Checking access"
    : snapshot.state === "unknown"
      ? "Could not verify"
      : hasActiveMembership
        ? "Active"
        : "Free plan";
  const usagePercent = usage
    ? Math.min(100, Math.round((usage.monthlyUsedMinutes / Math.max(1, usage.monthlyLimitMinutes)) * 100))
    : 0;
  const membershipExpiryLabel = formatResetDate(snapshot.expiresAt);
  const verifiedLabel = formatVerifiedTime(snapshot.verifiedAt);
  const voiceValue = isLoading
    ? "Loading…"
    : usage
      ? `${usage.monthlyRemainingMinutes} min left of ${usage.monthlyLimitMinutes} min`
      : canRequestVoiceUsage
        ? "Unavailable"
        : "Premium only";
  const voiceRemaining = usage
    ? `${usage.monthlyUsedMinutes} min used this month`
    : canRequestVoiceUsage
      ? "Usage unavailable"
      : error
        ? "Usage unavailable"
        : "Voice is included with Premium.";
  const voiceMeta = usageState?.maxSessionMinutes
    ? `Max time per session: ${usageState.maxSessionMinutes} min`
    : "Session limit unavailable";

  const membershipBadgeClass = useMemo(
    () => hasActiveMembership
      ? "text-[color:var(--app-success)]"
      : "app-muted",
    [hasActiveMembership],
  );

  return (
    <section aria-labelledby="profile-capacity-title">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
        <div
          className="flex min-h-[11rem] flex-col rounded-[1.4rem] border p-4"
          style={{
            background: "var(--app-card-soft)",
            borderColor: "var(--app-card-border)",
          }}
        >
          <p className="app-kicker">Your membership</p>
          <p className="app-heading mt-7 text-[27px] font-semibold tracking-tight">{membershipLabel}</p>
          <span
            className={`mt-5 inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${membershipBadgeClass}`}
            style={{
              background: hasActiveMembership ? "var(--app-success-soft)" : "var(--app-secondary-bg)",
            }}
          >
            {membershipChecking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {membershipStatus}
          </span>
          <p className="app-muted mt-3 text-[11px]">
            {snapshot.active && membershipExpiryLabel
              ? `Ends ${membershipExpiryLabel}`
              : snapshot.active
                ? "Active membership"
                : snapshot.state === "unknown"
                  ? "Could not verify membership"
                  : "View plans to unlock premium"}
          </p>
          {snapshot.active && verifiedLabel && (
            <p className="app-muted mt-1 text-[10px]">Last verified {verifiedLabel}</p>
          )}
          {restorationError && !snapshot.active && (
            <p className="app-muted mt-2 text-[10px] leading-relaxed">
              Google Play restoration needs another try: {restorationError}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="app-muted inline-flex items-center gap-1 rounded-pill px-2 py-1 text-[10px] font-semibold hover:text-[color:var(--app-accent)]"
              onClick={() => void runMembershipRefresh()}
              disabled={membershipActionLoading}
            >
              <RefreshCw className={`h-3 w-3 ${membershipActionLoading ? "animate-spin" : ""}`} />
              Refresh membership
            </button>
            {!snapshot.active && snapshot.state === "inactive" && (
              <button
                type="button"
                className="app-accent rounded-pill px-2 py-1 text-[10px] font-semibold"
                onClick={() => navigate("/paywall")}
              >
                View plans
              </button>
            )}
            {isNativePlatform() && getNativePlatform() === "android" && (
              <button
                type="button"
                className="app-muted rounded-pill px-2 py-1 text-[10px] font-semibold hover:text-[color:var(--app-accent)]"
                onClick={() => void runGooglePlayRestore()}
                disabled={membershipActionLoading}
              >
                Restore Google Play
              </button>
            )}
          </div>
        </div>

        <div
          className="rounded-[1.4rem] border p-4"
          style={{
            background: "var(--app-card-soft)",
            borderColor: "var(--app-card-border)",
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <p id="profile-capacity-title" className="app-kicker">Capacity usage</p>
            {error && (
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="app-muted inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium hover:text-[color:var(--app-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
                aria-label="Retry loading usage"
              >
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            )}
          </div>

          <div className="mt-5 space-y-4">
            <div>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="app-heading">Text replies</span>
                <span className="app-heading font-semibold">Unlimited</span>
              </div>
              <CapacityProgress value={0} muted />
              <p className="app-muted mt-2 text-[10px]">Fair-use rate limits still protect the service.</p>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3 text-[12px]">
                <span className="app-heading">Voice allowance</span>
                <span className="app-heading text-right font-semibold">{voiceValue}</span>
              </div>
              <CapacityProgress value={usagePercent} muted={!usage} />
              <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                <span className="app-heading font-semibold">{voiceRemaining}</span>
                <span className="app-muted text-right">{voiceMeta}</span>
              </div>
              <p className="app-muted mt-2 text-[10px]">
                {error
                  ? "Could not refresh usage right now."
                  : canRequestVoiceUsage
                    ? "Renews with your next Premium billing cycle."
                    : "Voice is included with Premium."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
