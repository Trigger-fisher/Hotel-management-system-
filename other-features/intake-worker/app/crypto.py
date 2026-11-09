"""Envelope encryption: AES-256-GCM. A per-hotel data key is stored wrapped (encrypted) by the master key.
Plaintext, keys and nonces are never logged and the plaintext never touches disk."""
from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .errors import StepError

NONCE = 12


def wrap_key(data_key: bytes, master_key: bytes, aad: bytes) -> str:
    """For HMS-side and test use: wrap a 32-byte data key with the master key. Returns base64(nonce + ciphertext)."""
    nonce = os.urandom(NONCE)
    return base64.b64encode(nonce + AESGCM(master_key).encrypt(nonce, data_key, aad)).decode()


def unwrap_key(wrapped_b64: str, master_key: bytes, aad: bytes) -> bytes:
    try:
        raw = base64.b64decode(wrapped_b64, validate=True)
        key = AESGCM(master_key).decrypt(raw[:NONCE], raw[NONCE:], aad)
    except (ValueError, InvalidTag):
        raise StepError("key_unwrap_failed", "The hotel key could not be opened.", 500, False, "encrypt")
    if len(key) != 32:
        raise StepError("key_unwrap_failed", "The hotel key could not be opened.", 500, False, "encrypt")
    return key


def encrypt(plaintext: bytes, data_key: bytes, aad: bytes) -> bytes:
    """nonce (12 bytes, random per file) + ciphertext + tag. `aad` binds the file to its job."""
    nonce = os.urandom(NONCE)
    return nonce + AESGCM(data_key).encrypt(nonce, plaintext, aad)


def decrypt(blob: bytes, data_key: bytes, aad: bytes) -> bytes:
    """What HMS does on download; here for tests."""
    try:
        return AESGCM(data_key).decrypt(blob[:NONCE], blob[NONCE:], aad)
    except InvalidTag:
        raise StepError("decrypt_failed", "The file could not be decrypted.", 500, False, "decrypt")
