import { createHash } from "node:crypto";
import {
  createGeminiLiveEphemeralToken,
  getVoiceSessionConfig,
  VoiceTokenTimingError,
} from "../../live-api.js";
import {
  acquireVoiceSessionLease,
  acknowledgeVoiceTokenIdempotency,
  attachVoiceTokenIdempotencyLease,
  cancelUnstartedVoiceSessionLease,
  claimVoiceSessionRenewal,
  createVoiceReservationHandle,
  deleteVoiceTokenIdempotency,
  enforceRateLimits,
  getHttpErrorDetails,
  getServerShadowNotes,
  getVoiceUsageLimits,
  finalizeVoiceSessionRenewal,
  beginVoiceTokenIdempotency,
  completeVoiceTokenIdempotency,
  cleanupExpiredVoiceTokenIdempotency,
  getVoiceTokenIdempotencyResponse,
  hashVoiceReservationHandle,
  releaseVoiceSessionLease,
  rollbackVoiceSessionRenewal,
  requireAuthenticatedRequest,
} from "../../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Client-Request-Id");
};

const getRemainingSeconds = (expiresAt: string) =>
  Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));

const hashUserId = (userId: string) =>
  createHash("sha256").update(userId).digest("hex").slice(0, 16);

const logTokenEvent = (event: string, details: Record<string, unknown>) => {
  console.info("[live/token]", { event, ...details });
};

