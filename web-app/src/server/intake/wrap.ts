import "server-only";
import { createCipheriv, randomBytes } from "node:crypto";

/**
 * A fresh 32-byte job key sealed for the reader worker: base64(nonce 12 + AES-256-GCM ciphertext + tag), the hotel id as the bound data
 * (other-features/intake-worker/app/crypto.py unwrap_key). HMS keeps no copy: the worker's encrypted picture is never read back, the form is filled
 * from the fields and the picture HMS saves is the one the desk sent.
 */
export function wrapJobKey(masterKey: Buffer, hotelId: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  cipher.setAAD(Buffer.from(hotelId));
  const sealed = Buffer.concat([cipher.update(randomBytes(32)), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([nonce, sealed]).toString("base64");
}
