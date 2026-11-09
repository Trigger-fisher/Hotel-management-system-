import "server-only";
export type CryptoErrorCode = "BAD_KEY" | "BAD_FORMAT" | "UNKNOWN_KEY" | "DECRYPT_FAILED" | "BAD_INPUT";

const MESSAGES: Record<CryptoErrorCode, string> = {
  BAD_KEY: "A key is missing or not valid",
  BAD_FORMAT: "The value is not in the expected encrypted format",
  UNKNOWN_KEY: "The value was encrypted with a key that is not configured",
  DECRYPT_FAILED: "The value could not be decrypted",
  BAD_INPUT: "The input is not valid",
};

/**
 * Thrown by the crypto modules. The message is fixed per code on purpose: it never holds a key, a plaintext, a
 * ciphertext or a key id, so it is safe to log and to wrap in an AppError.
 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, detail?: string) {
    super(detail ? `${MESSAGES[code]}: ${detail}` : MESSAGES[code]);
    this.name = "CryptoError";
    this.code = code;
  }
}
