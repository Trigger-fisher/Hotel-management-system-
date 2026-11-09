import "server-only";
// The configured hash key, parsed once. The getter fails with a ConfigError (names the variable, never a value) when the key is not set, so a
// feature that needs it cannot run without one. Keyed hashes of one-time codes and identifiers (HMS_HASH_KEY), the sealed integration passwords
// (secretBox.ts, HMS_SECRET_KEY) and, from decision 74, the sealed personal numbers (fieldSeal.ts, HMS_DATA_KEY).
import { ConfigError, getConfig } from "../config/env";
import { createFieldSeal, type FieldSeal, parseDataKey } from "./fieldSeal";
import { parseHashKey } from "./hash";
import { parseSecretKey } from "./secretBox";

export { CryptoError, type CryptoErrorCode } from "./errors";
export { cleanForIndex, createFieldSeal, isSealed, maskNumber, type FieldSeal } from "./fieldSeal";
export { hashAuthCode, hashIdentifier, normaliseIdentifier, safeEqualHex, sha256Hex, type CodePurpose } from "./hash";

let hashKey: Buffer | undefined;
let secretKey: Buffer | undefined;
let fieldSeal: FieldSeal | undefined;

export function getHashKey(): Buffer {
  if (hashKey) return hashKey;
  const value = getConfig().HMS_HASH_KEY;
  if (value === undefined) throw new ConfigError(["HMS_HASH_KEY: is not set"]);
  hashKey = parseHashKey(value);
  return hashKey;
}

/** HMS_SECRET_KEY, parsed once (the secret vault). Not set: a ConfigError naming the variable. */
export function getSecretKey(): Buffer {
  if (secretKey) return secretKey;
  const value = getConfig().HMS_SECRET_KEY;
  if (value === undefined) throw new ConfigError(["HMS_SECRET_KEY: is not set"]);
  secretKey = parseSecretKey(value);
  return secretKey;
}

/** The sealer of personal numbers (HMS_DATA_KEY), built once. Not set: a ConfigError naming the variable. */
export function getFieldSeal(): FieldSeal {
  if (fieldSeal) return fieldSeal;
  const value = getConfig().HMS_DATA_KEY;
  if (value === undefined) throw new ConfigError(["HMS_DATA_KEY: is not set"]);
  fieldSeal = createFieldSeal(parseDataKey(value));
  return fieldSeal;
}

/** For tests only. */
export function resetKeyCache(): void {
  hashKey = undefined;
  secretKey = undefined;
  fieldSeal = undefined;
}
