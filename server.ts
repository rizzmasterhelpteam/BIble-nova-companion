import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import {
  createReflectionResponse,
  deleteSupabaseAccount,
  fetchAvailableModels,
  generatePrayer,
  getApiStatus,
  getClientErrorMessage,
  saveShadowNotes,
  syncNativeSubscription,
  transcribeAudio,
} from "./server-api";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from "./server-security";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "12mb" }));

app.get("/api/status", (_req, res) => {
  res.json(getApiStatus());
});

app.post("/api/chat", async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `chat:user:${userId}`, limit: 30 },
      { key: `chat:ip:${ip}`, limit: 60 },
    ]);
    const { messages, shadowNotes } = req.body;
    if (shadowNotes !== undefined && shadowNotes !== null) {
      assertStringLength(shadowNotes, 2_000, "Shadow notes");
    }
    const result = await createReflectionResponse(userId, messages, shadowNotes);
    res.json(result);
  } catch (error: any) {
    console.error("LLM API Error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
});

app.post("/api/shadow-notes", async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `shadow-notes:user:${userId}`, limit: 20 },
      { key: `shadow-notes:ip:${ip}`, limit: 40 },
    ]);
    const { notes } = req.body;
    assertStringLength(notes, 2_000, "Shadow notes");
    const shadowNotes = await saveShadowNotes(userId, notes);
    res.json({ shadowNotes });
  } catch (error) {
    console.error("Shadow notes error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
});

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

app.get("/api/models", async (_req, res) => {
  try {
    const data = await fetchAvailableModels();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: getClientErrorMessage(error) });
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

app.post("/api/transcribe", async (req, res) => {
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `transcribe:user:${userId}`, limit: 10 },
      { key: `transcribe:ip:${ip}`, limit: 20 },
    ]);
    const { audio, language } = req.body;
    assertStringLength(audio, 8 * 1024 * 1024, "Audio");
    if (language !== undefined && language !== null) {
      assertStringLength(language, 32, "Language");
    }
    const text = await transcribeAudio(audio, language);
    res.json({ text });
  } catch (error) {
    console.error("Speech transcription error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
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
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
