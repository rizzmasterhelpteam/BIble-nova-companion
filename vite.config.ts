import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {
  createChatCompletion,
  deleteSupabaseAccount,
  generatePrayer,
  getApiStatus,
  getClientErrorMessage,
  transcribeAudio,
} from './server-api';

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
          const { messages } = await readJsonBody(req);
          const message = await createChatCompletion(messages);
          sendJson(res, 200, { message });
        } catch (error) {
          console.error('Vite local API chat error:', error);
          sendJson(res, 500, { error: getClientErrorMessage(error) });
        }
        return;
      }

      if (pathname === '/api/generate') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { prompt } = await readJsonBody(req);
          const text = await generatePrayer(prompt);
          sendJson(res, 200, { text });
        } catch (error) {
          console.error('Vite local API generation error:', error);
          sendJson(res, 500, { error: getClientErrorMessage(error) });
        }
        return;
      }

      if (pathname === '/api/transcribe') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const { audio, language } = await readJsonBody(req);
          const text = await transcribeAudio(audio, language);
          sendJson(res, 200, { text });
        } catch (error) {
          console.error('Vite local API speech transcription error:', error);
          sendJson(res, 500, { error: getClientErrorMessage(error) });
        }
        return;
      }

      if (pathname === '/api/account') {
        if (req.method !== 'DELETE') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          await deleteSupabaseAccount(req.headers.authorization);
          sendJson(res, 200, { deleted: true });
        } catch (error) {
          console.error('Vite local API account deletion error:', error);
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
