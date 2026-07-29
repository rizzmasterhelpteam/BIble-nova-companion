import { describe, expect, it } from "vitest";
import { readVoiceAudioResponse } from "../src/lib/voiceAudioResponse";

describe("Voice TTS response decoding", () => {
  it("reads the fast binary MP3 response", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Type": "audio/mpeg" },
    });

    expect(new Uint8Array(await readVoiceAudioResponse(response)))
      .toEqual(new Uint8Array([1, 2, 3]));
  });

  it("keeps the older base64 JSON response compatible", async () => {
    const response = Response.json({
      audioContent: btoa("mp3"),
    });

    expect(new TextDecoder().decode(await readVoiceAudioResponse(response)))
      .toBe("mp3");
  });
});
