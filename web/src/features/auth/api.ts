import { apiFetch } from "../../lib/api.ts";
import type { AuthUser } from "../../stores/authStore.ts";

interface AuthResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export function register(input: { email: string; name: string; password: string }) {
  return apiFetch<AuthResponse>("/auth/register", {
    method: "POST",
    auth: false,
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }) {
  return apiFetch<AuthResponse>("/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify(input),
  });
}

export function logout(refreshToken: string) {
  return apiFetch<void>("/auth/logout", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ refreshToken }),
  });
}

export function getMe() {
  return apiFetch<AuthUser>("/users/me", { method: "GET" });
}
