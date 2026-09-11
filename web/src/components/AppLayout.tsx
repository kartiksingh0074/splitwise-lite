import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { logout } from "../features/auth/api.ts";
import { useAuthStore } from "../stores/authStore.ts";
import { ToastContainer } from "./ToastContainer.tsx";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-semibold text-slate-900" : "text-slate-600 hover:text-slate-900";

export function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const refreshToken = useAuthStore((state) => state.refreshToken);
  const clearAuth = useAuthStore((state) => state.clearAuth);

  const handleLogout = async () => {
    if (refreshToken) {
      await logout(refreshToken).catch(() => undefined);
    }
    clearAuth();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <nav className="flex items-center gap-4 text-sm">
          <NavLink to="/" end className={navLinkClass}>
            Home
          </NavLink>
          <NavLink to="/groups" className={navLinkClass}>
            Groups
          </NavLink>
        </nav>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          {user && <span className="hidden sm:inline">{user.name}</span>}
          <button type="button" onClick={handleLogout} className="text-slate-900 underline">
            Log out
          </button>
        </div>
      </header>
      <main>{children}</main>
      <ToastContainer />
    </div>
  );
}
