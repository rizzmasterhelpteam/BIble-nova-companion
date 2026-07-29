import { describe, expect, it } from "vitest";
import {
  createVoiceTranscriptionFormData,
  getVoiceAudioFilename,
  isSupportedVoiceAudioMimeType,
} from "../src/lib/voiceTranscription";

describe("Voice transcription uploads", () => {
  it("sends the recording directly as multipart FormData", () => {
    const blob = new Blob(["recording"], {
      type: "audio/webm;codecs=opus",
    });
    const formData = createVoiceTranscriptionFormData(blob, "en");
    const file = formData.get("file");

    expect(formData).toBeInstanceOf(FormData);
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).size).toBe(blob.size);
    expect((file as Blob).type).toBe("audio/webm;codecs=opus");
    expect(formData.get("language")).toBe("en");
  });

  it("keeps Android WebView MediaRecorder formats compatible", () => {
    expect(isSupportedVoiceAudioMimeType("audio/webm;codecs=opus")).toBe(true);
    expect(isSupportedVoiceAudioMimeType("audio/webm")).toBe(true);
    expect(isSupportedVoiceAudioMimeType("audio/mp4")).toBe(true);
    expect(isSupportedVoiceAudioMimeType("audio/ogg;codecs=opus")).toBe(true);
    expect(getVoiceAudioFilename("audio/mp4")).toBe("speech.mp4");
    expect(isSupportedVoiceAudioMimeType("audio/wav")).toBe(false);
  });

  it("lets Auto and Hinglish omit Whisper's forced English language", () => {
    const blob = new Blob(["recording"], { type: "audio/webm" });

    expect(createVoiceTranscriptionFormData(blob).get("language")).toBeNull();
    expect(createVoiceTranscriptionFormData(blob, "hi", "hindi").get("language")).toBe("hi");
    expect(createVoiceTranscriptionFormData(blob, undefined, "hinglish").get("voiceLanguage")).toBe("hinglish");
  });
});
