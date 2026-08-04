import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiStatus = vi.hoisted(() => vi.fn());
const enforceRateLimits = vi.hoisted(() => vi.fn());
const requireAuthenticatedRequest = vi.hoisted(() => vi.fn());

vi.mock("../server-api", () => ({ getApiStatus }));
vi.mock("../server-security", () => ({
  enforceRateLimits,
  getHttpErrorDetails: (error: Error & { statusCode?: number }) => ({
    statusCode: error.statusCode || 500,
    message: error.message,
  }),
  requireAuthenticatedRequest,
}));

import statusHandler from "../api/status";

const createResponse = () => {
  const headers = new Map<string, string>();
  const response = {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: string) => headers.set(name, value)),
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
    end: vi.fn(),
  };
  return response;
};

describe("status endpoint cache policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiStatus.mockReturnValue({ chatReady: true, voiceReady: true });
    enforceRateLimits.mockResolvedValue(undefined);
    requireAuthenticatedRequest.mockResolvedValue({ userId: "user-1", ip: "127.0.0.1" });
  });

  it("sets no-store headers on public liveness responses", async () => {
    const response = createResponse();

    await statusHandler({ method: "GET" }, response);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate, proxy-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Cache-Control");
    expect(response.body).toEqual({ ok: true });
    expect(response.body).not.toHaveProperty("voiceReady");
  });

  it("keeps readiness behind authentication while preserving its URL contract", async () => {
    const response = createResponse();

    await statusHandler({ method: "GET", query: { mode: "ready" }, headers: {} }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ chatReady: true, voiceReady: true });
    expect(requireAuthenticatedRequest).toHaveBeenCalledOnce();
    expect(enforceRateLimits).toHaveBeenCalledWith([
      { key: "api-readiness:user:user-1", limit: 30 },
      { key: "api-readiness:ip:127.0.0.1", limit: 60 },
    ]);
  });

  it("sets no-store headers on OPTIONS responses", async () => {
    const response = createResponse();

    await statusHandler({ method: "OPTIONS" }, response);

    expect(response.statusCode).toBe(204);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.end).toHaveBeenCalledOnce();
  });
});
