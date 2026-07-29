import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  getAccessToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  JWT: class {
    constructor(options: unknown) {
      authMocks.constructor(options);
    }

    getAccessToken() {
      return authMocks.getAccessToken();
    }
  },
}));

describe("Google TTS authentication reuse", () => {
  const previousCredentials = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;

  beforeEach(() => {
    vi.resetModules();
    authMocks.constructor.mockClear();
    authMocks.getAccessToken.mockReset();
    authMocks.getAccessToken.mockResolvedValue({ token: "cached-access-token" });
    process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "tts@example.iam.gserviceaccount.com",
      private_key: "line-one\\nline-two",
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        audioContent: Buffer.from("audio").toString("base64"),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
  });

  afterEach(() => {
    if (previousCredentials === undefined) {
      delete process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON = previousCredentials;
    }
    vi.unstubAllGlobals();
  });

  it("reuses one JWT client and normalizes escaped private-key newlines", async () => {
    const { synthesizeSpeech } = await import("../server-api");

    await synthesizeSpeech("First response.");
    await synthesizeSpeech("Second response.");

    expect(authMocks.constructor).toHaveBeenCalledOnce();
    expect(authMocks.constructor).toHaveBeenCalledWith(expect.objectContaining({
      email: "tts@example.iam.gserviceaccount.com",
      key: "line-one\nline-two",
    }));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
