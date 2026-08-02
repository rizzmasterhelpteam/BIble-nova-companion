import { beforeEach, describe, expect, it, vi } from "vitest";

const serverApi = vi.hoisted(() => ({
  loadShadowMemoryProfile: vi.fn(),
  saveShadowNotes: vi.fn(),
  setShadowMemoryPreference: vi.fn(),
}));
const security = vi.hoisted(() => ({
  enforceRateLimits: vi.fn(),
  requireAuthenticatedRequest: vi.fn(),
}));
const createShadowNotes = vi.hoisted(() => vi.fn());

vi.mock("../server-api", () => serverApi);
vi.mock("../chat-api", () => ({
  createShadowNotes,
  MAX_SHADOW_NOTES_CHARS: 4_000,
  getClientErrorMessage: (error: Error) => error.message,
}));
vi.mock("../server-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server-security")>();
  return {
    ...actual,
    enforceRateLimits: security.enforceRateLimits,
    requireAuthenticatedRequest: security.requireAuthenticatedRequest,
  };
});

import shadowMemoryHandler from "../api/shadow-notes";
import voiceShadowMemoryHandler from "../api/voice/shadow-notes";

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
    headers,
  };
  return response;
};

describe("shadow memory consent API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    security.requireAuthenticatedRequest.mockResolvedValue({
      userId: "user-1",
      ip: "127.0.0.1",
    });
    security.enforceRateLimits.mockResolvedValue(undefined);
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: false,
      shadowNotes: null,
    });
  });

  it("returns the authenticated user's preference with private no-store headers", async () => {
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: "User prefers concise reflections.",
    });
    const response = createResponse();

    await shadowMemoryHandler({ method: "GET" }, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      memoryEnabled: true,
      shadowNotes: "User prefers concise reflections.",
    });
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Cache-Control");
  });

  it("updates explicit consent and returns the confirmed server state", async () => {
    serverApi.setShadowMemoryPreference.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: null,
    });
    const response = createResponse();

    await shadowMemoryHandler(
      { method: "PUT", body: { memoryEnabled: true } },
      response,
    );

    expect(serverApi.setShadowMemoryPreference).toHaveBeenCalledWith("user-1", true, undefined);
    expect(response.body).toEqual({ memoryEnabled: true, shadowNotes: null });
  });

  it("enables consent and saves initial onboarding notes in one request", async () => {
    serverApi.setShadowMemoryPreference.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: "User memory:\n- Preferred tone: gentle",
    });
    const response = createResponse();
    await shadowMemoryHandler(
      { method: "PUT", body: { memoryEnabled: true, initialNotes: "User memory:\n- Preferred tone: gentle" } },
      response,
    );
    expect(serverApi.setShadowMemoryPreference).toHaveBeenCalledWith(
      "user-1", true, "User memory:\n- Preferred tone: gentle",
    );
  });

  it("refuses note persistence while memory is disabled", async () => {
    const response = createResponse();

    await shadowMemoryHandler(
      { method: "POST", body: { notes: "Should not be retained." } },
      response,
    );

    expect(serverApi.saveShadowNotes).not.toHaveBeenCalled();
    expect(response.body).toEqual({ memoryEnabled: false, shadowNotes: null });
  });

  it("saves notes only after consent is enabled", async () => {
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: null,
    });
    serverApi.saveShadowNotes.mockResolvedValue("Saved context");
    const response = createResponse();

    await shadowMemoryHandler(
      { method: "POST", body: { notes: "Saved context" } },
      response,
    );

    expect(serverApi.saveShadowNotes).toHaveBeenCalledWith("user-1", "Saved context");
    expect(response.body).toEqual({
      memoryEnabled: true,
      shadowNotes: "Saved context",
    });
  });

  it("accepts shadow notes up to the new 4,000-character limit", async () => {
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: null,
    });
    const notes = "x".repeat(4_000);
    serverApi.saveShadowNotes.mockResolvedValue(notes);
    const response = createResponse();

    await shadowMemoryHandler(
      { method: "POST", body: { notes } },
      response,
    );

    expect(response.statusCode).toBe(200);
    expect(serverApi.saveShadowNotes).toHaveBeenCalledWith("user-1", notes);
  });

  it("rejects shadow notes above 4,000 characters", async () => {
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: null,
    });
    const response = createResponse();

    await shadowMemoryHandler(
      { method: "POST", body: { notes: "x".repeat(4_001) } },
      response,
    );

    expect(response.statusCode).toBe(413);
    expect(serverApi.saveShadowNotes).not.toHaveBeenCalled();
  });

  it("rejects an invalid preference value", async () => {
    const response = createResponse();

    await shadowMemoryHandler(
      { method: "PUT", body: { memoryEnabled: "yes" } },
      response,
    );

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Memory preference must be true or false.",
    });
  });
});

describe("Voice shadow memory consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    security.requireAuthenticatedRequest.mockResolvedValue({
      userId: "user-1",
      ip: "127.0.0.1",
    });
    security.enforceRateLimits.mockResolvedValue(undefined);
  });

  it("does not generate or save Voice notes when memory is disabled", async () => {
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: false,
      shadowNotes: null,
    });
    const response = createResponse();

    await voiceShadowMemoryHandler(
      {
        method: "POST",
        body: { messages: [{ role: "user", content: "Remember this." }] },
      },
      response,
    );

    expect(createShadowNotes).not.toHaveBeenCalled();
    expect(serverApi.saveShadowNotes).not.toHaveBeenCalled();
    expect(response.body).toEqual({ memoryEnabled: false, shadowNotes: null });
  });

  it("generates from canonical stored context after consent", async () => {
    serverApi.loadShadowMemoryProfile.mockResolvedValue({
      memoryEnabled: true,
      shadowNotes: "Canonical context",
    });
    createShadowNotes.mockResolvedValue("Updated context");
    serverApi.saveShadowNotes.mockResolvedValue("Updated context");
    const response = createResponse();

    await voiceShadowMemoryHandler(
      {
        method: "POST",
        body: {
          messages: [{ role: "user", content: "A new preference." }],
          shadowNotes: "Untrusted client context",
        },
      },
      response,
    );

    expect(createShadowNotes).toHaveBeenCalledWith(
      [{ role: "user", content: "A new preference." }],
      "Canonical context",
    );
    expect(response.body).toEqual({
      memoryEnabled: true,
      shadowNotes: "Updated context",
    });
  });
});
