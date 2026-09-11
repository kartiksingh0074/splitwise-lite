import { ApiError } from "./api.ts";

const MESSAGES: Record<string, string> = {
  SPLIT_MISMATCH: "Those amounts don't add up to the total yet.",
  STALE_VERSION: "This was changed elsewhere — reload and try again.",
  IF_MATCH_REQUIRED: "Reload the page and try again.",
  MEMBER_HAS_BALANCE: "That member still has an outstanding balance in this group.",
  LAST_OWNER: "A group needs at least one owner.",
  INVITE_INVALID: "That invite code is invalid, expired, or already used.",
  UNSUPPORTED_CURRENCY: "We don't have an exchange rate for that currency yet.",
  INVALID_PARTICIPANT: "Everyone involved needs to be an active member of this group first.",
  IDEMPOTENCY_KEY_REQUIRED: "Something went wrong submitting that — please try again.",
  SETTLEMENT_NOT_PENDING: "That settlement has already been confirmed or rejected.",
  INVALID_RECEIPT: "That file isn't a supported image (JPEG/PNG/WEBP) under 5MB.",
  RECEIPT_NOT_FOUND: "No receipt has been uploaded for this settlement.",
  EMAIL_TAKEN: "An account with that email already exists.",
  INVALID_CREDENTIALS: "That email or password isn't right.",
  UNAUTHORIZED: "Your session expired — please log in again.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "Couldn't find that.",
};

export function friendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return MESSAGES[err.code] ?? err.message;
  }
  return "Something went wrong.";
}
