import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
}));

vi.mock("google-auth-library", () => ({
  JWT: class {
    getAccessToken() {
      return authMocks.getAccessToken();
    }
  },
}));

const audioResponse = () =>
  new Response(
    JSON.stringify({
      audioContent: Buffer.from("natural-voice").toString("base64"),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

describe("Google TTS naturalness", () => {
  const previousCredentials = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;
  const previousAudioProfile = process.env.GOOGLE_TTS_AUDIO_PROFILE;
  const previousEndpoint = process.env.GOOGLE_TTS_ENDPOINT;

  beforeEach(() => {
    vi.resetModules();
    authMocks.getAccessToken.mockReset();
    authMocks.getAccessToken.mockResolvedValue({ token: "tts-access-token" });
    process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "tts@example.iam.gserviceaccount.com",
      private_key: "private-key",
    });
    delete process.env.GOOGLE_TTS_AUDIO_PROFILE;
    delete process.env.GOOGLE_TTS_ENDPOINT;
  });

  afterEach(() => {
    if (previousCredentials === undefined) {
      delete process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON = previousCredentials;
    }
    if (previousAudioProfile === undefined) delete process.env.GOOGLE_TTS_AUDIO_PROFILE;
    else process.env.GOOGLE_TTS_AUDIO_PROFILE = previousAudioProfile;
    if (previousEndpoint === undefined) delete process.env.GOOGLE_TTS_ENDPOINT;
    else process.env.GOOGLE_TTS_ENDPOINT = previousEndpoint;
    vi.unstubAllGlobals();
  });

  it("sends escaped speech-first SSML without applying prosody twice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { synthesizeSpeech } = await import("../server-api");

    const result = await synthesizeSpeech(
      '# Hope\n- **I hear you.**\n- Stay <close> & breathe.',
      {
        speakingRate: 0.95,
        pitch: -1,
        enableSsml: true,
      },
    );

    const request = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    expect(request.input.ssml).toContain(
      '<prosody rate="95%" pitch="-1st">',
    );
    expect(request.input.ssml).toContain("I hear you.");
    expect(request.input.ssml).toContain("&amp; breathe.");
    expect(request.input.ssml).not.toMatch(/[#*`]/);
    expect(request.audioConfig).toEqual({ audioEncoding: "MP3" });
    expect(result.synthesisMode).toBe("ssml");
    expect(result.speakingRate).toBe(0.95);
  });

  it("retries once with normalized plain text when SSML is rejected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "SSML unsupported" } }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { synthesizeSpeech } = await import("../server-api");

    const result = await synthesizeSpeech("**I hear you.** Take one breath.", {
      speakingRate: 0.94,
      pitch: -1,
      enableSsml: true,
    });

    const fallbackRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fallbackRequest.input).toEqual({
      text: "I hear you. Take one breath.",
    });
    expect(fallbackRequest.audioConfig).toEqual({
      audioEncoding: "MP3",
      speakingRate: 0.94,
      pitch: -1,
    });
    expect(result.synthesisMode).toBe("plain-fallback");
  });

  it("uses an allow-listed handset profile and a configured Google regional endpoint", async () => {
    process.env.GOOGLE_TTS_AUDIO_PROFILE = "handset-class-device";
    process.env.GOOGLE_TTS_ENDPOINT = "https://australia-southeast1-texttospeech.googleapis.com";
    const fetchMock = vi.fn().mockResolvedValue(audioResponse());
    vi.stubGlobal("fetch", fetchMock);
    const { synthesizeSpeech } = await import("../server-api");

    await synthesizeSpeech("A warm reply.", { enableSsml: false });

    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(endpoint).toBe(
      "https://australia-southeast1-texttospeech.googleapis.com/v1/text:synthesize",
    );
    expect(JSON.parse(String((request as RequestInit).body)).audioConfig).toMatchObject({
      effectsProfileId: ["handset-class-device"],
    });
  });
});
