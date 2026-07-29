import { createHash } from "node:crypto";
import { transcribeAudio } from "../server-api.js";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  HttpError,
  requireAuthenticatedRequest,
} from "../server-security.js";
import {
  isSupportedVoiceAudioMimeType,
  MAX_VOICE_AUDIO_BYTES,
  normalizeVoiceAudioMimeType,
} from "../src/lib/voiceTranscription.js";

const API_BUILD_ID = "2026-07-29-multipart-transcription";
const MAX_MULTIPART_BODY_BYTES = MAX_VOICE_AUDIO_BYTES + 128 * 1024;

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Client-Request-Id");
};

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    try {
      return req.body ? JSON.parse(req.body) : {};
    } catch {
      throw new HttpError("Invalid JSON request body.", 400);
    }
  }

  return req.body || {};
};

const getContentType = (req: any) =>
  String(
    req.headers?.["content-type"] ||
    req.headers?.["Content-Type"] ||
    "",
  );

const readRawBody = async (req: any) => {
  if (
    typeof req[Symbol.asyncIterator] === "function" &&
    req.readableEnded !== true
  ) {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_MULTIPART_BODY_BYTES) {
        throw new HttpError("Audio recording is too large.", 413);
      }
      chunks.push(buffer);
    }
    if (totalBytes) return new Uint8Array(Buffer.concat(chunks));
  }

  const parsedBody = req.body;
  if (Buffer.isBuffer(parsedBody) || parsedBody instanceof Uint8Array) {
    if (parsedBody.byteLength > MAX_MULTIPART_BODY_BYTES) {
      throw new HttpError("Audio recording is too large.", 413);
    }
    return new Uint8Array(parsedBody);
  }
  throw new HttpError("Multipart audio body is missing.", 400);
};

const parseMultipartBody = async (req: any, contentType: string) => {
  const rawBody = await readRawBody(req);
  let formData: FormData;
  try {
    formData = await new Request("http://localhost/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(rawBody).buffer,
    }).formData();
  } catch {
    throw new HttpError("Multipart audio body is invalid.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    throw new HttpError("An audio file is required.", 400);
  }
  if (!file.size) throw new HttpError("The audio recording is empty.", 400);
  if (file.size > MAX_VOICE_AUDIO_BYTES) {
    throw new HttpError("Audio recording is too large.", 413);
  }
  if (!isSupportedVoiceAudioMimeType(file.type)) {
    throw new HttpError("This audio format is not supported.", 415);
  }

  const languageValue = formData.get("language");
  const language = typeof languageValue === "string" ? languageValue.trim() : "";
  if (language) assertStringLength(language, 32, "Language");
  return {
    audio: file,
    language: language || undefined,
    mimeType: normalizeVoiceAudioMimeType(file.type),
    audioBytes: file.size,
    uploadMode: "multipart",
  } as const;
};

const parseTranscriptionRequest = async (req: any) => {
  const contentType = getContentType(req);
  if (contentType.toLowerCase().startsWith("multipart/form-data")) {
    return parseMultipartBody(req, contentType);
  }

  const { audio, language } = getBody(req);
  assertStringLength(audio, 8 * 1024 * 1024, "Audio");
  if (language !== undefined && language !== null) {
    assertStringLength(language, 32, "Language");
  }
  const metadataPrefix = typeof audio === "string" ? audio.slice(0, 120) : "";
  const mimeType = normalizeVoiceAudioMimeType(
    metadataPrefix.match(/^data:([^,]+);base64,/i)?.[1] || "",
  );
  if (!isSupportedVoiceAudioMimeType(mimeType)) {
    throw new HttpError("This audio format is not supported.", 415);
  }
  const encodedAudio = typeof audio === "string" ? audio.split(",", 2)[1] || "" : "";
  const audioBytes = Math.floor((encodedAudio.length * 3) / 4);
  if (!audioBytes) throw new HttpError("The audio recording is empty.", 400);
  if (audioBytes > MAX_VOICE_AUDIO_BYTES) {
    throw new HttpError("Audio recording is too large.", 413);
  }
  return {
    audio: audio as string,
    language: typeof language === "string" ? language : undefined,
    mimeType,
    audioBytes,
    uploadMode: "base64-compatibility",
  } as const;
};

const getClientErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("fetch failed")) {
    return "Network error: Could not reach the transcription service.";
  }

  if (message.includes("API key") || message.toLowerCase().includes("unauthorized")) {
    return "Speech transcription is temporarily unavailable. Please try again later.";
  }

  return message || "Speech transcription failed. Please try again.";
};

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-client-request-id"] || "").slice(0, 80);
  const startedAt = Date.now();
  setCorsHeaders(res);
  res.setHeader?.("X-Bible-Nova-Api-Build", API_BUILD_ID);
  res.setHeader?.("Cache-Control", "private, no-store");
  if (requestId) res.setHeader?.("X-Client-Request-Id", requestId);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    const userHash = createHash("sha256").update(userId).digest("hex").slice(0, 12);
    await enforceRateLimits([
      { key: `transcribe:user:${userId}`, limit: 30 },
      { key: `transcribe:ip:${ip}`, limit: 60 },
    ]);
    const {
      audio,
      language,
      mimeType,
      audioBytes,
      uploadMode,
    } = await parseTranscriptionRequest(req);
    console.info("[voice/transcribe] started", {
      requestId: requestId || "server-generated",
      userHash,
      mimeType,
      audioBytes,
      uploadMode,
    });
    const text = await transcribeAudio(audio, language);
    console.info("[voice/transcribe] completed", {
      requestId: requestId || "server-generated",
      userHash,
      durationMs: Date.now() - startedAt,
    });
    res.status(200).json({ text });
  } catch (error) {
    console.error("[voice/transcribe] failed", {
      requestId: requestId || "server-generated",
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
