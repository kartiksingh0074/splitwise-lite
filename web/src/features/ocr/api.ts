import { apiFetch } from "../../lib/api.ts";

export interface ScanReceiptResult {
  rawText: string;
  guessedAmount: string | null;
  guessedMerchant: string | null;
}

export function scanReceipt(file: File) {
  const formData = new FormData();
  formData.append("receipt", file);
  return apiFetch<ScanReceiptResult>("/ocr/receipt", {
    method: "POST",
    body: formData,
  });
}
