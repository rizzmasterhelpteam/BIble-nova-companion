import { Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import type { VoiceUsageSummary } from "../types/live";

type ProfileCapacityCardProps = {
  isOpen: boolean;
  isSubscribed: boolean;
  isSubscriptionResolved: boolean;
};

type UsageResponse = {
  eligible?: boolean;
  usage?: VoiceUsageSummary | null;
  limits?: {
    maxSessionMinutes?: number;
    dailyMinutes?: number;
    monthlyMinutes?: number;
  };
};

type UsageState = {
  eligible: boolean;
  usage: VoiceUsageSummary | null;
  maxSessionMinutes: number;
  dailyMinutes: number;
  monthlyMinutes: number;
};

const DEFAULT_LIMITS = {
  maxSessionMinutes: 15,
  dailyMinutes: 20,
  monthlyMinutes: 180,
};

const asBoundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, Math.floor(number)))
    : fallback;
};

const formatResetDate = (value: string | null) => {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value));
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
  isSubscribed,
  isSubscriptionResolved,
}: ProfileCapacityCardProps) {
  const [usageState, setUsageState] = useState<UsageState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;

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
          maxSessionMinutes: asBoundedInteger(limits.maxSessionMinutes, DEFAULT_LIMITS.maxSessionMinutes, 1, 15),
          dailyMinutes: asBoundedInteger(limits.dailyMinutes, DEFAULT_LIMITS.dailyMinutes, 1, 240),
          monthlyMinutes: asBoundedInteger(limits.monthlyMinutes, DEFAULT_LIMITS.monthlyMinutes, 1, 1_440),
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
  }, [isOpen, reloadKey]);

  const limits = usageState || DEFAULT_LIMITS;
  const usage = usageState?.usage || null;
  const hasVerifiedVoiceAccess = isSubscribed || usageState?.eligible === true;
  const membershipLabel = !isSubscriptionResolved && !isSubscribed ? "Checking…" : hasVerifiedVoiceAccess ? "Premium" : "Free";
  const membershipStatus = !isSubscriptionResolved && !isSubscribed
    ? "Checking access"
    : hasVerifiedVoiceAccess
      ? "Active"
      : "Free plan";
  const usagePercent = usage
    ? Math.min(100, Math.round((usage.monthlyUsedMinutes / Math.max(1, usage.monthlyLimitMinutes)) * 100))
    : 0;
  const resetLabel = formatResetDate(usage?.monthlyResetAt || null);
  const voiceValue = isLoading
    ? "Loading…"
    : usage
      ? `${usage.monthlyUsedMinutes} min / ${usage.monthlyLimitMinutes} min`
      : hasVerifiedVoiceAccess
        ? "Unavailable"
        : "Premium only";
  const voiceRemaining = usage
    ? `${usage.monthlyRemainingMinutes} min left`
    : hasVerifiedVoiceAccess
      ? "Usage unavailable"
      : error
        ? "Usage unavailable"
        : `${limits.monthlyMinutes} min/month on Premium`;
  const voiceMeta = usage
    ? `Max session: ${limits.maxSessionMinutes} min`
    : `Max session: ${limits.maxSessionMinutes} min · Daily: ${limits.dailyMinutes} min`;

  const membershipBadgeClass = useMemo(
    () => hasVerifiedVoiceAccess
      ? "text-[color:var(--app-success)]"
      : "app-muted",
    [hasVerifiedVoiceAccess],
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
              background: hasVerifiedVoiceAccess ? "var(--app-success-soft)" : "var(--app-secondary-bg)",
            }}
          >
            {!isSubscriptionResolved && !isSubscribed ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {membershipStatus}
          </span>
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
                <span className="app-heading font-semibold">No daily cap</span>
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
                {resetLabel ? `Resets ${resetLabel}` : error ? "Could not refresh usage right now." : hasVerifiedVoiceAccess ? "Usage refreshes when this panel opens." : "Voice is included with Premium."}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
