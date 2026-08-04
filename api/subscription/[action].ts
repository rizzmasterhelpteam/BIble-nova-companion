import {
  getNativeSubscriptionClientErrorMessage,
  syncNativeSubscription,
} from "../../server-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { setApiCorsHeaders } from "../../server-cors.js";

const getAction = (req: any) => {
  const action = req?.query?.action;
  if (Array.isArray(action)) return action[0];
  if (typeof action === "string") return action;

  try {
    return new URL(req?.url || "", "https://biblecompanion.vercel.app")
      .pathname
      .split("/")
      .filter(Boolean)
      .pop();
  } catch {
    return undefined;
  }
};

export default async function handler(req: any, res: any) {
  const action = getAction(req);
  const methods = action === "native-sync" ? "GET, POST, OPTIONS" : "GET, OPTIONS";
  if (!setApiCorsHeaders(req, res, methods, "Content-Type, Authorization, Cache-Control")) return;

  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0");
  res.setHeader?.("Pragma", "no-cache");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (action === "status") {
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

  if (action === "native-sync") {
    if (req.method === "GET") {
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
          subscription: {
            status: status.status,
            source: status.source,
            productId: status.productId || undefined,
            trialEndsAt: status.expiresAt || undefined,
            accessActive: status.active,
          },
          checkedAt: new Date().toISOString(),
        });
      } catch (error) {
        const details = getHttpErrorDetails(error);
        if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
        res.status(details.statusCode).json({ error: details.message });
      }
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed." });
      return;
    }

    try {
      const { userId } = await requireAuthenticatedRequest(req);
      await enforceRateLimits([
        { key: `subscription-sync:user:${userId}`, limit: 10 },
      ]);
      const subscription = await syncNativeSubscription(req.headers.authorization, req.body || {});
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

  res.status(404).json({ error: "Subscription action not found." });
}
