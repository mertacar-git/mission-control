from fastapi.testclient import TestClient
from mission_control.api import create_app


def test_closed_websockets_release_subscribers_without_waiting_for_telemetry():
    app = create_app(":memory:")
    with TestClient(app) as client:
        for _ in range(2):
            with client.websocket_connect("/ws") as connection:
                assert connection.receive_json()["type"] == "snapshot"
                assert len(app.state.manager.subscribers) == 1
            assert len(app.state.manager.subscribers) == 0
