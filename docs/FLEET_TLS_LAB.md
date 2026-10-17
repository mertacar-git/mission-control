# Civilian registry TLS laboratory

Implemented on 18 October 2026. Local acceptance foundation, not an Internet
deployment or the FSL application protocol. No aircraft commands are provided.

## Run

From `backend`, install `requirements.txt` in Python 3.12, then:

```sh
python -m mission_control.fleet_tls --init
python -m mission_control.fleet_tls
```

The service listens only on `127.0.0.1:8771`. Initialization requires a new
`.runtime/fleet-tls` directory and never overwrites an existing identity.
Certificates expire after seven days. The local test CA private key is not
persisted; renewal requires a new laboratory directory. Do not install this CA
as a system-wide trust anchor or distribute the complete directory to stations.
Each station needs only its own key/certificate and `ca.crt`. Private keys are
unencrypted local files with POSIX 0600; Windows file ACLs must be managed.

Enroll equipment with the center certificate using a Python HTTPS client:

```python
import ssl
import httpx

ctx = ssl.create_default_context(cafile='.runtime/fleet-tls/ca.crt')
ctx.minimum_version = ssl.TLSVersion.TLSv1_3
ctx.load_cert_chain('.runtime/fleet-tls/center.crt', '.runtime/fleet-tls/center.key')
with httpx.Client(base_url='https://127.0.0.1:8771', verify=ctx, trust_env=False) as client:
    for station in ('station-a', 'station-b'):
        response = client.post('/api/v1/fleet/devices', json={
            'serial': station, 'name': station, 'station': station,
            'model': 'Synthetic bench', 'firmware': 'SIM', 'equipment': []})
        response.raise_for_status()
```

Run these publishers in two separate terminals:

```sh
python -m mission_control.fleet_station --center https://127.0.0.1:8771 --tls-directory .runtime/fleet-tls --identity station-a --seconds 10
python -m mission_control.fleet_station --center https://127.0.0.1:8771 --tls-directory .runtime/fleet-tls --identity station-b --seconds 10
```

Sources remain explicitly synthetic. Repeated runs need a newer boot value;
the default is wall-clock seconds, not a hardware boot-counter guarantee.
The existing browser registry panel still targets the legacy HTTP service.
There is no browser certificate enrollment or HTTPS panel in this delivery.

## Identity, expiry and revocation

OpenSSL/Python performs TLS 1.3 and mandatory client-chain verification. A pinned
Uvicorn 0.34.0 H11 adapter obtains the verified peer certificate directly from
the transport; no proxy or network header establishes identity. SHA-256 leaf
fingerprints in `identities.json` map certificates to existing server-enforced
registry roles. Fingerprints are identifiers, not a custom encryption scheme.
Incoming bearer headers are discarded in TLS mode. Legacy HTTP remains separate.

`revoked.json` is an array of leaf fingerprint strings. Add the desired fingerprint
from `identities.json` to revoke it. Both files are reread before each HTTP request,
including requests on an existing keep-alive connection; unreadable or malformed
configuration fails closed. Replace configuration files atomically to avoid
temporary denial. Certificate expiry is checked per request as well as during
the handshake. TLS session tickets are disabled. Revocation is application
authorization denial (HTTP 403), not an issued CRL or OCSP service.

## Acceptance and remaining work

```sh
python -m pytest tests/test_fleet_tls.py tests/test_fleet_service.py -q
```

The real loopback HTTPS test launches two independent publisher processes and
checks center/station scopes, forged authorization headers, cross-station denial,
unenrolled identity, missing/expired client certificates, an untrusted server CA,
wrong hostname, TLS 1.2 rejection, negotiated TLS 1.3, and revocation on a reused
connection. Certificates are generated in temporary directories; no private key
or credential is checked into source control. All owned processes are stopped.

Still pending: independent two-PC LAN/Internet acceptance, production CA/CSR
provisioning and renewal, OS-backed custody, operator accounts, security-denial
audit, resource limits, encrypted backup recovery, FSL sessions/replay envelopes,
and independent review. This local experiment does not satisfy the whole policy.

References: [Python SSL](https://docs.python.org/3/library/ssl.html),
[X.509 certificate builder](https://cryptography.io/en/stable/x509/reference/),
[Uvicorn deployment](https://www.uvicorn.org/deployment/).
