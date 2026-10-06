"""Adapter around FindMy.py (https://github.com/malmeloo/FindMy.py, MIT).

`findmy` is imported lazily so the app runs without the optional dependency.
Everything the rest of the app needs goes through this module, so tests can
swap in a fake.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.providers.apple_base import AppleAuthError

BATTERY = {0: ("full", 1.0), 1: ("medium", 0.6), 2: ("low", 0.3), 3: ("very_low", 0.1)}


@dataclass(frozen=True)
class RawReport:
    ts: datetime
    lat: float
    lon: float
    accuracy: float | None
    status: int | None


def battery_from_status(status: int | None) -> tuple[str, float] | None:
    if status is None:
        return None
    return BATTERY.get((status >> 6) & 0b11)


# ---------- key material (pure helpers, need the library) ----------


def haystack_from_private_key(private_key_b64: str) -> dict[str, str]:
    from findmy import KeyPair

    try:
        key = KeyPair.from_b64(private_key_b64.strip())
    except Exception as e:  # noqa: BLE001 - library raises various errors
        raise ValueError("invalid private key") from e
    return {"private_key_b64": key.private_key_b64, "adv_key_b64": key.adv_key_b64}


def haystack_generate() -> dict[str, str]:
    from findmy import KeyPair

    key = KeyPair.new()
    return {"private_key_b64": key.private_key_b64, "adv_key_b64": key.adv_key_b64}


def airtag_from_plist(plist: bytes, alignment: bytes | None, name: str) -> dict[str, Any]:
    from findmy import FindMyAccessory

    try:
        acc = FindMyAccessory.from_plist(plist, alignment or None, name=name)
    except Exception as e:  # noqa: BLE001
        raise ValueError("could not read the accessory .plist") from e
    return {"accessory": acc.to_json(), "model": acc.model}


# ---------- account client ----------


class FindMyPyClient:
    def __init__(self, state: dict[str, Any] | None, *, anisette_url: str | None, libs_path: Path):
        from findmy import AsyncAppleAccount, LocalAnisetteProvider, RemoteAnisetteProvider

        libs_path.parent.mkdir(parents=True, exist_ok=True)
        if state is not None:
            self.account = AsyncAppleAccount.from_json(state, anisette_libs_path=libs_path)
        else:
            anisette = (
                RemoteAnisetteProvider(anisette_url)
                if anisette_url
                else LocalAnisetteProvider(libs_path=libs_path)
            )
            self.account = AsyncAppleAccount(anisette)
        self._methods: dict[str, Any] = {}

    @staticmethod
    def _state_name(state: Any) -> str:
        from findmy import LoginState

        if state == LoginState.LOGGED_IN:
            return "logged_in"
        if state == LoginState.REQUIRE_2FA:
            return "require_2fa"
        return "logged_out"

    async def login(self, username: str, password: str) -> str:
        from findmy import InvalidCredentialsError, UnauthorizedError

        try:
            return self._state_name(await self.account.login(username, password))
        except (InvalidCredentialsError, UnauthorizedError) as e:
            raise AppleAuthError("invalid Apple ID or password") from e

    async def get_2fa_methods(self) -> list[dict[str, str]]:
        from findmy import SmsSecondFactorMethod, TrustedDeviceSecondFactorMethod

        out = []
        for m in await self.account.get_2fa_methods():
            if isinstance(m, TrustedDeviceSecondFactorMethod):
                mid, label, kind = "trusted_device", "Trusted device", "trusted_device"
            elif isinstance(m, SmsSecondFactorMethod):
                mid, label, kind = f"sms:{m.phone_number_id}", f"SMS {m.phone_number}", "sms"
            else:  # pragma: no cover
                continue
            self._methods[mid] = m
            out.append({"id": mid, "type": kind, "label": label})
        return out

    async def request_2fa(self, method_id: str) -> None:
        method = self._methods.get(method_id)
        if method is None:
            raise AppleAuthError("unknown 2FA method")
        await method.request()

    async def submit_2fa(self, method_id: str, code: str) -> str:
        from findmy import InvalidCredentialsError, UnauthorizedError

        method = self._methods.get(method_id) or next(iter(self._methods.values()), None)
        if method is None:
            raise AppleAuthError("no 2FA method")
        try:
            return self._state_name(await method.submit(code))
        except (InvalidCredentialsError, UnauthorizedError) as e:
            raise AppleAuthError("invalid code") from e

    async def fetch(
        self, items: list[tuple[str, dict[str, Any]]]
    ) -> tuple[dict[str, list[RawReport]], dict[str, dict[str, Any]]]:
        """Fetch reports for items. Returns (reports per item id, updated secrets per item id)."""
        from findmy import FindMyAccessory, KeyPair, UnauthorizedError

        sources: dict[Any, str] = {}
        accessories: dict[str, Any] = {}
        for item_id, secret in items:
            if "accessory" in secret:
                acc = FindMyAccessory.from_json(secret["accessory"])
                accessories[item_id] = acc
                sources[acc] = item_id
            else:
                sources[KeyPair.from_b64(secret["private_key_b64"])] = item_id
        if not sources:
            return {}, {}
        try:
            result = await self.account.fetch_location_history(list(sources))
        except UnauthorizedError as e:
            raise AppleAuthError("Apple session expired") from e
        reports: dict[str, list[RawReport]] = {}
        for source, found in result.items():
            item_id = sources[source]
            reports[item_id] = [
                RawReport(
                    ts=r.timestamp.astimezone(UTC),
                    lat=r.latitude,
                    lon=r.longitude,
                    accuracy=float(r.horizontal_accuracy),
                    status=r.status,
                )
                for r in found
            ]
        updated = {iid: {"accessory": acc.to_json()} for iid, acc in accessories.items()}
        return reports, updated

    def export_state(self) -> dict[str, Any]:
        return self.account.to_json()

    async def close(self) -> None:
        await self.account.close()
