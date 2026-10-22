# Offline station identity audit

This extension records validated **activation** and **local renewal** of existing civilian station identities. It introduces no signing server, remote command channel, certificate-upload API or new cryptographic protocol. The center UI is read-only; only administrators may read it through `GET /api/v1/operators/station-identities`.

## Operator use

Sign in as an administrator, open **Merkez → İstasyon sertifikaları ve işlem kaydı**. The panel shows pinned SHA-256 fingerprints, certificate expiry/revocation status, evaluation time and the last 100 identity operations. Refresh explicitly after an offline change. Certificate expiry is not vehicle connectivity or sensor authenticity. A legacy mapping without a matching public certificate has unknown expiry; an absent legacy journal does not manufacture historical events.

The journal identifies the reported local OS user (`actor_source: offline-os`). This is **not** authenticated human-account approval. Signing, private-key installation and OS-file administration remain outside the human gateway's permissions.

## Write and failure behavior

Existing `station_enrollment activate` and `fleet_tls --renew` share the existing exclusive identity-update lock. They validate journal structure and reject another change while an incomplete operation is pending. Before replacing `identities.json`, an `intent` event is appended and fsynced. The public certificate is archived by fingerprint under `public-certificates/`; no private key is copied there. The mapping is atomically replaced, followed by an `applied` event. The record includes operation UUID, timestamp, station and old/new fingerprints.

If the intent cannot be stored, the mapping is not changed. A failed replacement with the old mapping observed unchanged records `failed`. If replacement may have occurred or the completion record fails, the outcome stays incomplete. No automatic retry, rollback or startup reconciliation is performed. Invalid certificate/profile requests rejected before replacement preparation are not journalled as validated identity operations.

A failed issuance/renewal can leave a new unused output bundle; it is not automatically activated. Existing no-overwrite rules remain in force. Inspect that output explicitly rather than reusing it blindly.

## Explicit recovery

Stop competing offline identity tools and inspect the current mapping and pending operation. If `identity-update.lock` remains after a crash, first establish that its owner is no longer running; only then perform manual lock recovery. The existing lock is never forcibly removed by the center.

```powershell
# From backend, with your actual center directory:
python -m mission_control.station_enrollment audit-reconcile --center-directory .runtime/prototype/tls
```

This records only whether the pending new fingerprint is **currently mapped** (`observed_mapped`) or **currently absent** (`observed_not_mapped`). It does not change identity mappings, issue certificates or claim that historical completion succeeded. Re-running it with no pending operation writes nothing.

A malformed/truncated journal is not silently repaired or skipped. Keep a forensic copy, inspect it offline and restore a verified backup under OS administration. The read API reports unavailable instead of displaying a fabricated clean history. The local journal has a 2 MiB limit; reaching it blocks further changes until explicit offline archival/retention handling. No automatic deletion is provided.

## Limits and acceptance

The journal is a local OS-protected record, not a signed or tamper-evident ledger. An OS administrator can edit it and can bypass these tools. Manual edits to revocations/mappings, offline signing and private-key transfers are not retroactively audited. Power loss can leave incomplete or damaged evidence; explicit recovery preserves uncertainty.

Tests cover actual mTLS activation and loss of the old station's access, renewal, journal failures before and after replacement, explicit recovery for both mapping outcomes, corrupt journals, read permissions and mobile UI. Existing FSL replay/renewal tests remain required. Physical sensors, two-PC/LAN recovery and production PKI remain pending. The separate [session-bound approval path](CERTIFICATE_APPROVAL.md) now links authenticated administrators to offline activation without changing this OS journal contract.
