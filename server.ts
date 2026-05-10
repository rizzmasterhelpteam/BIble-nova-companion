import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import {
  createChatCompletion,
  deleteSupabaseAccount,
  generatePrayer,
  getApiStatus,
  getClientErrorMessage,
} from "./api";

dotenv.config({ path: ".env.local" });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json());

app.get("/api/status", (_req, res) => {
  res.json(getApiStatus());
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    const message = await createChatCompletion(messages);
    res.json({ message });
  } catch (error: any) {
    console.error("LLM API Error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
});

app.delete("/api/account", async (req, res) => {
  try {
    await deleteSupabaseAccount(req.headers.authorization);
    res.json({ deleted: true });
  } catch (error) {
    console.error("Account deletion error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
});

app.get("/api/models", async (_req, res) => {
  try {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey?.trim()) {
      return res.status(500).json({ error: "GROK_API_KEY is missing." });
    }
    const response = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const { prompt } = req.body;
    const text = await generatePrayer(prompt);
    res.json({ text });
  } catch (error: any) {
    console.error("LLM Gen Error:", error);
    if (error?.message?.includes("API key not valid")) {
      res.status(500).json({ error: "Your Gemini API key is invalid. Please update it in the settings panel." });
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
