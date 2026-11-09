// Cloudflare Turnstile in the browser: the token the widget (components/auth/TurnstileWidget.tsx) holds, and the one header that carries it to the server
// (X-Turnstile-Token, checked by server/http/turnstile.ts). The site key is public by design. No site key = no widget, no header (the server then has no secret either).
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";

let token: string | null = null;
let resetWidget: (() => void) | null = null;

/** The widget's current token (null until the check has passed, and again after it was used). */
export function setTurnstileToken(next: string | null): void {
  token = next;
}

/** The widget registers how to start a fresh check; null when it unmounts. */
export function registerTurnstileReset(reset: (() => void) | null): void {
  resetWidget = reset;
}

/** A token works for ONE request: call this after every submit so the widget gives a new one. Does nothing where no widget is shown. */
export function resetTurnstile(): void {
  token = null;
  resetWidget?.();
}

/** The header to add to a protected request (sign-in, forgot password, reset link); empty when there is no token. */
export function turnstileHeaders(): Record<string, string> {
  return token ? { "X-Turnstile-Token": token } : {};
}
