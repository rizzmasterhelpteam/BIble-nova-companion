import { beforeEach, describe, expect, it } from "vitest";
import { isAllowedApiOrigin, setApiCorsHeaders } from "../server-cors";

const createResponse = () => {
  const headers = new Map<string, string>();
  const response = {
    headers,
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (name: string, value: string) => headers.set(name, value),
    status: (statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    },
    json: (body: unknown) => {
      response.body = body;
      return response;
    },
  };
  return response;
};

describe("API CORS policy", () => {
  beforeEach(() => {
    delete process.env.APP_ORIGIN;
    delete process.env.VERCEL_PREVIEW_ORIGINS;
    delete process.env.VERCEL_PREVIEW_ORIGIN_PATTERN;
  });

  it("allows the production web origin and reflects it without a wildcard", () => {
    const response = createResponse();

    expect(setApiCorsHeaders(
      { headers: { origin: "https://biblecompanion.vercel.app" } },
      response,
      "POST, OPTIONS",
      "Content-Type, Authorization",
    )).toBe(true);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://biblecompanion.vercel.app");
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(response.headers.get("X-API-Contract-Version")).toBe("1");
  });

  it("allows the bundled Capacitor localhost origin", () => {
    expect(isAllowedApiOrigin("https://localhost")).toBe(true);
    expect(isAllowedApiOrigin("capacitor://localhost")).toBe(true);
  });

  it("rejects an unconfigured cross-site origin", () => {
    const response = createResponse();

    expect(setApiCorsHeaders(
      { headers: { origin: "https://attacker.example" } },
      response,
      "GET, OPTIONS",
      "Content-Type, Authorization",
    )).toBe(false);
    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "Origin not allowed." });
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
  });

  it("allows only explicitly configured preview origins", () => {
    process.env.VERCEL_PREVIEW_ORIGINS = "https://preview.example";
    expect(isAllowedApiOrigin("https://preview.example")).toBe(true);
    expect(isAllowedApiOrigin("https://another-preview.example")).toBe(false);
  });
});
