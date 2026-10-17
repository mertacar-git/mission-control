# FSL v1 local implementation and certificate lifecycle

Delivered 18 October 2026. Civilian equipment metadata and environmental reports
only. Local TLS 1.3/mTLS acceptance; production rollout and independent audit
remain pending. No aircraft controls, operational permits or weapon integration.

## New laboratory and offline authority

Install `backend/requirements.txt` with Python 3.12, then from `backend`:

```sh
python -m mission_control.fleet_tls --directory .runtime/fsl-center --authority .runtime/fsl-authority --init
python -m mission_control.fleet_tls --directory .runtime/fsl-center
```

Existing directories are never overwritten or silently migrated. Older TLS labs
discarded the CA signing key and cannot renew under that CA; create a new isolated
lab using the commands above. The new authority directory holds the CA signing
key separately from the center serving files. Keep it offline and never copy it
to a station. The test CA expires after eight days; leaf certificates after seven
days. This is a short-lived laboratory profile, not a production CA service.

Windows generates encrypted PKCS8 PEM keys. A random PEM password is protected
by current-user **DPAPI** in `<name>.key.dpapi`; only protected password bytes are
written. TLS loads the password in memory without a plaintext temporary key.
The same user on the same Windows machine loads the key; cross-user/cross-machine
recovery has not been tested. DPAPI does not protect against compromise of that
user's process. Sidecar/key files and directory ACLs still need deployment control.
Linux creates private key files with mode 0600 and directories with 0700;
group/other-readable keys are refused by the loader. Linux file permissions are
not encryption at rest. Legacy unencrypted Windows test keys remain readable;
they are not silently converted or represented as protected.

This lab generates station keys locally. Distributed production enrollment needs
station-local key generation and a CSR signing flow; copying a DPAPI bundle to
another computer is not supported. No keys or passwords belong in Git or Pages.

## Enrollment and publishers

Use the enrollment example in [TLS laboratory](FLEET_TLS_LAB.md), changing its
directory to `.runtime/fsl-center`. Each station must have assigned equipment.
Run these in separate terminals for bounded synthetic reports:

```sh
python -m mission_control.fleet_station --center https://127.0.0.1:8771 --tls-directory .runtime/fsl-center --identity station-a --fsl --seconds 10
python -m mission_control.fleet_station --center https://127.0.0.1:8771 --tls-directory .runtime/fsl-center --identity station-b --fsl --seconds 10
```

The publisher obtains a session, sends fresh synthetic samples and stops on an
error or ambiguous timeout. It does not automatically retry, replay a queue,
reconnect, create another session or downgrade protocols. Repeated runs use a
new boot value by default (wall-clock seconds, not a hardware counter).

## Station renewal

In another terminal, with access to the offline authority:

```sh
python -m mission_control.fleet_tls --directory .runtime/fsl-center --renew station-a --authority .runtime/fsl-authority --output .runtime/station-a-next
```

This creates a new key/certificate without overwriting old files and atomically
replaces only station-a's fingerprint mapping. The old certificate loses access
on its next request, including an existing connection. New credentials cannot
reuse an old certificate-bound FSL session. Start the next publisher with
`--tls-directory .runtime/station-a-next --identity station-a --fsl`.
Station-b is unaffected. Old replay evidence is retained until session expiry.
There is no grace overlap, automatic renewal or operator account in this phase.

An exclusive local lock prevents simultaneous renewal tools from overwriting
each other. A crash can leave `identity-update.lock`; after confirming no renewal
process remains, an administrator may remove that stale lock. Failure after key
issuance can leave a new, unenrolled output bundle; the old mapping remains until
the atomic replacement. Reuse requires a different new output directory.

## Implemented HTTP contract

The existing legacy `/api/v1/fleet` API is preserved. Only the mTLS server installs:

| Endpoint | Authentication and result |
|---|---|
| `POST /api/v1/fsl/sessions` | Station certificate; 201 with `protocol`, `version`, `session_id`, `expires_utc_ms` |
| `POST /api/v1/fsl/reports` | Same certificate plus a valid session; 200 `accepted-new` or `duplicate-known` |

Sessions last at most 900 seconds and cannot exceed certificate expiry. They are
random IDs bound to the certificate fingerprint and station, never bearer keys.
Eight unexpired sessions per station and 10,000 reports per session are allowed.
Expired session/replay rows are removed together when a session is created;
otherwise they remain durable. No background deletion occurs. The application
uses one Uvicorn worker; distributed/multi-worker acceptance is not claimed.

Reports follow the [FSL envelope](FSL_V1.md), with `type=equipment.report` only.
`equipment.read` remains a future FSL operation; scoped reads use the legacy API.
The decoded JSON body is bounded to 16 KiB. Duplicate keys, extra fields,
non-finite numbers, unsupported versions and noncanonical uint64 sequences fail.
`source_time_ms` above JavaScript's exact integer range uses a decimal string.
Null measurements remain null. Pydantic rejects invalid sensor ranges.

The receipt returns `protocol`, `version`, `status`, `message_id` and
`received_utc_ms`. Identical retries return the original receipt time without a
new report, audit entry or freshness refresh. Changed message IDs/content and
consumed/regressed counters produce 409. Invalid sessions/ownership produce 403,
invalid JSON/schema 422, body limit 413, quota 429. A storage failure returns 500;
the caller must treat that result as uncertain rather than fabricate success.

Report, audit and replay evidence commit atomically. Current-data freshness is
promoted only after commit. Restart preserves sessions/replay evidence but drops
receipt freshness: old measurements show unknown, and duplicate retries cannot
make them current. Clock regression before session issuance fails session checks.
TLS revocation is checked again after the body is read, before report processing.

The server cannot prove when a compromised station sampled a value. There is no
history ingestion endpoint or automatic queued-report upload. Device source
uptime does not establish trusted wall-clock freshness or sensor authenticity.

## Acceptance and next work

```sh
python -m pytest tests/test_fsl.py tests/test_fleet_tls.py tests/test_fleet_service.py -q
```

Real loopback HTTPS tests cover two publisher processes, identity scopes,
certificate denial, malformed JSON, expiry/quota, renewal on a live connection,
restart deduplication and transaction rollback after report writes but before
replay insertion. Windows additionally exercises actual DPAPI round-trip and
corrupt-blob denial; Linux exercises key-permission denial.

Pending: station-local CSR provisioning, production CA/expiry/revocation audit,
operator/admin identities, key recovery, Windows ACL acceptance, encrypted SQLite
backups, resource/slow-client hardening, signed update delivery, independent review,
two physical computers on LAN and Internet deployment. The browser registry panel
still targets legacy loopback HTTP; no new browser security controls are claimed.

References: [Microsoft CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata),
[CryptUnprotectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptunprotectdata),
[Python SSL](https://docs.python.org/3/library/ssl.html).
