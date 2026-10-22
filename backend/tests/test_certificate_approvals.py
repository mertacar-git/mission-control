import json
import time
import pytest
from fastapi.testclient import TestClient
from mission_control.operator_accounts import create_operator_app
from mission_control.fleet_tls import initialize
from mission_control.station_enrollment import request_identity, sign_request
from mission_control.certificate_approvals import activate_approved
from tests.test_operator_accounts import bootstrap, login, PASSWORD


def setup(tmp_path):
    center=tmp_path/'center';initialize(center)
    station=tmp_path/'station';request_identity(station,'station-a')
    signed=tmp_path/'signed';sign_request(tmp_path/'center-authority',station/'station-a.csr','station-a',signed)
    database=tmp_path/'accounts.db';bootstrap(database)
    candidate=dict(station_id='station-a',certificate_pem=(signed/'station-a.crt').read_text())
    return center,database,candidate


def approve(client,auth,candidate):
    preview=client.post('/api/v1/operators/station-approvals/preview',headers=auth,json=candidate)
    assert preview.status_code==200,preview.text
    checked=preview.json()
    result=client.post('/api/v1/operators/station-approvals',headers=auth,json=dict(candidate,expected_fingerprints=checked['old_fingerprints'],expected_new_fingerprint=checked['new_fingerprint'],reason='Station maintenance replacement'))
    assert result.status_code==201,result.text
    assert 'certificate_pem' not in result.text and 'session_digest' not in result.text
    return result.json()


def test_bound_single_use_approval_and_audit(tmp_path):
    center,database,candidate=setup(tmp_path)
    original=(center/'identities.json').read_bytes()
    with TestClient(create_operator_app(database,tls_directory=center),base_url='https://localhost') as client:
        auth=login(client);approved=approve(client,auth,candidate)
        assert (center/'identities.json').read_bytes()==original
        result=activate_approved(center,database,approved['id'])
        assert result['approved_by']=='admin' and result['state']=='applied'
        assert (center/'identities.json').read_bytes()!=original
        with pytest.raises(ValueError):activate_approved(center,database,approved['id'])
        listed=client.get('/api/v1/operators/station-approvals',headers=auth).json()
        assert listed[0]['operation_id']==result['operation_id']
        audit=client.get('/api/v1/operators/audit',headers=auth).json()
        assert any(item['event']=='certificate.activation.applied' for item in audit)


@pytest.mark.parametrize('invalidate',['logout','expired','mapping','disabled','revoked'])
def test_invalidated_approval_never_changes_mapping(tmp_path,invalidate):
    center,database,candidate=setup(tmp_path)
    with TestClient(create_operator_app(database,tls_directory=center),base_url='https://localhost') as client:
        auth=login(client);approved=approve(client,auth,candidate)
        original=(center/'identities.json').read_bytes()
        if invalidate=='logout':client.post('/api/v1/operators/logout',headers=auth)
        if invalidate=='disabled':
            with client.app.state.accounts.db:
                client.app.state.accounts.db.execute("UPDATE users SET active=0 WHERE username='admin'")
        if invalidate=='revoked':
            (center/'revoked.json').write_text(json.dumps([approved['new_fingerprint']]))
        if invalidate=='mapping':
            mapping=json.loads(original);mapping['0'*64]='station-a';(center/'identities.json').write_text(json.dumps(mapping))
            original=(center/'identities.json').read_bytes()
        with pytest.raises(ValueError):activate_approved(center,database,approved['id'],clock=(lambda:time.time()+901) if invalidate=='expired' else time.time)
        assert (center/'identities.json').read_bytes()==original


def test_operator_denial_stale_review_and_private_key_redaction(tmp_path):
    center,database,candidate=setup(tmp_path)
    with TestClient(create_operator_app(database,tls_directory=center),base_url='https://localhost') as client:
        auth=login(client)
        client.post('/api/v1/operators/users',headers=auth,json=dict(username='observer',password=PASSWORD,role='operator'))
        operator=login(client,'observer')
        for route in ('station-approvals','station-approvals/preview'):
            assert client.post('/api/v1/operators/'+route,headers=operator,json=candidate).status_code==403
        secret='-----BEGIN PRIVATE KEY----- secret-value'
        rejected=client.post('/api/v1/operators/station-approvals/preview',headers=auth,json=dict(candidate,certificate_pem=secret))
        assert rejected.status_code==422 and secret not in rejected.text
        bad=client.post('/api/v1/operators/station-approvals',headers=auth,json=dict(candidate,expected_fingerprints=['0'*64],expected_new_fingerprint='0'*64,reason='Stale certificate review'))
        assert bad.status_code==409


def test_failure_consumes_approval_without_retry(tmp_path,monkeypatch):
    center,database,candidate=setup(tmp_path)
    with TestClient(create_operator_app(database,tls_directory=center),base_url='https://localhost') as client:
        auth=login(client);approved=approve(client,auth,candidate)
        def fail(*args):raise OSError('injected disk failure')
        monkeypatch.setattr('mission_control.certificate_approvals.replace_identity',fail)
        with pytest.raises(RuntimeError,match='unconfirmed'):activate_approved(center,database,approved['id'])
        with pytest.raises(ValueError):activate_approved(center,database,approved['id'])
        assert client.get('/api/v1/operators/station-approvals',headers=auth).json()[0]['state']=='unknown'


def test_approved_activation_changes_real_tls_identity(tmp_path):
    import httpx
    from mission_control.station_enrollment import complete_identity
    from tests.test_fsl import running, enrol
    from tests.test_fleet_tls import context
    center,database,candidate=setup(tmp_path)
    complete_identity(tmp_path/'station',tmp_path/'signed'/'station-a.crt',center/'ca.crt','station-a')
    with TestClient(create_operator_app(database,tls_directory=center),base_url='https://localhost') as client:
        approved=approve(client,login(client),candidate)
        with running(center) as url:
            enrol(center,url)
            with httpx.Client(base_url=url,verify=context(center,'station-a'),trust_env=False) as old, httpx.Client(base_url=url,verify=context(tmp_path/'station','station-a'),trust_env=False) as new:
                assert old.get('/api/v1/fleet/snapshot').status_code==200
                assert new.get('/api/v1/fleet/snapshot').status_code==403
                activate_approved(center,database,approved['id'])
                assert old.get('/api/v1/fleet/snapshot').status_code==403
                assert new.get('/api/v1/fleet/snapshot').status_code==200