const getSafeErrorReason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 240);

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  let activeUserId: string | null = null;
  let activeRequestId: string | null = null;
  let activeAction = "unknown";
  let activeStage = "request";
  let idempotencyStarted = false;
  try {
    activeStage = "authenticate";
    const { userId, ip } = await requireAuthenticatedRequest(req);
    activeUserId = userId;
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const requestHeader = req.headers?.["x-client-request-id"];
    const requestId = Array.isArray(requestHeader) ? requestHeader[0] : requestHeader;
    activeAction = typeof body.action === "string"
      ? body.action
      : body.reservationHandle !== undefined
        ? "renew"
        : "start";
    const userIdHash = hashUserId(userId);
    logTokenEvent("request", {
      action: activeAction,
      userIdHash,
      requestIdPresent: typeof requestId === "string",
    });
    if (body.action === "release") {
      const handleHash = hashVoiceReservationHandle(body.reservationHandle);
      if (!handleHash) {
        res.status(400).json({ error: "This Voice reservation is invalid." });
        return;
      }
      await releaseVoiceSessionLease(userId, handleHash);
      logTokenEvent("reservation-released", { action: activeAction, userIdHash });
      res.status(204).end();
      return;
    }

    if (typeof requestId !== "string") {
      res.status(400).json({ error: "Voice request identifier is required.", reason: "connection_failed" });
      return;
    }
    activeRequestId = requestId;
    if (body.action === "acknowledge") {
      activeStage = "idempotency-acknowledge";
      await acknowledgeVoiceTokenIdempotency(userId, requestId);
      logTokenEvent("acknowledged", { action: activeAction, userIdHash, requestIdPresent: true });
      res.status(204).end();
      return;
    }
    if (body.action === "recover") {
      activeStage = "idempotency-cleanup";
      await cleanupExpiredVoiceTokenIdempotency();
      activeStage = "idempotency-recovery-read";
      const previousResponse = await getVoiceTokenIdempotencyResponse(userId, requestId);
      if (previousResponse) {
        logTokenEvent("recovery", { action: activeAction, userIdHash, requestIdPresent: true, recoveryHit: true });
        res.status(200).json(previousResponse);
        return;
      }
      logTokenEvent("recovery", {
        action: activeAction,
        userIdHash,
        requestIdPresent: true,
        recoveryHit: false,
        recoveryReason: "no_row",
      });
      res.status(404).json({ error: "No recoverable Voice start was found.", reason: "connection_failed" });
      return;
    }
    activeStage = "idempotency-read";
    const previousResponse = await getVoiceTokenIdempotencyResponse(userId, requestId);
    if (previousResponse) {
      res.status(200).json(previousResponse);
      return;
    }

    let renewalHandleHash: string | null = null;
    if (body.reservationHandle !== undefined) {
      renewalHandleHash = hashVoiceReservationHandle(body.reservationHandle);
      if (!renewalHandleHash) {
        res.status(400).json({
          error: "This Voice reservation is invalid.",
          reason: "reservation_invalid",
        });
        return;
      }
    }
    await enforceRateLimits([
      { key: `live-token:user:${userId}`, limit: 6 },
      { key: `live-token:ip:${ip}`, limit: 12 },
    ]);
    activeStage = "idempotency-begin";
    if (!await beginVoiceTokenIdempotency(userId, requestId)) {
      activeStage = "idempotency-duplicate-read";
      const completedResponse = await getVoiceTokenIdempotencyResponse(userId, requestId);
      if (completedResponse) {
        logTokenEvent("idempotency-hit", { action: activeAction, userIdHash, requestIdPresent: true });
        res.status(200).json(completedResponse);
        return;
      }
      logTokenEvent("idempotency-in-progress", { action: activeAction, userIdHash, requestIdPresent: true });
      res.status(409).json({ error: "Voice start is already in progress. Please retry shortly.", reason: "connection_failed" });
      return;
    }
    idempotencyStarted = true;

    if (body.reservationHandle !== undefined) {
      activeStage = "renewal-claim";
      const renewal = await claimVoiceSessionRenewal(userId, renewalHandleHash!);
      logTokenEvent("eligibility", { action: activeAction, userIdHash, eligible: true, mode: "renewal" });
      try {
        activeStage = "shadow-notes";
        const shadowNotes = await getServerShadowNotes(userId);
        activeStage = "gemini-token";
        const session = await createGeminiLiveEphemeralToken({
          shadowNotes,
          reservationExpiresAt: renewal.expiresAt,
        });
        activeStage = "renewal-finalize";
        await finalizeVoiceSessionRenewal(userId, renewal.claimHash);
        const responsePayload = {
          ...session,
          reservationHandle: body.reservationHandle,
          reservationExpiresAt: renewal.expiresAt,
          remainingSeconds: getRemainingSeconds(renewal.expiresAt),
        };
        activeStage = "idempotency-complete";
        await completeVoiceTokenIdempotency(userId, requestId, responsePayload, renewal.leaseId);
        res.status(200).json(responsePayload);
      } catch (error) {
        logTokenEvent("token-creation-failed", {
          action: activeAction,
          userIdHash,
          reason: getSafeErrorReason(error),
          renewal: true,
        });
        await rollbackVoiceSessionRenewal(userId, renewal.claimHash);
        throw error;
      }
      return;
    }

    const { maxMinutes } = getVoiceSessionConfig();
    const { dailyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const { handle, handleHash } = createVoiceReservationHandle();
    activeStage = "lease-acquire";
    const lease = await acquireVoiceSessionLease(
      userId,
      maxMinutes,
      dailyMinutes,
      resetOffsetMinutes,
      handleHash,
    );
    logTokenEvent("eligibility", { action: activeAction, userIdHash, eligible: true, mode: "new_reservation" });
    try {
      activeStage = "idempotency-attach-lease";
      await attachVoiceTokenIdempotencyLease(userId, requestId, lease.leaseId);
      activeStage = "shadow-notes";
      const shadowNotes = await getServerShadowNotes(userId);
      activeStage = "gemini-token";
      const session = await createGeminiLiveEphemeralToken({
        shadowNotes,
        reservationExpiresAt: lease.expiresAt,
      });
      const responsePayload = {
        ...session,
        reservationHandle: handle,
        reservationExpiresAt: lease.expiresAt,
        remainingSeconds: getRemainingSeconds(lease.expiresAt),
      };
      activeStage = "idempotency-complete";
      await completeVoiceTokenIdempotency(userId, requestId, responsePayload, lease.leaseId);
      res.status(200).json(responsePayload);
    } catch (error) {
      logTokenEvent("token-creation-failed", {
        action: activeAction,
        userIdHash,
        reason: getSafeErrorReason(error),
        renewal: false,
      });
      await cancelUnstartedVoiceSessionLease(userId, lease.leaseId);
      throw error;
    }
  } catch (error) {
    if (idempotencyStarted && activeUserId && activeRequestId) {
      try {
        await deleteVoiceTokenIdempotency(activeUserId, activeRequestId);
      } catch (cleanupError) {
        console.error("Voice token idempotency cleanup threw after a failed start:", {
          stage: activeStage,
          action: activeAction,
          userIdHash: hashUserId(activeUserId),
          requestIdPresent: true,
          reason: getSafeErrorReason(cleanupError),
        });
      }
    }
    const tokenTimingError = error instanceof VoiceTokenTimingError ? error : null;
    const details = tokenTimingError
      ? {
          statusCode: tokenTimingError.statusCode,
          message: tokenTimingError.message,
          retryAfterSeconds: undefined,
        }
      : getHttpErrorDetails(error);
    if (details.statusCode >= 500) {
      console.error("Voice token request failed:", {
        stage: activeStage,
        action: activeAction,
        userIdHash: activeUserId ? hashUserId(activeUserId) : null,
        requestIdPresent: Boolean(activeRequestId),
        reason: getSafeErrorReason(error),
      });
    }
    logTokenEvent("failure", {
      action: activeAction,
      userIdHash: activeUserId ? hashUserId(activeUserId) : null,
      requestIdPresent: Boolean(activeRequestId),
      stage: activeStage,
      statusCode: details.statusCode,
      reason: getSafeErrorReason(error),
    });
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({
      error:
        details.statusCode === 500
          ? "Voice is temporarily unavailable. You can continue in Chat."
          : details.message,
      reason:
        tokenTimingError
          ? tokenTimingError.reason
          : details.statusCode === 403
          ? "subscription_required"
          : details.statusCode === 409
            ? details.message.toLowerCase().includes("cannot be renewed")
              ? "renewal_unavailable"
              : "session_active"
            : details.statusCode === 429 && details.message.toLowerCase().includes("daily")
              ? "daily_limit"
              : "connection_failed",
    });
  }
}
