import { randomUUID } from "node:crypto";
import { API_CONTRACT_VERSION } from "./platform-contract.js";

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
};

type ResponseLike = {
  setHeader?: (name: string, value: string) => unknown;
  status?: (statusCode: number) => ResponseLike;
  json?: (body: unknown) => unknown;
};

const DEFAULT_ALLOWED_ORIGINS = [
  "https://biblecompanion.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
];

const getHeader = (req: RequestLike, name: string) => {
  const headers = req.headers || {};
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value[0] : value;
};

const splitConfiguredOrigins = (value: string | undefined) =>
  value
    ?.split(/[\s,]+/)
    .map((origin) => {
      const trimmed = origin.trim();
      if (!trimmed) return "";
      return /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
        ? trimmed.replace(/\/$/, "")
        : `https://${trimmed.replace(/\/$/, "")}`;
    })
    .filter(Boolean) || [];

const getAllowedOrigins = () => {
  const vercelOrigin = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL.trim().replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : "";
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...splitConfiguredOrigins(process.env.APP_ORIGIN),
    ...splitConfiguredOrigins(process.env.VITE_APP_ORIGIN),
    ...splitConfiguredOrigins(process.env.CAPACITOR_ANDROID_ORIGIN),
    ...splitConfiguredOrigins(process.env.CAPACITOR_IOS_ORIGIN),
    ...splitConfiguredOrigins(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    ...splitConfiguredOrigins(vercelOrigin),
    ...splitConfiguredOrigins(process.env.VERCEL_PREVIEW_ORIGINS),
  ]);
};

const matchesConfiguredPreviewPattern = (origin: string) => {
  const pattern = process.env.VERCEL_PREVIEW_ORIGIN_PATTERN?.trim();
  if (!pattern) return false;
  try {
    return new RegExp(pattern).test(origin);
  } catch {
    return false;
  }
};

export const isAllowedApiOrigin = (origin: string) => {
  const normalizedOrigin = origin.trim().replace(/\/$/, "");
  return getAllowedOrigins().has(normalizedOrigin) || matchesConfiguredPreviewPattern(normalizedOrigin);
};

export const setApiCorsHeaders = (
  req: RequestLike,
  res: ResponseLike,
  methods: string,
  allowedHeaders: string,
) => {
  const origin = getHeader(req, "origin")?.trim();
  if (origin && !isAllowedApiOrigin(origin)) {
    res.status?.(403)?.json?.({ error: "Origin not allowed." });
    return false;
  }

  if (origin) {
    res.setHeader?.("Access-Control-Allow-Origin", origin);
    res.setHeader?.("Vary", "Origin");
  }
  const suppliedRequestId = getHeader(req, "x-request-id")?.trim();
  const requestId = suppliedRequestId && /^[a-zA-Z0-9._:-]{1,80}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  res.setHeader?.("X-Request-ID", requestId);
  res.setHeader?.("X-API-Contract-Version", String(API_CONTRACT_VERSION));
  res.setHeader?.("Access-Control-Expose-Headers", "X-API-Contract-Version, X-Request-ID, Retry-After");
  res.setHeader?.("Access-Control-Allow-Methods", methods);
  res.setHeader?.("Access-Control-Allow-Headers", allowedHeaders);
  return true;
};
