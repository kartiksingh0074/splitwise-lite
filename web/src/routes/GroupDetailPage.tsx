import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createInvite,
  getGroup,
  removeMember,
  updateGroup,
  type GroupDetail,
} from "../features/groups/api.ts";
import { ApiError } from "../lib/api.ts";
import { useAuthStore } from "../stores/authStore.ts";

const TABS = ["Members", "Expenses", "Balances", "Activity"] as const;
type Tab = (typeof TABS)[number];

export function GroupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const userId = useAuthStore((state) => state.user?.id);

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Members");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const load = () => {
    if (!id) return;
    getGroup(id)
      .then((g) => {
        setGroup(g);
        setNameDraft(g.name);
      })
      .catch(() => setError("Couldn't load this group."));
  };

  useEffect(load, [id]);

  const isOwner = group?.members.some((m) => m.userId === userId && m.role === "OWNER") ?? false;

  const handleRename = async () => {
    if (!id) return;
    try {
      await updateGroup(id, { name: nameDraft });
      setRenaming(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't rename the group.");
    }
  };

  const handleCreateInvite = async () => {
    if (!id) return;
    try {
      const invite = await createInvite(id);
      setInviteCode(invite.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create an invite.");
    }
  };

  const handleRemove = async (targetUserId: string) => {
    if (!id) return;
    try {
      await removeMember(id, targetUserId);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove that member.");
    }
  };

  if (error && !group) {
    return <p className="mx-auto max-w-2xl px-6 py-10 text-sm text-red-600">{error}</p>;
  }

  if (!group) {
    return <p className="mx-auto max-w-2xl px-6 py-10 text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        {renaming ? (
          <div className="flex items-center gap-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-xl font-semibold"
            />
            <button onClick={handleRename} className="text-sm text-slate-900 underline">
              Save
            </button>
            <button onClick={() => setRenaming(false)} className="text-sm text-slate-500">
              Cancel
            </button>
          </div>
        ) : (
          <h1 className="text-xl font-semibold text-slate-900">
            {group.name}{" "}
            <span className="text-sm font-normal text-slate-500">({group.baseCurrency})</span>
          </h1>
        )}
        {isOwner && !renaming && (
          <button onClick={() => setRenaming(true)} className="text-sm text-slate-600 underline">
            Rename
          </button>
        )}
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex gap-4 border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-1 py-2 ${
              tab === t ? "border-slate-900 font-medium text-slate-900" : "border-transparent text-slate-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Members" && (
        <div className="flex flex-col gap-4">
          {isOwner && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreateInvite}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
              >
                Create invite
              </button>
              {inviteCode && (
                <span className="text-sm text-slate-600">
                  Code: <code className="rounded bg-slate-100 px-1.5 py-0.5">{inviteCode}</code>
                </span>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {group.members.map((m) => (
              <li
                key={m.userId}
                className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="font-medium text-slate-900">{m.name}</p>
                  <p className="text-xs text-slate-500">{m.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-500">{m.role}</span>
                  {isOwner && (
                    <button
                      onClick={() => handleRemove(m.userId)}
                      className="text-sm text-red-600 underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "Expenses" && (
        <p className="text-sm text-slate-500">Coming in Phase 3.</p>
      )}
      {tab === "Balances" && (
        <p className="text-sm text-slate-500">Coming in Phase 4.</p>
      )}
      {tab === "Activity" && (
        <p className="text-sm text-slate-500">Coming in Phase 6.</p>
      )}
    </div>
  );
}
