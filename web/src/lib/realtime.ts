import { useAuthStore } from "../stores/authStore.ts";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1";

function wsBaseUrl(): string {
  return API_BASE_URL.replace(/^http/, "ws");
}

/**
 * Opens a WebSocket subscribed to one group's change signal and calls `onChange()` whenever a
 * "group_changed" message arrives for it. Signal-only -- the caller re-fetches via its existing
 * REST calls; nothing is ever trusted from the socket payload itself. Returns a cleanup function
 * that closes the socket (call from a useEffect's return).
 */
export function connectGroupSocket(groupId: string, onChange: () => void): () => void {
  const token = useAuthStore.getState().accessToken;
  if (!token) {
    return () => {};
  }

  const ws = new WebSocket(`${wsBaseUrl()}/ws?groupId=${groupId}&token=${encodeURIComponent(token)}`);

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      if (data.type === "group_changed" && data.groupId === groupId) {
        onChange();
      }
    } catch {
      // Ignore malformed messages -- this channel is best-effort, never authoritative.
    }
  };

  return () => ws.close();
}
