import { useToastStore } from "../stores/toastStore.ts";

export function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto sm:px-0">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          onClick={() => dismiss(toast.id)}
          className={`w-full max-w-sm cursor-pointer rounded px-4 py-3 text-sm text-white shadow-lg ${
            toast.kind === "error" ? "bg-red-600" : "bg-green-600"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
