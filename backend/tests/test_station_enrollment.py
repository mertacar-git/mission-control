import json
import subprocess
import sys
from pathlib import Path
import httpx
import pytest
from cryptography.exceptions import InvalidSignature
from mission_control.station_enrollment import request_identity, sign_request, complete_identity, activate_identity
from mission_control.fleet_tls import initialize
from tests.test_fsl import running, enrol, envelope
from tests.test_fleet_tls import context


def test_station_generated_key_public_only_signing_and_live_activation(tmp_path):
    center, station, signed = (tmp_path/name for name in ('center', 'station', 'signed'))
    initialize(center)
    subprocess.run([sys.executable, '-m', 'mission_control.station_enrollment', 'request', '--directory', str(station), '--identity', 'station-a'], cwd=Path(__file__).resolve().parents[1], check=True, capture_output=True)
    original = (station/'station-a.key').read_bytes()
    sign_request(tmp_path/'center-authority', station/'station-a.csr', 'station-a', signed)
    assert {path.name for path in signed.iterdir()} == {'station-a.crt', 'ca.crt'}
    assert not (center/'station-a.csr').exists()
    complete_identity(station, signed/'station-a.crt', center/'ca.crt', 'station-a')
    assert (station/'station-a.key').read_bytes() == original
    with running(center) as url:
        enrol(center, url)
        with httpx.Client(base_url=url, verify=context(station, 'station-a'), trust_env=False) as new, httpx.Client(base_url=url, verify=context(center, 'station-a'), trust_env=False) as old:
            assert new.get('/api/v1/fleet/snapshot').status_code == 403
            assert old.get('/api/v1/fleet/snapshot').status_code == 200
            activate_identity(center, signed/'station-a.crt', 'station-a')
            assert old.get('/api/v1/fleet/snapshot').status_code == 403
            session = new.post('/api/v1/fsl/sessions').json()['session_id']
            assert new.post('/api/v1/fsl/reports', json=envelope(session)).json()['status'] == 'accepted-new'
    with pytest.raises(FileExistsError):
        request_identity(station, 'station-a')
    with pytest.raises(FileExistsError):
        complete_identity(station, signed/'station-a.crt', center/'ca.crt', 'station-a')


def test_enrollment_rejects_wrong_identity_key_authority_and_revocation(tmp_path):
    center, station, other, signed = (tmp_path/name for name in ('center', 'station', 'other', 'signed'))
    initialize(center)
    request_identity(station, 'station-a')
    request_identity(other, 'station-a')
    with pytest.raises(ValueError):
        sign_request(tmp_path/'center-authority', station/'station-a.csr', 'station-b', signed)
    sign_request(tmp_path/'center-authority', station/'station-a.csr', 'station-a', signed)
    with pytest.raises(ValueError):
        complete_identity(other, signed/'station-a.crt', center/'ca.crt', 'station-a')
    with pytest.raises(ValueError):
        activate_identity(center, signed/'station-a.crt', 'station-b')
    initialize(tmp_path/'foreign')
    with pytest.raises((ValueError, InvalidSignature)):
        complete_identity(station, signed/'station-a.crt', tmp_path/'foreign'/'ca.crt', 'station-a')
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes
    fingerprint = x509.load_pem_x509_certificate((signed/'station-a.crt').read_bytes()).fingerprint(hashes.SHA256()).hex()
    (center/'revoked.json').write_text(json.dumps([fingerprint]))
    with pytest.raises(ValueError):
        activate_identity(center, signed/'station-a.crt', 'station-a')
    assert not (center/'identity-update.lock').exists()
