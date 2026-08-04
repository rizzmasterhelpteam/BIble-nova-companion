import {
  getApiStatus,
  getNativeSubscriptionClientErrorMessage,
  syncNativeSubscription,
} from "../server-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
} from "../server-security.js";
import { setApiCorsHeaders } from "../server-cors.js";

const setStatusHeaders = (res: any) => {
  res.setHeader?.("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader?.("Pragma", "no-cache");
  res.setHeader?.("Expires", "0");
};

const getQueryValue = (req: any, key: string) => {
  const queryValue = req?.query?.[key];
  if (Array.isArray(queryValue)) return queryValue[0];
  if (typeof queryValue === "string") return queryValue;

  try {
    return new URL(req?.url || "", "https://biblecompanion.vercel.app")
      .searchParams
      .get(key) || undefined;
  } catch {
    return undefined;
  }
};

const isReadinessRequest = (req: any) => getQueryValue(req, "mode") === "ready";
const isSubscriptionStatusRequest = (req: any) => getQueryValue(req, "mode") === "subscription-status";
const isSubscriptionNativeSyncRequest = (req: any) => getQueryValue(req, "mode") === "subscription-native-sync";
const hasAuthenticatedStatusRequest = (req: any) => {
  const authorization = req?.headers?.authorization || req?.headers?.Authorization;
  return typeof authorization === "string" && authorization.trim().length > 0;
};

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, POST, OPTIONS", "Content-Type, Authorization, Cache-Control")) return;
  setStatusHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (isSubscriptionStatusRequest(req)) {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    try {
      const { userId } = await requireAuthenticatedRequest(req);
      await enforceRateLimits([
        { key: `subscription-status:user:${userId}`, limit: 60 },
      ]);
      const status = await getSubscriptionAccessStatus(userId);
      res.status(200).json({
        state: status.state,
        active: status.active,
        status: status.status,
        source: status.source,
        productId: status.productId,
        expiresAt: status.expiresAt,
        verifiedAt: status.verifiedAt,
        reconciliationRecommended: status.reconciliationRecommended,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      const details = getHttpErrorDetails(error);
      if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
      res.status(details.statusCode).json({ error: details.message });
    }
    return;
  }

  if (isSubscriptionNativeSyncRequest(req)) {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    try {
      const { userId } = await requireAuthenticatedRequest(req);
      await enforceRateLimits([
        { key: `subscription-sync:user:${userId}`, limit: 10 },
      ]);
      const subscription = await syncNativeSubscription(req.headers?.authorization, req.body || {});
      res.status(200).json({ subscription });
    } catch (error) {
      const details = getHttpErrorDetails(error);
      const expectedClientOrBusinessOutcome = details.statusCode >= 400 && details.statusCode < 500;
      (expectedClientOrBusinessOutcome ? console.warn : console.error)(
        "Vercel API native subscription sync outcome:",
        {
          statusCode: details.statusCode,
          message: details.message,
        },
      );
      if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
      res.status(details.statusCode).json({
        error: details.statusCode >= 500
          ? getNativeSubscriptionClientErrorMessage(error)
          : details.message,
      });
    }
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!isReadinessRequest(req) && !hasAuthenticatedStatusRequest(req)) {
    // Keep public liveness intentionally non-sensitive. Provider readiness and
    // configuration details belong behind the authenticated readiness mode.
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const { userId } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `api-readiness:user:${userId}`, limit: 30 },
    ]);
    res.status(200).json(getApiStatus());
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.message });
  }
}
