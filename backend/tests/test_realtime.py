from datetime import timedelta

from sqlalchemy import update

from app.clock import utcnow
from app.models import Command


def recv_until(ws, type_: str, max_messages: int = 20) -> dict:
    for _ in range(max_messages):
        msg = ws.receive_json()
        if msg["type"] == type_:
            return msg["data"]
    raise AssertionError(f"no {type_} message")


def test_ws_requires_auth(client):
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect("/api/ws"):
            raise AssertionError("should not connect")
    except WebSocketDisconnect as e:
        assert e.code == 4401


def test_ws_rejects_foreign_origin(api, client):
    from starlette.websockets import WebSocketDisconnect

    a = api.register()
    try:
        with client.websocket_connect(
            "/api/ws", headers={**api.h(a), "Origin": "https://evil.example"}
        ):
            raise AssertionError("should not connect")
    except WebSocketDisconnect as e:
        assert e.code == 4403


def test_viewer_receives_live_location(api, client):
    a = api.register()
    d = api.device(a)
    with client.websocket_connect("/api/ws", headers=api.h(a)) as ws:
        api.report(d, 48.86, 2.33)
        data = recv_until(ws, "device.location")
        assert data["device_id"] == d["id"]
        assert data["location"]["lat"] == 48.86


def test_share_recipient_receives_person_location(api, client):
    a, b = api.register("A"), api.register("B")
    d = api.device(a)
    api.share(a, b)
    with client.websocket_connect("/api/ws", headers=api.h(b)) as ws:
        api.report(d, 10, 20)
        data = recv_until(ws, "person.location")
        assert data["user_id"] == a["id"]
        assert data["location"]["lon"] == 20


def test_hello_binds_device_and_presence(api, client):
    a = api.register()
    d = api.device(a)
    with client.websocket_connect("/api/ws", headers=api.h(a)) as viewer:
        with client.websocket_connect("/api/ws", headers=api.h(a)) as tracker:
            tracker.send_json({"type": "hello", "data": {"device_token": d["token"]}})
            welcome = recv_until(tracker, "welcome")
            assert welcome["device_id"] == d["id"]
            status = recv_until(viewer, "device.status")
            assert status == {**status, "device_id": d["id"], "online": True}
            dev = client.get(f"/api/devices/{d['id']}", headers=api.h(a)).json()
            assert dev["online"] is True
        status = recv_until(viewer, "device.status")
        assert status["online"] is False


def test_hello_with_other_users_device_rejected(api, client):
    a, b = api.register("A"), api.register("B")
    d = api.device(a)
    with client.websocket_connect("/api/ws", headers=api.h(b)) as ws:
        ws.send_json({"type": "hello", "data": {"device_token": d["token"]}})
        assert recv_until(ws, "welcome")["device_id"] is None
        assert recv_until(ws, "error")["code"] == "invalid_device_token"


def test_play_sound_over_ws_and_ack(api, client):
    a = api.register()
    d = api.device(a)
    with client.websocket_connect("/api/ws", headers=api.h(a)) as viewer:
        with client.websocket_connect("/api/ws", headers=api.h(a)) as tracker:
            tracker.send_json({"type": "hello", "data": {"device_token": d["token"]}})
            recv_until(tracker, "welcome")
            r = client.post(
                f"/api/devices/{d['id']}/commands", json={"type": "play_sound"}, headers=api.h(a)
            )
            assert r.status_code == 201
            assert r.json()["status"] == "delivered"
            assert r.json()["channel"] == "ws"
            cmd = recv_until(tracker, "command")
            assert cmd["type"] == "play_sound"
            tracker.send_json({"type": "command.ack", "data": {"command_id": cmd["id"]}})
            for _ in range(5):
                upd = recv_until(viewer, "command.updated")
                if upd["status"] == "acked":
                    break
            assert upd["status"] == "acked"


def test_offline_device_gets_push_then_pending_on_reconnect(api, client, fake_push):
    a = api.register()
    d = api.device(a)
    sub = {
        "endpoint": "https://push.example/abc",
        "keys": {"p256dh": "k", "auth": "a"},
        "device_id": d["id"],
    }
    assert client.post("/api/push/subscriptions", json=sub, headers=api.h(a)).status_code == 201
    r = client.post(
        f"/api/devices/{d['id']}/commands", json={"type": "play_sound"}, headers=api.h(a)
    )
    assert r.json()["channel"] == "push"
    assert fake_push.sent[-1][1]["kind"] == "command"
    # The device opens the app: the command is still there for it.
    state = client.get(
        "/api/report/state", headers={"Authorization": f"Bearer {d['token']}"}
    ).json()
    assert [c["type"] for c in state["pending_commands"]] == ["play_sound"]
    cid = state["pending_commands"][0]["id"]
    r = client.post(
        f"/api/report/commands/{cid}/ack",
        json={"status": "acked"},
        headers={"Authorization": f"Bearer {d['token']}"},
    )
    assert r.json()["status"] == "acked"


def test_offline_device_without_push_stays_pending(api, client):
    a = api.register()
    d = api.device(a)
    r = client.post(
        f"/api/devices/{d['id']}/commands", json={"type": "play_sound"}, headers=api.h(a)
    )
    assert r.json()["status"] == "pending"
    with client.websocket_connect("/api/ws", headers=api.h(a)) as tracker:
        tracker.send_json({"type": "hello", "data": {"device_token": d["token"]}})
        recv_until(tracker, "welcome")
        assert recv_until(tracker, "command")["type"] == "play_sound"


def test_lost_mode_persists_in_state(api, client):
    a = api.register("Alice")
    d = api.device(a)
    r = client.post(
        f"/api/devices/{d['id']}/commands",
        json={"type": "lost_mode_on", "message": "Please call me", "phone": "+33 6 00 00 00 00"},
        headers=api.h(a),
    )
    assert r.status_code == 201
    th = {"Authorization": f"Bearer {d['token']}"}
    state = client.get("/api/report/state", headers=th).json()
    assert state["lost_mode"]["enabled"] is True
    assert state["lost_mode"]["message"] == "Please call me"
    assert state["lost_mode"]["owner_name"] == "Alice"
    client.post(
        f"/api/devices/{d['id']}/commands", json={"type": "lost_mode_off"}, headers=api.h(a)
    )
    assert client.get("/api/report/state", headers=th).json()["lost_mode"]["enabled"] is False


def test_commands_expire(api, client, app):
    import anyio

    from app.services import housekeeping

    a = api.register()
    d = api.device(a)
    r = client.post(
        f"/api/devices/{d['id']}/commands", json={"type": "play_sound"}, headers=api.h(a)
    )
    cid = r.json()["id"]
    ctx = app.state.ctx

    async def expire():
        async with ctx.sessionmaker() as db:
            await db.execute(
                update(Command)
                .where(Command.id == cid)
                .values(expires_at=utcnow() - timedelta(seconds=1))
            )
            await db.commit()
        await housekeeping.run_once(ctx, purge_locations=False)

    client.portal.call(expire) if hasattr(client, "portal") and client.portal else anyio.run(expire)
    cmds = client.get(f"/api/devices/{d['id']}/commands", headers=api.h(a)).json()
    assert cmds[0]["status"] == "expired"


def test_command_unsupported_for_owntracks(api, client):
    a = api.register()
    d = api.device(a, kind="owntracks")
    r = client.post(
        f"/api/devices/{d['id']}/commands", json={"type": "play_sound"}, headers=api.h(a)
    )
    assert r.status_code == 409
