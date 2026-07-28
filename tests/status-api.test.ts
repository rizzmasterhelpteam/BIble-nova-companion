import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiStatus = vi.hoisted(() => vi.fn());

vi.mock("../server-api", () => ({ getApiStatus }));

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
    getApiStatus.mockReturnValue({
      chatReady: true,
      prayerReady: true,
      speechReady: true,
      liveReady: true,
    });
  });

  it("sets no-store headers on GET responses", () => {
    const response = createResponse();

    statusHandler({ method: "GET" }, response);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-cache, must-revalidate, proxy-revalidate");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Cache-Control");
    expect(response.body).toMatchObject({ liveReady: true });
  });

  it("sets no-store headers on OPTIONS responses", () => {
    const response = createResponse();

    statusHandler({ method: "OPTIONS" }, response);

    expect(response.statusCode).toBe(204);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Pragma")).toBe("no-cache");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.end).toHaveBeenCalledOnce();
  });
});
