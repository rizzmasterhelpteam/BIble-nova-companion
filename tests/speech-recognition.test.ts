import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativeSpeech = vi.hoisted(() => ({
  available: vi.fn(),
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  forceStop: vi.fn(),
  getLastPartialResult: vi.fn(),
  addListener: vi.fn(),
}));

const platform = vi.hoisted(() => ({
  isNativePlatform: vi.fn(),
  getNativePlatform: vi.fn(),
}));

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("@capgo/capacitor-speech-recognition", () => ({ SpeechRecognition: nativeSpeech }));
vi.mock("../src/lib/native/platform", () => platform);
vi.mock("../src/lib/apiClient", () => ({ apiFetch: api.apiFetch }));

import {
  createSpeechRecognitionSession,
  SPEECH_UNAVAILABLE_MESSAGE,
} from "../src/lib/speechRecognition";

class FakeMediaRecorder {
  static isTypeSupported = () => false;
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public readonly stream: MediaStream) {}

  start() {
    this.state = "recording";
    this.onstart?.();
  }

  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
}

const createCallbacks = () => ({
  onTranscript: vi.fn(),
  onListeningChange: vi.fn(),
  onProcessingChange: vi.fn(),
  onNotice: vi.fn(),
  onError: vi.fn(),
});

describe("Android speech recognition runtime", () => {
  let listeners: Map<string, (payload: unknown) => void>;
  let listenerHandles: Array<{ remove: ReturnType<typeof vi.fn> }>;

  beforeEach(() => {
    listeners = new Map();
    listenerHandles = [];
    vi.stubGlobal("window", {
      clearTimeout,
      setTimeout,
    });
    vi.stubGlobal("navigator", {
      language: "en-US",
      mediaDevices: undefined,
    });
    vi.stubGlobal("MediaRecorder", undefined);

    platform.isNativePlatform.mockReturnValue(true);
    platform.getNativePlatform.mockReturnValue("android");
    nativeSpeech.available.mockResolvedValue({ available: true });
    nativeSpeech.checkPermissions.mockResolvedValue({ speechRecognition: "granted" });
    nativeSpeech.requestPermissions.mockResolvedValue({ speechRecognition: "granted" });
    nativeSpeech.start.mockResolvedValue({ matches: [] });
    nativeSpeech.stop.mockResolvedValue(undefined);
    nativeSpeech.forceStop.mockResolvedValue(undefined);
    nativeSpeech.getLastPartialResult.mockResolvedValue({ available: false, text: "" });
    nativeSpeech.addListener.mockImplementation(async (eventName: string, callback: (payload: unknown) => void) => {
      listeners.set(eventName, callback);
      const handle = { remove: vi.fn(async () => undefined) };
      listenerHandles.push(handle);
      return handle;
    });
    api.apiFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ text: "server transcript" }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses native recognition when the plugin is available and permission is granted", async () => {
    const callbacks = createCallbacks();
    const session = createSpeechRecognitionSession(callbacks);

    const diagnostics = await session.getDiagnostics();
    expect(diagnostics).toMatchObject({
      platform: "android",
      nativeSpeechPluginAvailable: true,
      permissionResult: "granted",
      selectedSpeechMode: "native",
    });

    await session.start();
    expect(nativeSpeech.start).toHaveBeenCalledOnce();
    expect(callbacks.onListeningChange).toHaveBeenLastCalledWith(true);
  });

  it("reports a denied microphone permission and leaves recognition stopped", async () => {
    nativeSpeech.requestPermissions.mockResolvedValueOnce({ speechRecognition: "denied" });
    nativeSpeech.checkPermissions.mockResolvedValue({ speechRecognition: "denied" });
    const callbacks = createCallbacks();
    const session = createSpeechRecognitionSession(callbacks);

    await expect(session.start()).rejects.toThrow("Microphone access was denied");
    expect(nativeSpeech.start).not.toHaveBeenCalled();
    expect(callbacks.onListeningChange).toHaveBeenLastCalledWith(false);
    expect((await session.getDiagnostics()).permissionResult).toBe("denied");
  });

  it("reports native unavailability when there is no web recorder", async () => {
    nativeSpeech.available.mockResolvedValue({ available: false });
    const session = createSpeechRecognitionSession(createCallbacks());

    expect((await session.getDiagnostics()).selectedSpeechMode).toBe("unsupported");
    await expect(session.start()).rejects.toThrow(SPEECH_UNAVAILABLE_MESSAGE);
  });

  it("does not use web fallback after a native start failure unless the backend is ready", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", {
      language: "en-US",
      mediaDevices: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    nativeSpeech.start.mockRejectedValueOnce(new Error("recognizer service unavailable"));

    const session = createSpeechRecognitionSession({
      ...createCallbacks(),
      canUseWebFallback: () => false,
    });

    await expect(session.start()).rejects.toThrow(SPEECH_UNAVAILABLE_MESSAGE);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect((await session.getDiagnostics()).lastStartError).toBe(SPEECH_UNAVAILABLE_MESSAGE);
  });

  it("stops a native recording and removes every native listener", async () => {
    const callbacks = createCallbacks();
    const session = createSpeechRecognitionSession(callbacks);

    await session.start("Existing text");
    await session.stop();

    expect(nativeSpeech.forceStop).toHaveBeenCalled();
    expect(listenerHandles).toHaveLength(3);
    expect(listenerHandles.every((handle) => handle.remove.mock.calls.length === 1)).toBe(true);
    expect(callbacks.onListeningChange).toHaveBeenLastCalledWith(false);
  });

  it("cleans native listeners and recognizer resources when the session is destroyed", async () => {
    const callbacks = createCallbacks();
    const session = createSpeechRecognitionSession(callbacks);

    await session.start();
    await session.destroy();

    expect(nativeSpeech.forceStop).toHaveBeenCalled();
    expect(listenerHandles).toHaveLength(3);
    expect(listenerHandles.every((handle) => handle.remove.mock.calls.length === 1)).toBe(true);
    const listeningCallsAfterDestroy = callbacks.onListeningChange.mock.calls.length;
    listeners.get("listeningState")?.({ status: "started" });
    expect(callbacks.onListeningChange.mock.calls.length).toBe(listeningCallsAfterDestroy);
  });
});
