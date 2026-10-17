# FSL v1 — threat model and acceptance plan

Date: 18 October 2026. Draft for civilian equipment and sensor reporting.
This document describes tests to implement; it does not mark planned tests passed.

## Assets and trust boundaries

Protect station/operator credentials, device assignments, accepted report/replay
state, measurement provenance, audit records and backups. Boundaries are USB
device to station, station process to OS secret store, station to TLS endpoint,
TLS endpoint to registry, registry to database/backups and operator browser to
identity provider. Document any terminating proxy as a separate trusted component.

Assume an attacker can observe/modify network traffic, replay captured traffic,
send malformed requests, steal a station credential or control a station process.
An enrolled station can lie about readings. A compromised OS/admin or physical
sensor is not made trustworthy by TLS. Availability attacks and measurement
accuracy need separate controls; no numeric security score is generated.

## Threats and evidence

| ID | Threat | Required mitigation/evidence | Current status |
|---|---|---|---|
| SEC-01 | Network observation/tampering | TLS 1.3; tampered traffic must fail without writes | Planned; local HTTP is not encrypted |
| SEC-02 | Impersonated endpoint | Reject untrusted chain, wrong host and expired certificate | HTTPS publisher verifies by library default; negative TLS deployment tests pending |
| SEC-03 | Foreign station/device writes | Principal-bound assignment check; no state mutation on denial | Existing registry scope tests pass; FSL identity binding pending |
| SEC-04 | Stolen identity | Per-station revoke/expire; stop writes and sessions within policy bound | Automated lifecycle pending |
| SEC-05 | Duplicate/replayed report | Atomic durable replay state across restart/failover | Legacy boot/sequence checks tested; FSL sessions/deduplication pending |
| SEC-06 | Credential leak | No URI/redirect/log/bundle/storage exposure; restricted key custody | Some local controls exist; full scan/OS custody review pending |
| SEC-07 | Fake sensor values | Preserve reported source; do not claim physical truth from transport identity | Source labels exist; physical calibration pending |
| SEC-08 | Compromised proxy/forged identity headers | Protected service hop; ignore untrusted identity headers | Proxy deployment pending |
| SEC-09 | Disk/backup theft | Protect database, WAL, exports and backups; verified restore | Storage encryption/recovery pending |
| SEC-10 | Exhausted resources/parser ambiguity | Bounded bodies/sessions; duplicate-key rejection; rate/quota tests | FSL parser and deployment limits pending |
| SEC-11 | Backend write failure | No ACK/freshness promotion before durable commit | Legacy transaction-failure test passes; FSL equivalent pending |
| SEC-12 | Loss of connectivity/clock certainty | Unknown/stale state; no automatic trust or queued live replay | Legacy freshness/restart tests pass; session tests pending |

## Test matrix and required outcomes

Each future check must emit its version/configuration, input fixture, expected
result, observed result and evidence path. Missing mandatory tests are not passes.
Test credentials and CA material must be isolated from production.

1. **TLS negatives (SEC-01/02):** trusted endpoint succeeds; unknown CA, wrong
   name, expired/not-yet-valid certificate and forbidden protocol versions fail.
   No certificate bypass option and no plaintext fallback. No registry write on
   failed handshake. Verify the actual deployed path, not just a mock response.
2. **Identity and scope (SEC-03/08):** station A cannot read/write B's devices;
   a body claiming another station cannot override transport identity; forged
   proxy headers and a center credential used as a publisher fail.
3. **Lifecycle (SEC-04):** expiry/revocation during an active connection, renewal
   before/after expiry and restart preserve denial. Other stations remain usable.
   Measure the configured revocation bound; do not infer it from a timer setting.
4. **Replay/transactions (SEC-05/11):** identical retry returns the prior outcome;
   changed-content ID reuse, old session, consumed sequence and wraparound fail.
   Inject failures between write/counter/ACK and restart; no double write or
   false-current sample. Exercise parallel requests and multiple service workers.
5. **Secret exposure (SEC-06):** inspect bounded logs, exports, browser persistence,
   error messages, bundles and redirect behavior with labelled test credentials.
   Confirm unauthorized OS users cannot read private material in the selected OS.
6. **Freshness (SEC-07/12):** source-clock rollback, missing measurements, station
   loss, center restart and delayed history never fabricate current readings.
   Transport acceptance does not mark calibration verified.
7. **Storage/recovery (SEC-09):** restore an encrypted test backup with authorized
   recovery material; fail cleanly without it. Check WAL/temp/export protection and
   retained session/replay consistency. Do not equate volume encryption with
   protection from a compromised running process.
8. **Resource/interop (SEC-10):** body/field limits, duplicate JSON keys, invalid
   UTF-8, unsupported versions and excessive sessions fail predictably. Compare
   Python/TypeScript uint64/null semantics. Test two synthetic station processes
   and three devices in an isolated deployment.

Current evidence is the local registry suite in
[fleet-registry verification](verification/fleet-registry/README.md).
Reproduce its implemented subset from `backend`:

```bash
python -m pytest tests/test_fleet_service.py -q
```

The previous 113/84/18 software counts are historical application acceptance,
not FSL/TLS certification. This documentation delivery changes no runtime code.

## Release gate

Close the open design decisions, implement the contract and threat mitigations,
run all mandatory cases against the configured deployment, obtain independent
security review and record remaining limitations. Only then claim the specific
verified FSL profile. Neither public documentation nor an FLW label proves that
the present prototype implements encryption.
