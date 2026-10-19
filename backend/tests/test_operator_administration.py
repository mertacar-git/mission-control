import json
import sqlite3
from fastapi.testclient import TestClient
from mission_control.operator_accounts import create_operator_app, recover_account, main
import pytest
from tests.test_operator_accounts import bootstrap, login, PASSWORD


def test_password_change_revokes_all_sessions_and_preserves_audit(tmp_path):
    path = tmp_path/'accounts.db'
    bootstrap(path)
    replacement = 'replacement test-only passphrase'
    with TestClient(create_operator_app(path), base_url='https://localhost') as client:
        first, second = login(client), login(client)
        assert client.post('/api/v1/operators/password', headers=first, json={'current_password':'wrong','new_password':replacement}).status_code == 403
        assert client.get('/api/v1/operators/me', headers=first).status_code == 200
        assert client.post('/api/v1/operators/password', headers=first, json={'current_password':PASSWORD,'new_password':PASSWORD}).status_code == 409
        assert client.post('/api/v1/operators/password', headers=first, json={'current_password':PASSWORD,'new_password':replacement}).status_code == 200
        assert client.get('/api/v1/operators/me', headers=first).status_code == 401
        assert client.get('/api/v1/operators/me', headers=second).status_code == 401
        assert client.post('/api/v1/operators/login', json={'username':'admin','password':PASSWORD}).status_code == 401
        response = client.post('/api/v1/operators/login', json={'username':'admin','password':replacement})
        assert response.status_code == 200
        auth = {'Authorization':'Bearer '+response.json()['token']}
        audit = client.get('/api/v1/operators/audit', headers=auth).json()
        assert any(row['event']=='password.change.denied' for row in audit)
        assert any(row['event']=='password.changed' for row in audit)
        assert replacement not in json.dumps(audit)


def test_admin_only_user_listing_and_password_attempt_limit(tmp_path):
    path = tmp_path/'accounts.db'
    bootstrap(path)
    with TestClient(create_operator_app(path), base_url='https://localhost') as client:
        admin = login(client)
        assert client.post('/api/v1/operators/users', headers=admin, json={'username':'observer','password':PASSWORD,'role':'operator'}).status_code == 201
        operator = login(client, 'observer')
        assert client.get('/api/v1/operators/users', headers=operator).status_code == 403
        users = client.get('/api/v1/operators/users', headers=admin).json()
        assert users == [{'username':'admin','role':'admin','active':True},{'username':'observer','role':'operator','active':True}]
        for _ in range(5):
            assert client.post('/api/v1/operators/password', headers=operator, json={'current_password':'wrong','new_password':'replacement test passphrase'}).status_code == 403
        assert client.post('/api/v1/operators/password', headers=operator, json={'current_password':PASSWORD,'new_password':'replacement test passphrase'}).status_code == 429
        assert client.get('/api/v1/operators/me', headers=operator).status_code == 200


def test_password_write_failure_rolls_back_hash_sessions_and_audit(tmp_path):
    path = tmp_path/'accounts.db'
    bootstrap(path)
    with TestClient(create_operator_app(path), base_url='https://localhost', raise_server_exceptions=False) as client:
        auth = login(client)
        with sqlite3.connect(path) as db:
            before = db.execute('SELECT hash FROM users WHERE username="admin"').fetchone()[0]
            db.execute("CREATE TRIGGER fail_password_audit BEFORE INSERT ON audit WHEN NEW.event='password.changed' BEGIN SELECT RAISE(ABORT,'test failure'); END")
        assert client.post('/api/v1/operators/password', headers=auth, json={'current_password':PASSWORD,'new_password':'replacement test-only password'}).status_code == 500
        assert client.get('/api/v1/operators/me', headers=auth).status_code == 200
        with sqlite3.connect(path) as db:
            assert db.execute('SELECT hash FROM users WHERE username="admin"').fetchone()[0] == before
            assert db.execute('SELECT COUNT(*) FROM audit WHERE event="password.changed"').fetchone()[0] == 0


def test_offline_recovery_preserves_role_revokes_sessions_and_cannot_create_users(tmp_path):
    path = tmp_path/'accounts.db'
    bootstrap(path)
    with TestClient(create_operator_app(path), base_url='https://localhost') as client:
        original = login(client)
    recover_account(path, 'admin', 'offline recovery test passphrase')
    with TestClient(create_operator_app(path), base_url='https://localhost') as client:
        assert client.get('/api/v1/operators/me', headers=original).status_code == 401
        response = client.post('/api/v1/operators/login', json={'username':'admin','password':'offline recovery test passphrase'})
        assert response.status_code == 200 and response.json()['role'] == 'admin'
        auth = {'Authorization':'Bearer '+response.json()['token']}
        audit = client.get('/api/v1/operators/audit', headers=auth).json()
        assert any(row['event']=='password.recovered' for row in audit)
    with pytest.raises(ValueError):
        recover_account(path, 'missing', 'offline recovery test passphrase')
    with pytest.raises(FileNotFoundError):
        recover_account(tmp_path/'absent.db', 'admin', 'offline recovery test passphrase')
    with sqlite3.connect(path) as db:
        db.execute('UPDATE users SET active=0 WHERE username="admin"')
    with pytest.raises(ValueError):
        recover_account(path, 'admin', 'offline recovery test passphrase')


def test_cli_validation_does_not_echo_password(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr('sys.argv', ['operator_accounts', '--bootstrap', '--directory', str(tmp_path/'new')])
    monkeypatch.setattr('getpass.getpass', lambda prompt: 'short-secret')
    with pytest.raises(SystemExit):
        main()
    captured = capsys.readouterr()
    assert 'short-secret' not in captured.err + captured.out
    assert not (tmp_path/'new').exists()
