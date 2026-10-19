import httpx
from fastapi.testclient import TestClient
from mission_control.operator_accounts import create_operator_app
from mission_control.fleet_tls import initialize
from tests.test_fsl import running
from tests.test_operator_accounts import bootstrap, login, PASSWORD
from mission_control.operator_accounts import operator_server
from tests.test_fleet_tls import context
import socket, threading, time


def test_real_mtls_gateway_role_enforcement_and_outage(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    database = tmp_path/'users.db'
    bootstrap(database)
    with running(directory) as origin:
        with TestClient(create_operator_app(database, tls_directory=directory, registry_origin=origin), base_url='https://localhost') as client:
            admin = login(client)
            client.post('/api/v1/operators/users', headers=admin, json=dict(username='observer', password=PASSWORD, role='operator')).raise_for_status()
            operator = login(client, 'observer')
            device = dict(serial='BENCH-01', name='Bench', model='Sensor', station='station-a', firmware='SIM', equipment=[])
            assert client.post('/api/v1/operators/devices', headers=operator, json=device).status_code == 403
            assert client.get('/api/v1/operators/registry', headers=operator).json()['registry']['devices'] == []
            assert client.post('/api/v1/operators/devices', headers=admin, json=device).status_code == 201
            snapshot = client.get('/api/v1/operators/registry', headers=operator).json()
            assert snapshot['user']['role'] == 'operator'
            assert snapshot['registry']['devices'][0]['device']['serial'] == 'BENCH-01'
            assert client.post('/api/v1/operators/devices', headers=admin, json=device).status_code == 409
            # A revoked center identity cannot be bypassed with a human bearer.
            import json
            identities = json.loads((directory/'identities.json').read_text())
            (directory/'revoked.json').write_text(json.dumps([next(key for key,value in identities.items() if value=='center')]))
            denied = client.get('/api/v1/operators/registry', headers=operator)
            assert denied.status_code == 403 and 'devices' not in denied.text


def test_human_https_socket_login_without_station_private_key(tmp_path):
    directory = tmp_path/'tls'
    initialize(directory)
    database = tmp_path/'users.db'
    bootstrap(database)
    with socket.socket() as bound:
        bound.bind(('127.0.0.1',0))
        port = bound.getsockname()[1]
    service = operator_server(database, directory, port=port)
    thread = threading.Thread(target=service.run, daemon=True)
    thread.start()
    try:
        deadline = time.monotonic()+10
        while not service.started and time.monotonic()<deadline:
            time.sleep(.02)
        assert service.started
        with httpx.Client(base_url=f'https://127.0.0.1:{port}', verify=context(directory), trust_env=False) as client:
            response = client.post('/api/v1/operators/login', json={'username':'admin','password':PASSWORD})
            assert response.status_code == 200
            assert response.headers['cache-control'] == 'no-store'
            assert client.get('/api/v1/operators/me', headers={'Authorization':'Bearer '+response.json()['token']}).json()['role'] == 'admin'
    finally:
        service.should_exit = True
        thread.join(10)
        assert not thread.is_alive()
