import { apiFetchBlob } from "../../lib/api.ts";

export async function getExportCsvBlobUrl(groupId: string): Promise<string> {
  const blob = await apiFetchBlob(`/groups/${groupId}/export.csv`, { method: "GET" });
  return URL.createObjectURL(blob);
}
