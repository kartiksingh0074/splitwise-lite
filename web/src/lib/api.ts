import { useAuthStore } from "../stores/authStore.ts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    return new ApiError(
      res.status,
      body.error?.code ?? "UNKNOWN",
      body.error?.message ?? res.statusText,
      body.error?.details,
    );
  } catch {
    return new ApiError(res.status, "UNKNOWN", res.statusText);
  }
}

interface ApiFetchOptions extends RequestInit {
  /** Attach the Authorization header and retry-on-401 via silent refresh. Default true. */
  auth?: boolean;
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  const { refreshToken, setAccessToken, clearAuth } = useAuthStore.getState();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearAuth();
      return false;
    }
    const data = await res.json();
    setAccessToken(data.accessToken, data.refreshToken);
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { auth = true, headers, ...rest } = options;

  const doFetch = () => {
    const token = useAuthStore.getState().accessToken;
    return fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  };

  let res = await doFetch();

  if (res.status === 401 && auth && useAuthStore.getState().refreshToken) {
    refreshPromise ??= refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
    const refreshed = await refreshPromise;
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export function getHealth(): Promise<{ status: string }> {
  return apiFetch("/health", { auth: false, method: "GET" });
}
