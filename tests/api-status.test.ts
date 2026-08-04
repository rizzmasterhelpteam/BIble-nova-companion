import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApiStatusLoader } from "../src/lib/apiStatus";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/apiClient", () => ({ apiFetch }));
vi.mock("../src/lib/native/platform", () => ({ isNativePlatform: () => false }));

const createResponse = (status: number, body?: unknown) => ({
  status,
  ok: status >= 200 && status < 300,
  json: vi.fn(async () => body),
}) as unknown as Response;

describe("API readiness status loading", () => {
  let fetcher: ReturnType<typeof vi.fn>;
  let logger: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetcher = vi.fn();
    logger = vi.fn();
  });

  it("requests status with browser cache disabled and keeps successful Voice readiness", async () => {
    fetcher.mockResolvedValueOnce(createResponse(200, {
      chatReady: true,
      prayerReady: true,
      speechReady: true,
      ttsReady: true,
      voiceReady: true,
    }));
    const loadApiStatus = createApiStatusLoader(fetcher, logger);

    await expect(loadApiStatus()).resolves.toMatchObject({ voiceReady: true });
    expect(fetcher).toHaveBeenCalledWith("/api/status/ready", {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    expect(logger).toHaveBeenLastCalledWith(expect.objectContaining({
      httpStatus: 200,
      responseOk: true,
      returnedVoiceReady: true,
      usedLastKnownGood: false,
    }));
  });

  it("cache-busts forced refreshes", async () => {
    fetcher
      .mockResolvedValueOnce(createResponse(200, { voiceReady: true }))
      .mockResolvedValueOnce(createResponse(200, { voiceReady: true }));
    const loadApiStatus = createApiStatusLoader(fetcher, logger);

    await loadApiStatus();
    await loadApiStatus(true);

    const [requestUrl, requestInit] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(requestUrl).toMatch(/^\/api\/status\/ready\?refresh=\d+$/);
    expect(requestInit.cache).toBe("no-store");
    expect(new Headers(requestInit.headers).get("Cache-Control")).toBe("no-cache");
  });

  it("preserves last-known-good Voice readiness after a transient 304", async () => {
    fetcher
      .mockResolvedValueOnce(createResponse(200, {
        chatReady: true,
        prayerReady: true,
        speechReady: true,
        ttsReady: true,
        voiceReady: true,
      }))
      .mockResolvedValueOnce(createResponse(304))
      .mockResolvedValueOnce(createResponse(200, { voiceReady: true }));
    const loadApiStatus = createApiStatusLoader(fetcher, logger);

    await loadApiStatus();
    const cachedFailure = await loadApiStatus(true);
    expect(cachedFailure.voiceReady).toBe(true);
    expect(cachedFailure.connectionError).toContain("304");
    expect(logger).toHaveBeenLastCalledWith(expect.objectContaining({
      httpStatus: 304,
      returnedVoiceReady: true,
      usedLastKnownGood: true,
    }));

    const readyForVoiceStart = (await loadApiStatus(true)).voiceReady === true;
    expect(readyForVoiceStart).toBe(true);
  });

  it("preserves last-known-good readiness after a non-304 transient failure", async () => {
    fetcher
      .mockResolvedValueOnce(createResponse(200, { voiceReady: true }))
      .mockResolvedValueOnce(createResponse(503));
    const loadApiStatus = createApiStatusLoader(fetcher, logger);

    await loadApiStatus();
    const fallback = await loadApiStatus(true);

    expect(fallback.voiceReady).toBe(true);
    expect(fallback.connectionError).toContain("503");
  });
});
