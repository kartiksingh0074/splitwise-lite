import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout } from "../features/auth/api.ts";
import { getHealth } from "../lib/api.ts";
import { useAuthStore } from "../stores/authStore.ts";

export function HomePage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  useEffect(() => {
    getHealth()
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, []);

  const handleLogout = async () => {
    if (refreshToken) {
      await logout(refreshToken).catch(() => undefined);
    }
    clearAuth();
    navigate("/login");
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 text-slate-900">
      <h1 className="text-2xl font-semibold">Splitwise Lite</h1>
      <p className="text-sm text-slate-600">
        API health:{" "}
        <span
          className={
            status === "ok"
              ? "text-green-600"
              : status === "error"
                ? "text-red-600"
                : "text-slate-500"
          }
        >
          {status}
        </span>
      </p>
      {user && <p className="text-sm text-slate-700">Signed in as {user.name}</p>}
      <button
        type="button"
        onClick={handleLogout}
        className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
      >
        Log out
      </button>
    </main>
  );
}
