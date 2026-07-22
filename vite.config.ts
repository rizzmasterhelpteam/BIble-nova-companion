import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'path';
import pkg from './package.json';
import {defineConfig, loadEnv} from 'vite';
import {
  createChatCompletion,
  deleteSupabaseAccount,
  fetchAvailableModels,
  generatePrayer,
  getApiStatus,
  getClientErrorMessage,
  syncNativeSubscription,
  transcribeAudio,
} from './server-api';
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from './server-security';

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
        sendJson(res, 200, getApiStatus());
        return;
      }

      if (pathname === '/api/chat') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId, ip } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `chat:user:${userId}`, limit: 30 },
            { key: `chat:ip:${ip}`, limit: 60 },
          ]);
          const { messages, shadowNotes } = await readJsonBody(req);
          if (shadowNotes !== undefined && shadowNotes !== null) {
            assertStringLength(shadowNotes, 2_000, 'Shadow notes');
          }
          const message = await createChatCompletion(messages, shadowNotes);
          sendJson(res, 200, { message });
        } catch (error) {
          console.error('Vite local API chat error:', error);
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
          const { userId, ip } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `generate:user:${userId}`, limit: 20 },
            { key: `generate:ip:${ip}`, limit: 40 },
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
          const { userId, ip } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `transcribe:user:${userId}`, limit: 10 },
            { key: `transcribe:ip:${ip}`, limit: 20 },
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
          const { userId, ip } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `account:user:${userId}`, limit: 3 },
            { key: `account:ip:${ip}`, limit: 6 },
          ]);
          await deleteSupabaseAccount(req.headers.authorization);
          sendJson(res, 200, { deleted: true });
        } catch (error) {
          console.error('Vite local API account deletion error:', error);
          sendJson(res, 500, { error: getClientErrorMessage(error) });
        }
        return;
      }

      if (pathname === '/api/subscription/native-sync') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { userId, ip } = await requireAuthenticatedRequest(req);
          await enforceRateLimits([
            { key: `subscription-sync:user:${userId}`, limit: 10 },
            { key: `subscription-sync:ip:${ip}`, limit: 20 },
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
          const data = await fetchAvailableModels();
          sendJson(res, 200, data);
        } catch (error) {
          console.error('Vite local API models error:', error);
          sendJson(res, 500, { error: getClientErrorMessage(error) });
        }
        return;
      }

      next();
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
    plugins: [localApiPlugin(), react(), tailwindcss()],
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
