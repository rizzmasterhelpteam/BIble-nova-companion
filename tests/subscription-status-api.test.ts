import { beforeEach, describe, expect, it, vi } from "vitest";

const enforceRateLimits = vi.hoisted(() => vi.fn());
const getSubscriptionAccessStatus = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-security", () => ({
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
}));

import subscriptionStatusHandler from "../api/subscription/status";

const createResponse = () => {
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    end: vi.fn(),
  };
  return { response, headers };
};

describe("subscription status API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthenticatedRequest.mockResolvedValue({
      userId: "user-1",
      ip: "127.0.0.1",
    });
    enforceRateLimits.mockResolvedValue(undefined);
  });

  it("returns the authoritative active entitlement state without caching", async () => {
    getSubscriptionAccessStatus.mockResolvedValue({
      active: true,
      state: "active",
      status: "active",
      source: "google_play",
      productId: "biblenova",
      expiresAt: "2026-08-01T00:00:00.000Z",
      verifiedAt: "2026-07-31T00:00:00.000Z",
      reconciliationRecommended: false,
    });
    const { response, headers } = createResponse();

    await subscriptionStatusHandler({ method: "GET", headers: {} }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      state: "active",
      active: true,
      status: "active",
      source: "google_play",
      productId: "biblenova",
      expiresAt: "2026-08-01T00:00:00.000Z",
    });
    expect(headers.get("Cache-Control")).toContain("no-store");
    expect(getSubscriptionAccessStatus).toHaveBeenCalledWith("user-1");
  });

  it("returns inactive instead of trusting client subscription metadata", async () => {
    getSubscriptionAccessStatus.mockResolvedValue({
      active: false,
      state: "inactive",
      status: "none",
      source: "none",
      productId: null,
      expiresAt: null,
      verifiedAt: null,
      reconciliationRecommended: true,
    });
    const { response } = createResponse();

    await subscriptionStatusHandler({ method: "GET", headers: {} }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      state: "inactive",
      active: false,
      status: "none",
      source: "none",
      reconciliationRecommended: true,
      expiresAt: null,
    });
  });

  it("rejects unauthenticated checks", async () => {
    requireAuthenticatedRequest.mockRejectedValue(
      Object.assign(new Error("Authentication is required."), { statusCode: 401 }),
    );
    const { response } = createResponse();

    await subscriptionStatusHandler({ method: "GET", headers: {} }, response);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "Authentication is required." });
    expect(getSubscriptionAccessStatus).not.toHaveBeenCalled();
  });

  it("preserves unknown verification as a retryable 503", async () => {
    getSubscriptionAccessStatus.mockRejectedValue(
      Object.assign(new Error("Premium verification is temporarily unavailable."), { statusCode: 503 }),
    );
    const { response } = createResponse();

    await subscriptionStatusHandler({ method: "GET", headers: {} }, response);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({ error: "Premium verification is temporarily unavailable." });
  });
});
