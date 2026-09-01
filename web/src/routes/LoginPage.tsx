import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { login } from "../features/auth/api.ts";
import { ApiError } from "../lib/api.ts";
import { useAuthStore } from "../stores/authStore.ts";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data: LoginForm) => {
    setServerError(null);
    try {
      const result = await login(data);
      setAuth(result);
      navigate("/");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-white p-6 shadow"
      >
        <h1 className="text-xl font-semibold text-slate-900">Log in</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="rounded border border-slate-300 px-3 py-2"
            {...register("email")}
          />
          {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="rounded border border-slate-300 px-3 py-2"
            {...register("password")}
          />
          {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-900 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Logging in…" : "Log in"}
        </button>

        <p className="text-sm text-slate-600">
          No account?{" "}
          <Link to="/register" className="text-slate-900 underline">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}
