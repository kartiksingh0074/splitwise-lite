import { create } from "zustand";
import { friendlyErrorMessage } from "../lib/errorMessages.ts";

export interface Toast {
  id: string;
  message: string;
  kind: "error" | "success";
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export function showErrorToast(err: unknown): void {
  useToastStore.getState().push({ message: friendlyErrorMessage(err), kind: "error" });
}

export function showSuccessToast(message: string): void {
  useToastStore.getState().push({ message, kind: "success" });
}
