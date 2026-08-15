import { createHash, randomBytes } from "node:crypto";

export function createPortalRecipientToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPortalRecipientToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
