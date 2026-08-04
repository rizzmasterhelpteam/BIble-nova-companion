import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'path';
import pkg from './package.json';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {
  createReflectionResponse,
  deleteSupabaseAccount,
  fetchAvailableModels,
  generatePrayer,
  getApiStatus,
  getClientErrorMessage,
  loadShadowMemoryProfile,
  saveShadowNotes,
  setShadowMemoryPreference,
  syncNativeSubscription,
  transcribeAudio,
} from './server-api';
import {
  createShadowNotes,
  MAX_SHADOW_NOTES_CHARS,
  type ChatMessage,
} from './chat-api';
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  HttpError,
  requireAuthenticatedRequest,
} from './server-security';
import { API_CONTRACT_VERSION } from './platform-contract';

const applyLocalEnv = (env: Record<string, string>) => {
  for (const [key, value] of Object.entries(env)) {
    if (value && !process.env[key]) {
      process.env[key] = value;
    }
  }
};

const sendJson = (res: ServerResponse, statusCode: number, data: unknown) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-API-Contract-Version', String(API_CONTRACT_VERSION));
  res.end(JSON.stringify(data));
};

const readJsonBody = (req: IncomingMessage) =>
  new Promise<any>((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const localApiPlugin = () => ({
  name: 'local-api',
  configureServer(server: any) {
    server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
      const pathname = req.url?.split('?')[0];

      if (pathname === '/api/status') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === '/api/status/ready') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }
        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `api-readiness:user:${userId}`, limit: 30 },
          ]);
          sendJson(res, 200, getApiStatus());
        } catch (error) {
          const details = getHttpErrorDetails(error);
          sendJson(res, details.statusCode, { error: details.message });
        }
        return;
      }

      if (pathname === '/api/voice/shadow-notes') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `voice-shadow-notes:user:${userId}`, limit: 10 },
          ]);
          const memoryProfile = await loadShadowMemoryProfile(userId);
          if (!memoryProfile.memoryEnabled) {
            sendJson(res, 200, { memoryEnabled: false, shadowNotes: null });
            return;
          }
          const body = await readJsonBody(req);
          const messages = Array.isArray(body?.messages) ? body.messages.slice(-12) : [];
          const normalizedMessages = messages
            .map((message: any) => {
              const content = typeof message?.content === 'string' ? message.content.trim() : '';
              if (!content) return null;
              assertStringLength(content, 2_000, 'Voice transcript');
              return {
                role: message?.role === 'ai' ? 'ai' : 'user',
                content,
              } satisfies ChatMessage;
            })
            .filter((message: ChatMessage | null): message is ChatMessage => Boolean(message));
          const existingShadowNotes = memoryProfile.shadowNotes;

          if (!normalizedMessages.length) {
            sendJson(res, 200, { memoryEnabled: true, shadowNotes: existingShadowNotes });
            return;
          }

          const generatedShadowNotes = await createShadowNotes(normalizedMessages, existingShadowNotes || null);
          const shadowNotes = generatedShadowNotes
            ? await saveShadowNotes(userId, generatedShadowNotes)
            : null;
          if (generatedShadowNotes && !shadowNotes) {
            sendJson(res, 200, await loadShadowMemoryProfile(userId));
            return;
          }
          sendJson(res, 200, { memoryEnabled: true, shadowNotes });
        } catch (error) {
          console.error('Vite local API Voice shadow-note error:', error instanceof Error ? error.message : error);
          const details = getHttpErrorDetails(error);
          if (details.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
          sendJson(res, details.statusCode, {
            error: details.statusCode === 500
              ? 'Voice notes could not be updated. Your conversation is still safe.'
              : details.message,
          });
        }
        return;
      }

      if (pathname === '/api/chat') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `chat:user:${userId}`, limit: 30 },
          ]);
          const { messages, shadowNotes } = await readJsonBody(req);
          if (shadowNotes !== undefined && shadowNotes !== null) {
            assertStringLength(shadowNotes, MAX_SHADOW_NOTES_CHARS, 'Shadow notes');
          }
          const result = await createReflectionResponse(userId, messages, shadowNotes);
          sendJson(res, 200, result);
        } catch (error) {
          console.error('Vite local API chat error:', error);
          const details = getHttpErrorDetails(error);
          if (details.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
          sendJson(res, details.statusCode, { error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
        }
        return;
      }

      if (pathname === '/api/shadow-notes') {
        if (!['GET', 'POST', 'PUT'].includes(req.method || '')) {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          const isRead = req.method === 'GET';
          await enforceRateLimits([
            { key: `shadow-notes:${req.method?.toLowerCase()}:user:${userId}`, limit: isRead ? 60 : 20 },
          ]);
          if (isRead) {
            sendJson(res, 200, await loadShadowMemoryProfile(userId));
            return;
          }

          const body = await readJsonBody(req);
          if (req.method === 'PUT') {
            if (typeof body.memoryEnabled !== 'boolean') {
              throw new HttpError('Memory preference must be true or false.', 400);
            }
            sendJson(res, 200, await setShadowMemoryPreference(userId, body.memoryEnabled));
            return;
          }

          assertStringLength(body.notes, MAX_SHADOW_NOTES_CHARS, 'Shadow notes');
          const profile = await loadShadowMemoryProfile(userId);
          if (!profile.memoryEnabled) {
            sendJson(res, 200, { memoryEnabled: false, shadowNotes: null });
            return;
          }
          const shadowNotes = await saveShadowNotes(userId, body.notes);
          if (!shadowNotes && body.notes.trim()) {
            sendJson(res, 200, await loadShadowMemoryProfile(userId));
            return;
          }
          sendJson(res, 200, { memoryEnabled: true, shadowNotes });
        } catch (error) {
          console.error('Vite local API shadow notes error:', error);
          const details = getHttpErrorDetails(error);
          if (details.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
          sendJson(res, details.statusCode, { error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
        }
        return;
      }

      if (pathname === '/api/generate') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `generate:user:${userId}`, limit: 20 },
          ]);
          const { prompt } = await readJsonBody(req);
          assertStringLength(prompt, 2_000, 'Prompt');
          const text = await generatePrayer(prompt);
          sendJson(res, 200, { text });
        } catch (error) {
          console.error('Vite local API generation error:', error);
          const details = getHttpErrorDetails(error);
          if (details.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
          sendJson(res, details.statusCode, { error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
        }
        return;
      }

      if (pathname === '/api/transcribe') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `transcribe:user:${userId}`, limit: 10 },
          ]);
          const { audio, language } = await readJsonBody(req);
          assertStringLength(audio, 8 * 1024 * 1024, 'Audio');
          if (language !== undefined && language !== null) {
            assertStringLength(language, 32, 'Language');
          }
          const text = await transcribeAudio(audio, language);
          sendJson(res, 200, { text });
        } catch (error) {
          console.error('Vite local API speech transcription error:', error);
          const details = getHttpErrorDetails(error);
          if (details.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
          sendJson(res, details.statusCode, { error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
        }
        return;
      }

      if (pathname === '/api/account') {
        if (req.method !== 'DELETE') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `account:user:${userId}`, limit: 3 },
          ]);
          await deleteSupabaseAccount(req.headers.authorization);
          sendJson(res, 200, { deleted: true });
        } catch (error) {
          console.error('Vite local API account deletion error:', error);
          sendJson(res, 500, { error: getClientErrorMessage(error) });
        }
        return;
      }

      if (pathname === '/api/subscription/status' || pathname === '/api/subscription/native-sync') {
        if (pathname === '/api/subscription/status' && req.method === 'GET') {
          try {
            const { userId } = await requireAuthenticatedRequest(req);
            await enforceRateLimits([
              { key: `subscription-status:user:${userId}`, limit: 60 },
            ]);
            const status = await getSubscriptionAccessStatus(userId);
            res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0');
            sendJson(res, 200, {
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
            sendJson(res, details.statusCode, { error: details.message });
          }
          return;
        }

        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `subscription-sync:user:${userId}`, limit: 10 },
          ]);
          const payload = await readJsonBody(req);
          const subscription = await syncNativeSubscription(req.headers.authorization, payload || {});
          sendJson(res, 200, { subscription });
        } catch (error) {
          console.error('Vite local API native subscription sync error:', error);
          sendJson(res, 400, { error: getClientErrorMessage(error) });
        }
        return;
      }

      if (pathname === '/api/models') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `models:user:${userId}`, limit: 10 },
          ]);
          const data = await fetchAvailableModels();
          res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0');
          sendJson(res, 200, data);
        } catch (error) {
          console.error('Vite local API models error:', error);
          const details = getHttpErrorDetails(error);
          if (details.retryAfterSeconds) res.setHeader('Retry-After', String(details.retryAfterSeconds));
          res.setHeader('Cache-Control', 'private, no-store, no-cache, max-age=0');
          sendJson(res, details.statusCode, {
            error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message,
          });
        }
        return;
      }

      next();
    });
  },
});

const pwaPrecachePlugin = (): Plugin => ({
  name: 'pwa-precache-manifest',
  apply: 'build',
  generateBundle(_options, bundle) {
    const bundledAssets = Object.keys(bundle)
      .filter((fileName) => /\.(?:html|js|css|png|jpe?g|webp|svg|ico|webmanifest|woff2?|ttf)$/i.test(fileName))
      .map((fileName) => `/${fileName}`);
    const staticAssets = [
      '/',
      '/manifest.webmanifest',
      '/favicon.png',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/native-error.html',
    ];
    const assets = [...new Set([...bundledAssets, ...staticAssets])];
    this.emitFile({
      type: 'asset',
      fileName: 'precache-manifest.json',
      source: JSON.stringify({ version: 1, assets }, null, 2),
    });
  },
});

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  applyLocalEnv(env);

  return {
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) {
              return;
            }

            if (id.includes("motion")) return "motion-vendor";
            if (id.includes("@supabase")) return "supabase-vendor";
            if (/node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
              return "react-vendor";
            }
          },
        },
      },
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
    },
    plugins: [localApiPlugin(), react(), tailwindcss(), pwaPrecachePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
