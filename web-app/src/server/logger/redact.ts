import "server-only";
// Redaction for every log line (standard X4). Nothing sensitive may reach a log, so this runs on every call:
// by key name (password, token, reset code, ID and bank numbers, card data, request bodies) and by value shape
// (Bearer tokens, JWTs, 12-digit Aadhaar, 13-19 digit card numbers, passwords inside URLs).

export const REDACTED = "[REDACTED]";
export const BODY_OMITTED = "[BODY OMITTED]";

const MAX_DEPTH = 6;
const MAX_ITEMS = 50;
const MAX_STRING = 2000;

// Compared on the key with case, underscores, dashes and dots removed.
const SENSITIVE_KEY =
  /(password|passwd|passphrase|secret|token|authorization|cookie|apikey|privatekey|(reset|verification|recovery|login|auth|challenge|invite|otp|twofactor|mfa)code|^otp$|^pin$|cvv|cvc|cardnumber|cardno|^pan$|accountnumber|accountno|ifsc|aadhaar|aadhar|idproof|idnumber|signature|documentnumber|database64|^(date)?ofbirth$|^dob$|^(mobile|phone|email|address|guestname|fullname|firstname|middlename|lastname|vehicleregistration|vehiclereg)$|^(subject|preview|snippet|html|text|cc|to|from|references|replyto)$)/;
// (the last group: an email's parts, Conversations decision 66; the message itself, `body`, is never logged by BODY_KEY below)

// Whole request or response bodies are never logged: they carry anything a user can type.
const BODY_KEY = /^(body|requestbody|responsebody|rawbody|payload|formdata)$/;

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const STRING_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  [/\bv1:[A-Za-z0-9_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+:[A-Za-z0-9+/=_-]+/g, REDACTED],
  // a sealed secret from the vault (secretBox.ts): v1.<iv>.<tag>.<ciphertext>, base64url
  [/\bv1\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, REDACTED],
  // an email address, and an Indian mobile number (10 digits starting 6 to 9, with an optional +91 or 0 in front)
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, REDACTED],
  [/(?<![\d.])(?:\+?91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d.])/g, REDACTED],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)[^\s/@]+(@)/gi, `$1${REDACTED}$2`],
  // key=value pairs inside text and URLs: ?token=abc, password=abc, code=123456
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|otp|code|signature)=([^\s&;,"']+)/gi, `$1=${REDACTED}`],
  [/\b\d{4}[ -]\d{4}[ -]\d{4}\b/g, REDACTED],
  [/\b\d{12,19}\b/g, REDACTED],
  // IFSC (SBIN0001234) and PAN (ABCDE1234F) shapes
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, REDACTED],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, REDACTED],
];

export function redactString(text: string): string {
  let out = text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  for (const [pattern, replacement] of STRING_RULES) out = out.replace(pattern, replacement);
  return out;
}

function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = { name: error.name, message: redactString(error.message) };
  if (error.stack) out.stack = redactString(error.stack);
  if (error.cause !== undefined) out.cause = redactValue(error.cause, depth + 1, seen);
  return out;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
    case "symbol":
      return "[unserialisable]";
  }
  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Too deep]";
  if (obj instanceof Error) {
    seen.add(obj);
    return redactError(obj, depth, seen);
  }
  if (obj instanceof Date) return Number.isNaN(obj.getTime()) ? "[Invalid date]" : obj.toISOString();
  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) return "[binary]";
  seen.add(obj);
  if (Array.isArray(obj)) {
    const items = obj.slice(0, MAX_ITEMS).map((item) => redactValue(item, depth + 1, seen));
    if (obj.length > MAX_ITEMS) items.push(`[${obj.length - MAX_ITEMS} more]`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(obj)) {
    const name = normaliseKey(key);
    if (BODY_KEY.test(name)) out[key] = BODY_OMITTED;
    else if (SENSITIVE_KEY.test(name)) out[key] = REDACTED;
    else out[key] = redactValue(inner, depth + 1, seen);
  }
  return out;
}

/** A copy of `value` that is safe to write to a log. Never throws, never mutates the input. */
export function redact(value: unknown): unknown {
  try {
    return redactValue(value, 0, new WeakSet<object>());
  } catch {
    return "[unserialisable]";
  }
}
