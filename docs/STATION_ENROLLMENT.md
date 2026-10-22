# Station-local CSR enrollment

Local software delivery, 18 October 2026. Civilian registry only. Physical
two-computer LAN and Internet acceptance have not been performed.

The private station key is generated on the station PC, never sent to the signer.
The offline administrator explicitly chooses an allowlisted station role; the CSR
name does not authorize itself. The signer accepts valid SHA-256/P-256 CSRs with
the exact expected subject and no requested extensions, and returns only public
certificate files. Station installation verifies CA signature, expiry, client
profile and equality with its own private key. Activation is a separate explicit
administrator step; signing alone does not revoke the old working identity.

## Commands

Install backend requirements with Python 3.12 on both PCs. Create the center and
offline authority using [FSL setup](FSL_IMPLEMENTATION.md). On the station:

```sh
python -m mission_control.station_enrollment request --directory .runtime/station-a-local --identity station-a
```

Transfer **only** `station-a.csr` to the offline administrator. Do not transfer
`.key` or `.key.dpapi`. On the administrator's PC:

```sh
python -m mission_control.station_enrollment sign --authority .runtime/fsl-authority --csr incoming/station-a.csr --identity station-a --output outgoing/station-a-issued
```

Return `station-a.crt` to the station. Independently verify/provision the trusted
CA certificate through your administrator, rather than trusting an arbitrary CA
sent alongside an unknown certificate. On the station:

```sh
python -m mission_control.station_enrollment complete --directory .runtime/station-a-local --identity station-a --certificate incoming/station-a.crt --trusted-ca trusted/ca.crt
```

On the center, after confirming station installation:

```sh
python -m mission_control.station_enrollment activate --center-directory .runtime/fsl-center --identity station-a --certificate incoming/station-a.crt
```

Activation atomically replaces only the chosen station's fingerprint mapping.
Old certificates and their FSL sessions lose access on the next request; a new
certificate needs a new FSL session. Station-b remains assigned independently.
Existing directories/files are not overwritten. A failed partial installation
can leave public files; use a new request directory after inspecting the failure.
The exclusive identity-update lock has the same crash-recovery rule as local renewal.

For the tested single-PC demonstration, paths may point to separate local
directories, then use the completed station bundle with:

```sh
python -m mission_control.fleet_station --center https://127.0.0.1:8771 --tls-directory .runtime/station-a-local --identity station-a --fsl --seconds 10
```

Assigned equipment must already be enrolled. The center remains loopback-only;
these commands do not enable remote network access. Offline approval depends on
access to CA signing files and center configuration, not implemented human accounts.

## Key custody and evidence

Windows keys use locally generated encrypted PEM and current-user DPAPI password
protection; Linux keys use 0600 private files. The station's key stays byte-for-byte
unchanged during signing and completion. Public signer output contains exactly
the issued certificate and CA certificate. No private signing key is copied into
that output. Existing legacy/local-renewal paths remain available for compatibility.

`python -m pytest tests/test_station_enrollment.py -q` exercises the CLI request,
public-only signing, live HTTPS activation/FSL reporting, wrong subject/key/CA,
revoked activation and no-overwrite behavior. Windows tests execute real DPAPI.

Pending: authenticated human approval accounts and audit, deployment CA operation,
Windows ACL/recovery acceptance, verified artifact transfer, separate-PC LAN tests
and Internet configuration. This is offline enrollment software, not a production
PKI service or proof of physical sensor authenticity.

## Offline action journal and center inspection

Validated activation and local renewal now write a shared intent/completion journal and archive only public certificates. Administrators can inspect identity fingerprints, certificate time status and operation outcomes in Merkez. [Journal format, uncertainty and explicit recovery](IDENTITY_AUDIT.md).

The reported offline OS user is not a human-account approval. Existing signing/key custody and no-overwrite rules remain unchanged. Incomplete operations block another identity change until explicit offline reconciliation; damaged journals are not silently skipped.

## Account-linked approval

For authenticated administrator approval before offline activation, use the
[session-bound certificate approval workflow](CERTIFICATE_APPROVAL.md). Legacy
OS-authorized commands retain their separate local administration boundary.
