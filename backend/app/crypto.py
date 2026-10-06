"""Encryption at rest for provider secrets (Apple account state, tag private keys)."""

from __future__ import annotations

import base64
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

__all__ = ["SecretBox", "InvalidToken"]


class SecretBox:
    def __init__(self, secret_key: str, purpose: bytes = b"locus/provider-secrets/v1"):
        raw = HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=purpose).derive(
            secret_key.encode()
        )
        self._fernet = Fernet(base64.urlsafe_b64encode(raw))

    def encrypt(self, data: bytes) -> bytes:
        return self._fernet.encrypt(data)

    def decrypt(self, blob: bytes) -> bytes:
        return self._fernet.decrypt(blob)

    def encrypt_json(self, value: Any) -> bytes:
        return self.encrypt(json.dumps(value).encode())

    def decrypt_json(self, blob: bytes) -> Any:
        return json.loads(self.decrypt(blob))
