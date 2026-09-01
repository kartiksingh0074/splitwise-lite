import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { createGroup } from "../features/groups/api.ts";
import { ApiError } from "../lib/api.ts";

const createGroupFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  baseCurrency: z
    .string()
    .length(3, "Use a 3-letter currency code, e.g. USD")
    .transform((v) => v.toUpperCase()),
  memberEmails: z.string(),
});

type CreateGroupForm = z.infer<typeof createGroupFormSchema>;

export function CreateGroupPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateGroupForm>({
    resolver: zodResolver(createGroupFormSchema),
    defaultValues: { name: "", baseCurrency: "", memberEmails: "" },
  });

  const onSubmit = async (data: CreateGroupForm) => {
    setServerError(null);
    const memberEmails = data.memberEmails
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean);

    try {
      const result = await createGroup({
        name: data.name,
        baseCurrency: data.baseCurrency,
        memberEmails,
      });
      navigate(`/groups/${result.group.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  };

  return (
    <div className="mx-auto max-w-md px-6 py-10">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4 rounded-lg bg-white p-6 shadow"
      >
        <h1 className="text-xl font-semibold text-slate-900">New group</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm text-slate-700">
            Group name
          </label>
          <input
            id="name"
            type="text"
            className="rounded border border-slate-300 px-3 py-2"
            {...register("name")}
          />
          {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="baseCurrency" className="text-sm text-slate-700">
            Base currency
          </label>
          <input
            id="baseCurrency"
            type="text"
            placeholder="USD"
            maxLength={3}
            className="rounded border border-slate-300 px-3 py-2 uppercase"
            {...register("baseCurrency")}
          />
          {errors.baseCurrency && (
            <p className="text-sm text-red-600">{errors.baseCurrency.message}</p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="memberEmails" className="text-sm text-slate-700">
            Member emails (comma-separated)
          </label>
          <textarea
            id="memberEmails"
            rows={3}
            placeholder="friend@example.com, other@example.com"
            className="rounded border border-slate-300 px-3 py-2"
            {...register("memberEmails")}
          />
          <p className="text-xs text-slate-500">
            Existing users join immediately; anyone else gets a pending invite code you can share.
          </p>
        </div>

        {serverError && <p className="text-sm text-red-600">{serverError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-slate-900 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Creating…" : "Create group"}
        </button>
      </form>
    </div>
  );
}
