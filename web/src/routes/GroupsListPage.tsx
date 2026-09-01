import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listGroups, type GroupSummary } from "../features/groups/api.ts";

export function GroupsListPage() {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listGroups()
      .then((res) => setGroups(res.groups))
      .catch(() => setError("Couldn't load groups."));
  }, []);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Groups</h1>
        <Link
          to="/groups/new"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          New group
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {groups && groups.length === 0 && (
        <p className="text-sm text-slate-600">You're not in any groups yet.</p>
      )}

      <ul className="flex flex-col gap-2">
        {groups?.map((group) => (
          <li key={group.id}>
            <Link
              to={`/groups/${group.id}`}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-4 py-3 hover:border-slate-300"
            >
              <span className="font-medium text-slate-900">{group.name}</span>
              <span className="text-sm text-slate-500">
                {group.baseCurrency} · {group.role}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
