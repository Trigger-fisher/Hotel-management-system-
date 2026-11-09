import "server-only";
import { CryptoError } from "./errors";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * A secret key from an environment value (standard base64). `label` names the variable in the error; the value itself
 * is never put in a message. `exactBytes` for ciphers that need an exact size, `minBytes` for HMAC keys.
 */
export function parseSecretKey(value: string, label: string, size: { exactBytes?: number; minBytes?: number }): Buffer {
  const text = value.trim();
  if (text === "" || text.length % 4 !== 0 || !BASE64.test(text)) throw new CryptoError("BAD_KEY", `${label} must be standard base64`);
  const key = Buffer.from(text, "base64");
  if (size.exactBytes !== undefined && key.length !== size.exactBytes) throw new CryptoError("BAD_KEY", `${label} must decode to exactly ${size.exactBytes} bytes`);
  if (size.minBytes !== undefined && key.length < size.minBytes) throw new CryptoError("BAD_KEY", `${label} must decode to at least ${size.minBytes} bytes`);
  return key;
}
