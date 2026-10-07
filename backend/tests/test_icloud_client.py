"""The iCloud client against a stand-in for pyicloud (an optional dependency, not installed here)."""

from __future__ import annotations

import asyncio
import sys
import types

import pytest

from app.providers.apple_base import AppleAuthError
from app.providers.icloud.client import ICloudPyClient


class FailedLogin(Exception):
    pass


class TwoFARequired(Exception):
    pass


class TwoSARequired(Exception):
    pass


class AuthRequired(Exception):
    pass


class FakeDevice:
    def __init__(self, icloud_id: str) -> None:
        self.data = {"id": icloud_id, "name": "iPhone", "deviceDisplayName": "iPhone 15"}
        self.sounds = 0

    def play_sound(self, subject: str) -> None:
        self.sounds += 1


class FakeDevices(dict):
    def __iter__(self):
        return iter(self.values())


class FakeService:
    """Records how it was built; `script` decides what each new sign-in does."""

    built: list[dict] = []
    script: list[str] = []

    def __init__(
        self, apple_id: str, password: str, cookie_directory: str, pause_2fa: bool = False
    ):
        FakeService.built.append({"apple_id": apple_id, "pause_2fa": pause_2fa})
        step = FakeService.script.pop(0) if FakeService.script else "ok"
        if step == "stale":
            raise AuthRequired("session invalidated")
        if step == "wrong":
            raise FailedLogin("bad password")
        self._requires_mfa = step == "code"
        self.devices = FakeDevices(abc=FakeDevice("abc"))
        self.failures = 0


@pytest.fixture
def fake_pyicloud(monkeypatch):
    exceptions = types.ModuleType("pyicloud.exceptions")
    exceptions.PyiCloudFailedLoginException = FailedLogin
    exceptions.PyiCloud2FARequiredException = TwoFARequired
    exceptions.PyiCloud2SARequiredException = TwoSARequired
    exceptions.PyiCloudAuthRequiredException = AuthRequired
    module = types.ModuleType("pyicloud")
    module.PyiCloudService = FakeService
    module.exceptions = exceptions
    monkeypatch.setitem(sys.modules, "pyicloud", module)
    monkeypatch.setitem(sys.modules, "pyicloud.exceptions", exceptions)
    FakeService.built = []
    FakeService.script = []
    return FakeService


def run(coro):
    return asyncio.run(coro)


def test_signs_in_with_the_password_alone(fake_pyicloud, tmp_path):
    client = ICloudPyClient(None, cookie_dir=tmp_path / "icloud")
    assert run(client.login("me@example.com", "pw")) == "logged_in"
    assert fake_pyicloud.built == [{"apple_id": "me@example.com", "pause_2fa": True}]
    assert [s.icloud_id for s in run(client.list_devices())] == ["abc"]


def test_asks_for_a_code_only_when_apple_refuses_the_password_alone(fake_pyicloud, tmp_path):
    fake_pyicloud.script = ["code"]
    client = ICloudPyClient(None, cookie_dir=tmp_path / "icloud")
    assert run(client.login("me@example.com", "pw")) == "require_2fa"


def test_a_session_apple_invalidated_is_dropped_and_signed_in_again(fake_pyicloud, tmp_path):
    cookies = tmp_path / "icloud"
    cookies.mkdir()
    (cookies / "meexamplecom.session").write_text("{}")
    (cookies / "meexamplecom.cookiejar").write_text("")
    fake_pyicloud.script = ["stale", "ok"]
    client = ICloudPyClient({"apple_id": "me@example.com", "password": "pw"}, cookie_dir=cookies)
    run(client.play_sound("abc"))
    assert len(fake_pyicloud.built) == 2
    assert not list(cookies.glob("*.session")) and not list(cookies.glob("*.cookiejar"))


def test_a_wrong_password_still_fails(fake_pyicloud, tmp_path):
    fake_pyicloud.script = ["wrong", "wrong"]
    client = ICloudPyClient(None, cookie_dir=tmp_path / "icloud")
    with pytest.raises(AppleAuthError, match="invalid Apple ID or password"):
        run(client.login("me@example.com", "pw"))


def test_a_lapsed_session_signs_in_again_once(fake_pyicloud, tmp_path):
    client = ICloudPyClient({"apple_id": "me@example.com", "password": "pw"}, cookie_dir=tmp_path)
    calls = []

    def flaky(api):
        calls.append(api)
        if len(calls) == 1:
            raise AuthRequired("lapsed")
        return "ok"

    assert run(client._run(flaky)) == "ok"
    assert len(fake_pyicloud.built) == 2 and calls[0] is not calls[1]

    def always(api):
        raise AuthRequired("lapsed")

    with pytest.raises(AppleAuthError, match="session expired"):
        run(client._run(always))


def test_a_code_apple_asks_for_later_stops_polling(fake_pyicloud, tmp_path):
    fake_pyicloud.script = ["code"]
    client = ICloudPyClient({"apple_id": "me@example.com", "password": "pw"}, cookie_dir=tmp_path)
    with pytest.raises(AppleAuthError, match="verification code"):
        run(client.locate())
