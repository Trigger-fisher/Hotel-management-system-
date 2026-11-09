import "server-only";
// Cloudflare Turnstile on the public sign-in forms (sign-in, forgot password, the emailed reset link). The browser widget gives a one-time token; the form sends it in
// the X-Turnstile-Token header and the route calls assertHuman() before it does any work. The secret key (TURNSTILE_SECRET_KEY) is read here, on the server, and nowhere else.
// Dormant when no secret key is set (local development, tests): nothing is checked. With a key set it fails CLOSED: a missing token, a refused token, or Cloudflare not
// answering all refuse the request (422 with fields.captcha). Siteverify: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
import { AppError } from "../errors";
import { getConfig } from "../config/env";
import { getLogger } from "../logger";
import { clientAddress } from "./clientAddress";

export const TURNSTILE_HEADER = "x-turnstile-token";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare's limit for a token. */
const MAX_TOKEN = 2048;
const MESSAGE = "Please complete the security check and try again.";

const refuse = (): AppError => new AppError("VALIDATION_FAILED", MESSAGE, { fields: { captcha: MESSAGE } });

/** Whether the security check is switched on for this server. */
export function turnstileEnabled(): boolean {
  return getConfig().TURNSTILE_SECRET_KEY !== undefined;
}

/** Throws the 422 unless the request carries a good Turnstile token (or the check is not switched on). */
export async function assertHuman(request: Request, fetcher: typeof fetch = fetch): Promise<void> {
  const secret = getConfig().TURNSTILE_SECRET_KEY;
  if (secret === undefined) return;
  const token = request.headers.get(TURNSTILE_HEADER)?.trim() ?? "";
  if (token === "" || token.length > MAX_TOKEN) throw refuse();
  const form = new URLSearchParams({ secret, response: token });
  const ip = clientAddress(request);
  if (ip) form.set("remoteip", ip);
  let ok = false;
  try {
    const res = await fetcher(VERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(5000), cache: "no-store" });
    const json = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
    ok = res.ok && json.success === true;
    if (!ok) getLogger().warn("turnstile refused a token", { codes: Array.isArray(json["error-codes"]) ? json["error-codes"].join(",") : "" });
  } catch {
    getLogger().warn("turnstile could not be reached");
  }
  if (!ok) throw refuse();
}
