import json
import sqlite3
from fastapi.testclient import TestClient
from mission_control.operator_accounts import create_operator_app, Accounts, NewUser

PASSWORD = 'test-only long passphrase 2026'


def bootstrap(path):
    store = Accounts(path)
    try:
        store.create(NewUser(username='admin', password=PASSWORD, role='admin'), 'test-bootstrap')
    finally:
        store.db.close()


def login(client, name='admin'):
    response = client.post('/api/v1/operators/login', json={'username': name, 'password': PASSWORD})
    assert response.status_code == 200
    return {'Authorization': 'Bearer '+response.json()['token']}


def test_roles_disable_logout_and_secret_redaction(tmp_path):
    path = tmp_path/'accounts.db'
    app = create_operator_app(path)
    assert not path.exists()
    bootstrap(path)
    with TestClient(app, base_url='https://localhost') as client:
        admin = login(client)
        assert client.post('/api/v1/operators/users', headers=admin, json={'username':'observer', 'password':PASSWORD, 'role':'operator'}).status_code == 201
        operator = login(client, 'observer')
        assert client.get('/api/v1/operators/me', headers=operator).json()['role'] == 'operator'
        assert client.post('/api/v1/operators/users', headers=operator, json={'username':'intruder', 'password':PASSWORD, 'role':'admin'}).status_code == 403
        assert client.post('/api/v1/operators/users/admin/disable', headers=operator).status_code == 403
        assert client.get('/api/v1/operators/audit', headers=operator).status_code == 403
        assert client.post('/api/v1/operators/users/observer/disable', headers=admin).status_code == 200
        assert client.get('/api/v1/operators/me', headers=operator).status_code == 401
        audit = client.get('/api/v1/operators/audit', headers=admin).json()
        assert any(row['event']=='authorization.denied' for row in audit)
        assert any(row['event']=='user.disabled' for row in audit)
        assert PASSWORD not in json.dumps(audit)
        assert client.post('/api/v1/operators/login', json={'username':'admin','password':'short-secret'}).status_code == 422
        assert 'short-secret' not in client.post('/api/v1/operators/login', json={'username':'admin','password':'short-secret'}).text
        assert client.post('/api/v1/operators/logout', headers=admin).status_code == 200
        assert client.get('/api/v1/operators/me', headers=admin).status_code == 401
    assert PASSWORD.encode() not in path.read_bytes()


def test_restart_expiry_and_persistent_rate_limit(tmp_path):
    path = tmp_path/'accounts.db'
    bootstrap(path)
    now = [1000.0]
    with TestClient(create_operator_app(path, lambda: now[0]), base_url='https://localhost') as client:
        auth = login(client)
        for _ in range(5):
            assert client.post('/api/v1/operators/login', json={'username':'admin','password':'wrong-password-long-enough'}).status_code == 401
        assert client.post('/api/v1/operators/login', json={'username':'admin','password':PASSWORD}).status_code == 429
    with TestClient(create_operator_app(path, lambda: now[0]), base_url='https://localhost') as client:
        assert client.get('/api/v1/operators/me', headers=auth).status_code == 200
        assert client.post('/api/v1/operators/login', json={'username':'admin','password':PASSWORD}).status_code == 429
        now[0] = 1900
        assert client.get('/api/v1/operators/me', headers=auth).status_code == 401
        assert client.post('/api/v1/operators/login', json={'username':'admin','password':PASSWORD}).status_code == 200
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT COUNT(*) FROM audit WHERE event="login.denied"').fetchone()[0] == 5
        assert db.execute('SELECT length(hash),length(salt) FROM users').fetchone() == (32,16)
