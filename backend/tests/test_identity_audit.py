import json
from pathlib import Path
import httpx, pytest
from fastapi.testclient import TestClient
from mission_control import identity_audit as audit
from mission_control.fleet_tls import initialize, renew
from mission_control.station_enrollment import request_identity, sign_request, activate_identity
from mission_control.operator_accounts import create_operator_app
from tests.test_operator_accounts import bootstrap, login, PASSWORD
from tests.test_fsl import running
from tests.test_fleet_tls import context


def provision(tmp_path):
    center=tmp_path/'tls';initialize(center)
    station=tmp_path/'station';request_identity(station,'station-a')
    issued=tmp_path/'issued';sign_request(tmp_path/'tls-authority',station/'station-a.csr','station-a',issued)
    return center,issued/'station-a.crt'


def test_live_activation_journal_public_archive_and_legacy_inventory(tmp_path):
    center,certificate=provision(tmp_path)
    first=audit.snapshot(center)
    assert first['human_approval'] is False and not first['audit_present'] and not first['operations']
    old=json.loads((center/'identities.json').read_text())
    with running(center) as origin,httpx.Client(base_url=origin,verify=context(center,'station-a'),trust_env=False) as station:
        assert station.get('/api/v1/fleet/snapshot').status_code==200
        operation=activate_identity(center,certificate,'station-a')
        assert station.get('/api/v1/fleet/snapshot').status_code==403
    view=audit.snapshot(center)
    assert view['pending_operations']==0 and view['total_operations']==1
    event=view['operations'][0]
    assert event['operation_id']==operation and event['phase']=='applied' and event['actor_source']=='offline-os'
    assert set(event['old_fingerprints'])=={key for key,value in old.items() if value=='station-a'}
    assert [row['phase'] for row in audit.read_events(center)]==['intent','applied']
    assert next(row for row in view['identities'] if row['identity']=='station-a')['state']=='valid'
    archive=center/'public-certificates'
    assert {path.suffix for path in archive.iterdir()}=={'.crt'}
    assert all('PRIVATE KEY' not in path.read_text() for path in archive.iterdir())
    assert 'PRIVATE KEY' not in (center/'identity-audit.jsonl').read_text()


def test_renew_uses_same_audited_transition(tmp_path):
    center=tmp_path/'tls';initialize(center)
    renew(center,'station-b',tmp_path/'tls-authority',tmp_path/'renewed')
    event=audit.snapshot(center)['operations'][0]
    assert event['action']=='renew' and event['identity']=='station-b' and event['phase']=='applied'


def test_unwritable_intent_prevents_identity_change(tmp_path,monkeypatch):
    center,certificate=provision(tmp_path);before=(center/'identities.json').read_bytes()
    def fail(*args):raise OSError('injected audit failure')
    monkeypatch.setattr(audit,'append_event',fail)
    with pytest.raises(OSError):activate_identity(center,certificate,'station-a')
    assert (center/'identities.json').read_bytes()==before
    assert not (center/'identity-update.lock').exists()


def test_failed_mapping_is_audited_without_changing_identity(tmp_path,monkeypatch):
    center,certificate=provision(tmp_path);before=(center/'identities.json').read_bytes()
    def fail(*args):raise OSError('injected mapping failure')
    monkeypatch.setattr(audit,'write_mapping',fail)
    with pytest.raises(RuntimeError,match='previous mapping'):activate_identity(center,certificate,'station-a')
    assert (center/'identities.json').read_bytes()==before
    assert audit.snapshot(center)['operations'][0]['phase']=='failed'


@pytest.mark.parametrize('change_applied',[False,True])
def test_missing_completion_requires_explicit_observation_not_false_success(tmp_path,monkeypatch,change_applied):
    center,certificate=provision(tmp_path)
    original=audit.append_event
    def fail_completion(directory,event):
        if event['phase']!='intent':raise OSError('injected completion failure')
        original(directory,event)
    monkeypatch.setattr(audit,'append_event',fail_completion)
    if not change_applied:
        def fail_mapping(*args):raise OSError('injected mapping failure')
        monkeypatch.setattr(audit,'write_mapping',fail_mapping)
    with pytest.raises(RuntimeError,match='reconcile|completion'):activate_identity(center,certificate,'station-a')
    assert audit.snapshot(center)['pending_operations']==1
    # No new change can obscure the incomplete transition.
    with pytest.raises(RuntimeError,match='reconciliation'):renew(center,'station-b',tmp_path/'tls-authority',tmp_path/'blocked-renewal')
    monkeypatch.setattr(audit,'append_event',original)
    mapping_before=(center/'identities.json').read_bytes()
    assert audit.reconcile(center)==1
    assert audit.reconcile(center)==0
    assert (center/'identities.json').read_bytes()==mapping_before
    view=audit.snapshot(center)
    assert view['pending_operations']==0
    assert view['operations'][0]['phase']==('observed_mapped' if change_applied else 'observed_not_mapped')


def test_admin_only_snapshot_and_corrupt_audit_are_explicit(tmp_path):
    center,certificate=provision(tmp_path);activate_identity(center,certificate,'station-a')
    database=tmp_path/'accounts.db';bootstrap(database)
    with TestClient(create_operator_app(database,tls_directory=center),base_url='https://localhost') as client:
        admin=login(client)
        client.post('/api/v1/operators/users',headers=admin,json=dict(username='observer',password=PASSWORD,role='operator')).raise_for_status()
        observer=login(client,'observer')
        assert client.get('/api/v1/operators/station-identities').status_code==401
        assert client.get('/api/v1/operators/station-identities',headers=observer).status_code==403
        response=client.get('/api/v1/operators/station-identities',headers=admin)
        assert response.status_code==200 and response.json()['operations'][0]['phase']=='applied'
        assert 'PRIVATE KEY' not in response.text
        with (center/'identity-audit.jsonl').open('a') as file:file.write('{broken\n')
        response=client.get('/api/v1/operators/station-identities',headers=admin)
        assert response.status_code==503 and response.json()['code']=='identity_audit_unavailable'
        before=(center/'identities.json').read_bytes()
        with pytest.raises(ValueError):renew(center,'station-b',tmp_path/'tls-authority',tmp_path/'blocked')
        assert (center/'identities.json').read_bytes()==before
