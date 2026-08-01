export type EntitlementState =
  | "active"
  | "grace_period"
  | "on_hold"
  | "paused"
  | "canceled"
  | "expired"
  | "revoked";

export type GooglePlayLineItem = {
  productId?: string;
  expiryTime?: string;
  latestSuccessfulOrderId?: string;
  offerDetails?: { basePlanId?: string; offerId?: string };
};

type AllowedPlan = {
  productId: string;
  basePlanId: string;
  offerIds: Set<string>;
};

const NONE = "__NONE__";
const configured = (value: string | undefined, fallback: string) => value?.trim() || fallback;
const offers = (value: string | undefined, fallback: string) => new Set(
  configured(value, fallback).split(",").map((item) => item.trim()).filter(Boolean),
);

export const getGooglePlaySubscriptionAllowlist = (): AllowedPlan[] => [
  {
    productId: configured(process.env.GOOGLE_PLAY_MONTHLY_PRODUCT_ID, "biblenova"),
    basePlanId: configured(process.env.GOOGLE_PLAY_MONTHLY_BASE_PLAN_ID, "monthly"),
    offerIds: offers(process.env.GOOGLE_PLAY_MONTHLY_ALLOWED_OFFER_IDS, `trial,${NONE}`),
  },
  {
    productId: configured(process.env.GOOGLE_PLAY_YEARLY_PRODUCT_ID, "biblenovayearly"),
    basePlanId: configured(process.env.GOOGLE_PLAY_YEARLY_BASE_PLAN_ID, "yearlyoffer"),
    offerIds: offers(process.env.GOOGLE_PLAY_YEARLY_ALLOWED_OFFER_IDS, NONE),
  },
];

export const selectAllowedGooglePlayLineItem = (lineItems: GooglePlayLineItem[]) => {
  const allowlist = getGooglePlaySubscriptionAllowlist();
  const matches = lineItems.filter((item) => {
    const plan = allowlist.find((candidate) => (
      candidate.productId === item.productId &&
      candidate.basePlanId === item.offerDetails?.basePlanId
    ));
    if (!plan) return false;
    return plan.offerIds.has(item.offerDetails?.offerId?.trim() || NONE);
  });

  if (matches.length !== 1) {
    throw new Error(matches.length
      ? "Google Play returned an ambiguous Bible Nova subscription."
      : "This Google Play purchase is not an allowed Bible Nova subscription.");
  }
  return matches[0];
};

export const mapGooglePlaySubscriptionState = (state: string | undefined): EntitlementState => {
  const states: Record<string, EntitlementState> = {
    SUBSCRIPTION_STATE_ACTIVE: "active",
    SUBSCRIPTION_STATE_IN_GRACE_PERIOD: "grace_period",
    SUBSCRIPTION_STATE_ON_HOLD: "on_hold",
    SUBSCRIPTION_STATE_PAUSED: "paused",
    SUBSCRIPTION_STATE_CANCELED: "canceled",
    SUBSCRIPTION_STATE_EXPIRED: "expired",
    SUBSCRIPTION_STATE_PENDING: "on_hold",
  };
  return states[state || ""] || "revoked";
};

export const stateUnlocksPremium = (
  state: EntitlementState,
  expiryTime?: string | null,
  now = Date.now(),
) => {
  if (state !== "active" && state !== "grace_period" && state !== "canceled") return false;
  if (!expiryTime) return false;
  const expiry = Date.parse(expiryTime);
  return Number.isFinite(expiry) && expiry > now;
};
