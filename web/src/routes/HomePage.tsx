import { useEffect, useState } from "react";
import { getHealth } from "../lib/api.ts";
import { useAuthStore } from "../stores/authStore.ts";

export function HomePage() {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    getHealth()
      .then(() => setStatus("ok"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-slate-900">
      <h1 className="text-2xl font-semibold">Splitwise Lite</h1>
      {user && <p className="text-sm text-slate-700">Signed in as {user.name}</p>}
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
    </div>
  );
}
