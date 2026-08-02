import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import {
  deleteSupabaseAccount,
  fetchAvailableModels,
  generatePrayer,
  getApiStatus,
  getClientErrorMessage,
  syncNativeSubscription,
} from "./server-api";
import chatHandler from "./api/chat";
import shadowNotesHandler from "./api/shadow-notes";
import transcriptionHandler from "./api/transcribe";
import voiceShadowNotesHandler from "./api/voice/shadow-notes";
import voiceSessionHandler from "./api/voice/session";
import textToSpeechHandler from "./api/tts";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
} from "./server-security";
import { API_CONTRACT_VERSION } from "./platform-contract";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "12mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-API-Contract-Version", String(API_CONTRACT_VERSION));
  next();
});

app.get("/api/status", (_req, res) => {
  res.json(getApiStatus());
});

app.post("/api/voice/session", voiceSessionHandler);
app.options("/api/voice/session", voiceSessionHandler);
app.post("/api/voice/respond", chatHandler);
app.options("/api/voice/respond", chatHandler);
app.post("/api/chat", chatHandler);
app.options("/api/chat", chatHandler);
app.post("/api/tts", textToSpeechHandler);
app.options("/api/tts", textToSpeechHandler);
app.post("/api/transcribe", transcriptionHandler);
app.options("/api/transcribe", transcriptionHandler);
app.post("/api/voice/shadow-notes", voiceShadowNotesHandler);
app.options("/api/voice/shadow-notes", voiceShadowNotesHandler);
app.get("/api/shadow-notes", shadowNotesHandler);
app.put("/api/shadow-notes", shadowNotesHandler);
app.post("/api/shadow-notes", shadowNotesHandler);
app.options("/api/shadow-notes", shadowNotesHandler);
app.delete("/api/account", async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `account:user:${userId}`, limit: 3 },
      { key: `account:ip:${ip}`, limit: 6 },
    ]);
    await deleteSupabaseAccount(req.headers.authorization);
    res.json({ deleted: true });
  } catch (error) {
    console.error("Account deletion error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
});

app.get(["/api/subscription/native-sync", "/api/subscription/status"], async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `subscription-status:user:${userId}`, limit: 60 },
      { key: `subscription-status:ip:${ip}`, limit: 120 },
    ]);
    const status = await getSubscriptionAccessStatus(userId);
    res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0");
    res.json({
      state: status.state,
      active: status.active,
      status: status.status,
      source: status.source,
      productId: status.productId,
      expiresAt: status.expiresAt,
      verifiedAt: status.verifiedAt,
      reconciliationRecommended: status.reconciliationRecommended,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    res.status(details.statusCode).json({ error: details.message });
  }
});

app.post("/api/subscription/native-sync", async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `subscription-sync:user:${userId}`, limit: 10 },
      { key: `subscription-sync:ip:${ip}`, limit: 20 },
    ]);
    const subscription = await syncNativeSubscription(req.headers.authorization, req.body || {});
    res.json({ subscription });
  } catch (error) {
    console.error("Native subscription sync error:", error);
    res.status(400).json({ error: getClientErrorMessage(error) });
  }
});

app.get("/api/models", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store, no-cache, max-age=0");
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `models:user:${userId}`, limit: 10 },
      { key: `models:ip:${ip}`, limit: 20 },
    ]);
    const data = await fetchAvailableModels();
    res.json(data);
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({
      error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message,
    });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `generate:user:${userId}`, limit: 20 },
      { key: `generate:ip:${ip}`, limit: 40 },
    ]);
    const { prompt } = req.body;
    assertStringLength(prompt, 2_000, "Prompt");
    const text = await generatePrayer(prompt);
    res.json({ text });
  } catch (error: any) {
    console.error("LLM Gen Error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader("Retry-After", String(details.retryAfterSeconds));
    if (details.statusCode !== 500) {
      res.status(details.statusCode).json({ error: details.message });
    } else if (error?.message?.includes("API key not valid")) {
      res.status(500).json({ error: "Your Groq API key is invalid. Please update it in the settings panel." });
    } else {
      res.status(500).json({ error: "Failed to generate content. Please try again." });
    }
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    const assetsPath = path.join(distPath, "assets");
    app.use(
      "/assets",
      express.static(assetsPath, {
        immutable: true,
        maxAge: "1y",
      }),
    );
    app.use(
      express.static(distPath, {
        maxAge: "1h",
        setHeaders: (res, filePath) => {
          if (filePath.endsWith(".html")) {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
