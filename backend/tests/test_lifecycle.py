import sqlite3
import time
from fastapi.testclient import TestClient
from mission_control.api import create_app
from mission_control.store import Store


def test_app_construction_does_not_open_or_recover_database(tmp_path):
    path=tmp_path/'new.sqlite3'
    create_app(path)
    assert not path.exists()
    store=Store(path);identifier=store.start_recording('Still active')
    create_app(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute('SELECT ended_utc FROM sessions WHERE id=?',(identifier,)).fetchone()[0] is None
    store.close()


def test_claim_reacquires_expired_lease_without_restarting_simulator(tmp_path):
    app=create_app(tmp_path/'test.sqlite3')
    with TestClient(app) as client:
        owner={'X-Control-Session':'owner'};other={'X-Control-Session':'other'}
        assert client.post('/api/v1/control/claim',headers=owner).status_code==200
        assert client.post('/api/v1/control/claim',headers=other).status_code==409
        app.state.manager.controller_seen=time.monotonic()-16
        assert client.post('/api/v1/control/renew',headers=owner).status_code==409
        assert client.post('/api/v1/control/claim',headers=owner).status_code==200
        assert not app.state.manager.simulator.running
