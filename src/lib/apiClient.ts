const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") || "";

export const getApiUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${configuredApiBaseUrl}${normalizedPath}`;
};

export const apiFetch = (path: string, init?: RequestInit) => fetch(getApiUrl(path), init);
