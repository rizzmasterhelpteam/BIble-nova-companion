export type EntitlementState =
  | "initializing"
  | "active"
  | "inactive"
  | "unknown"
  | "refreshing";

export type EntitlementStatus =
  | "active"
  | "grace_period"
  | "canceled_until_expiry"
  | "expired"
  | "none"
  | "unknown";

export type EntitlementSource =
  | "server"
  | "signed_session_metadata"
  | "google_play"
  | "none";

export type EntitlementSnapshot = {
  state: EntitlementState;
  active: boolean;
  status: EntitlementStatus;
  source: EntitlementSource;
  productId: string | null;
  expiresAt: string | null;
  verifiedAt: string | null;
  error: string | null;
};
