import json, time, threading, os
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from fastapi import WebSocketDisconnect
from mission_control.serial_service import create_serial_app, SerialMeasurement
from mission_control.emulator_protocol import encode
from mission_control.serial_bench import replay

HEADERS = {
    "Authorization": "Bearer test-token",
    "X-Control-Session": "owner",
    "Origin": "http://127.0.0.1:8000",
}


def test_auth_origin_host_control_and_bounded_port_selection(tmp_path):
    app = create_serial_app(tmp_path, token="test-token", synthetic=True)
    with TestClient(app, base_url="http://127.0.0.1:8767") as client:
        assert client.get("/api/v1/serial/ports").status_code == 401
        assert (
            client.get(
                "/api/v1/serial/ports",
                headers={**HEADERS, "Origin": "https://mertacar-git.github.io"},
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/api/v1/serial/ports", headers={**HEADERS, "Host": "attacker.invalid"}
            ).status_code
            == 400
        )
        assert (
            client.post("/api/v1/serial/control/claim", headers=HEADERS).status_code
            == 200
        )
        foreign = {**HEADERS, "X-Control-Session": "foreign"}
        assert (
            client.post("/api/v1/serial/control/claim", headers=foreign).status_code
            == 409
        )
        body = dict(port="COM-arbitrary", experiment="test", duration_s=1)
        assert (
            client.post(
                "/api/v1/serial/connection", headers=HEADERS, json=body
            ).status_code
            == 422
        )
        body["port"] = "TEST:MCT1"
        body["duration_s"] = 999999
        assert (
            client.post(
                "/api/v1/serial/connection", headers=HEADERS, json=body
            ).status_code
            == 422
        )
        with client.websocket_connect(
            "/ws/serial",
            headers={"Origin": HEADERS["Origin"], "Host": "127.0.0.1:8767"},
        ) as ws:
            ws.send_json(dict(token="test-token", session="owner"))
            assert ws.receive_json()["type"] == "serial_snapshot"


def test_live_capture_separate_archive_and_replay(tmp_path):
    app = create_serial_app(tmp_path, token="test-token", synthetic=True)
    with TestClient(app, base_url="http://127.0.0.1:8767") as client:
        result = client.post(
            "/api/v1/serial/connection",
            headers=HEADERS,
            json=dict(
                port="TEST:MCT1",
                experiment="receiver software acceptance",
                duration_s=2,
                test_profile="mixed",
            ),
        )
        assert result.status_code == 200
        identifier = result.json()["run"]["id"]
        deadline = time.monotonic() + 4
        while (
            time.monotonic() < deadline
            and app.state.service.current["status"] == "running"
        ):
            time.sleep(0.05)
        status = client.get("/api/v1/serial/status", headers=HEADERS).json()
        assert status["run"]["status"] == "completed" and status["telemetry"] is None
        assert status["counts"]["accepted"] > 0
        raw = client.get("/api/v1/serial/recordings/" + identifier, headers=HEADERS)
        assert (
            raw.status_code == 200
            and json.loads(raw.text.splitlines()[0])["version"] == 1
        )
        assert replay(tmp_path / f"{identifier}.jsonl")["counts"] == status["counts"]
        assert len(client.get("/api/v1/serial/recordings", headers=HEADERS).json()) == 1
        assert (
            client.get(
                "/api/v1/serial/recordings/not-a-uuid", headers=HEADERS
            ).status_code
            == 422
        )
        assert "SENTETİK" in status["run"]["experiment"]


@pytest.mark.skipif(os.name != "posix", reason="Linux PTY transport acceptance")
def test_http_receiver_uses_real_pyserial_on_a_pseudo_terminal(tmp_path):
    import pty

    master, slave = pty.openpty()
    port = os.ttyname(slave)
    app = create_serial_app(
        tmp_path,
        token="test-token",
        ports_provider=lambda: [
            dict(port=port, description="Linux PTY test", serial_number=None)
        ],
    )
    try:
        with TestClient(app, base_url="http://127.0.0.1:8767") as client:
            response = client.post(
                "/api/v1/serial/connection",
                headers=HEADERS,
                json=dict(
                    port=port,
                    experiment="SYNTHETIC OS PTY; no physical device",
                    duration_s=2,
                ),
            )
            assert response.status_code == 200
            time.sleep(0.2)
            for sequence in range(3):
                packet = encode(
                    bytes(range(16)),
                    0,
                    sequence,
                    sequence * 200,
                    None,
                    None,
                    20,
                    None,
                    12,
                )
                os.write(master, packet[:11])
                os.write(master, packet[11:])
                time.sleep(0.1)
            time.sleep(0.3)
            assert (
                client.get("/api/v1/serial/status", headers=HEADERS).json()["counts"][
                    "accepted"
                ]
                == 3
            )
            foreign = {**HEADERS, "X-Control-Session": "foreign"}
            assert (
                client.delete("/api/v1/serial/connection", headers=foreign).status_code
                == 409
            )
            assert (
                client.delete("/api/v1/serial/connection", headers=HEADERS).status_code
                == 200
            )
    finally:
        os.close(master)
        os.close(slave)


def test_receiver_restart_marks_only_own_unfinished_metadata_interrupted(tmp_path):
    identifier = "11111111-1111-4111-8111-111111111111"
    (tmp_path / f"{identifier}.json").write_text(
        json.dumps(dict(id=identifier, status="running"))
    )
    app = create_serial_app(tmp_path, token="test-token")
    assert app.state.service.recordings()[0]["status"] == "interrupted"


@pytest.mark.parametrize("body", [[], dict(token="wrong", session="owner")])
def test_websocket_rejects_malformed_or_wrong_authentication(tmp_path, body):
    app = create_serial_app(tmp_path, token="test-token", synthetic=True)
    with TestClient(app, base_url="http://127.0.0.1:8767") as client:
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                "/ws/serial",
                headers={"Origin": HEADERS["Origin"], "Host": "127.0.0.1:8767"},
            ) as ws:
                ws.send_json(body)
                ws.receive_json()


def test_uint64_device_clock_is_lossless_in_browser_json():
    from mission_control.emulator_protocol import decode

    vector = json.loads(
        (
            Path(__file__).resolve().parents[2] / "prototype/long-clock-vector.json"
        ).read_text(encoding="utf-8")
    )
    frame = decode(bytes.fromhex(vector["packet_hex"]))
    frame["source"] = "serial"
    assert (
        SerialMeasurement.model_validate(frame).model_dump()["source_time_ms"]
        == vector["source_time_ms"]
    )
