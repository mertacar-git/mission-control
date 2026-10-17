# FLW Cryptography Policy v1 — draft

Owner: FLW Aerospace & Defense. Date: 18 October 2026.
Status: **design draft, not implemented or independently audited**.
Scope: civilian equipment registry and sensor reporting. Aircraft commands,
operational permissions, weapons, video streaming and physical flight are excluded.

## Purpose and baseline

FLW defines identity, key custody, authorization, lifecycle and release rules.
It does not introduce a proprietary encryption primitive or handshake. A product
name is not evidence of cryptographic assurance or standards certification.

| Property | Current implementation | Required future state |
|---|---|---|
| Station identity | Distinct random bearer credentials | Independently provisioned station identity with renewal/revocation |
| Transport | Registry binds to loopback HTTP; publisher rejects remote plaintext | TLS 1.3 with server identity validation for network deployment |
| Station permissions | Server checks assigned device serial | Preserve server-side checks independently of transport authentication |
| Keys at rest | Private local files; POSIX mode 0600; Windows ACL must be managed | OS-backed secret storage and verified access controls |
| Database/backups | SQLite is not application-encrypted | Deployment-specific encryption and recovery testing |
| Revocation | Manual configuration replacement and restart | Enforced revocation with bounded propagation and audit |
| Device packets | MCT1/MCS1 CRC and sequence checks | Retain corruption checks; do not confuse CRC with authentication |
| Audit | Successful registry writes are durable | Security events, retention and restricted export |

This baseline was reviewed against `fleet_service.py`, `fleet_station.py` and
the serial receiver. Current tests do not demonstrate TLS, mTLS, key rotation,
storage encryption or end-to-end sensor authenticity.

## Policy requirements

**POL-01 — Standard cryptography.** Use maintained TLS implementations. Network
deployment of the new FSL protocol requires TLS 1.3; there is no plaintext
fallback, certificate-validation bypass or custom cipher. Cipher suites, groups
and certificate signature profiles remain a reviewed deployment decision.
See [TLS 1.3 specification](https://datatracker.ietf.org/doc/html/rfc9846),
[new-protocol requirement](https://datatracker.ietf.org/doc/html/rfc9852) and
[TLS deployment guidance](https://datatracker.ietf.org/doc/html/rfc9325).

**POL-02 — Separate principals.** Each station receives its own identity and
credential. Human operators have separate accounts. No shared fleet master key
is distributed to stations; a serial number, browser role or MAC address is not
an authenticated principal. TLS authentication does not grant device ownership.

**POL-03 — Key generation and custody.** Generate secrets with an OS-backed
cryptographic random source. Do not derive keys from identifiers, passwords,
timestamps or seeds. Maintain a key inventory containing identifier, owner,
purpose, environment, creation/expiry and status, never the secret itself.
Prefer non-exportable OS/hardware-backed private keys when supported; the actual
platform and recovery constraints must be evaluated before selecting storage.

**POL-04 — Lifecycle.** Use explicit pending, active, retiring, revoked and
expired states. Provision through an authenticated administrative process.
Do not send private keys in URLs, repositories, logs, screenshots or Pages assets.
Proposed pilot limits: station certificates up to 90 days, short-lived access
credentials up to 15 minutes, renewal before expiry. These are FLW design choices,
not implemented defaults or universal standards mandates. CA custody, enrolment
and offline renewal remain decisions to close before rollout.

**POL-05 — Revocation and rotation.** Revoke a lost station independently of
other stations. Reject new requests and stop active authenticated sessions within
a proposed 60-second propagation bound. Check status on each write; cached status
must have a bounded lifetime. Revocation must survive restarts. Test expiry during
an active connection and during renewal. Do not silently accept expired identities
because a station is offline or the clock is uncertain.

**POL-06 — Connection identity.** Validate the certificate chain, endpoint name,
validity and intended use. Treat private LANs as networks requiring protection.
mTLS is the proposed station profile; browser/operator authentication is separate.
If TLS terminates at a proxy, explicitly protect the proxy-to-service hop and
prevent clients from forging trusted identity headers. Describe that trust
boundary; do not call proxy-terminated TLS device-to-center end-to-end encryption.

**POL-07 — Message integrity and freshness.** Bind sessions to authenticated
principals and authorized devices. Apply schema, sequence and restart checks
after authentication. TLS 0-RTT must be disabled for FSL writes. Do not infer
measurement age or one-way latency from an unsynchronized device clock.

**POL-08 — Storage and recovery.** Select encrypted volumes or a reviewed
database encryption solution separately from transport security. Protect WAL,
temporary files, exports and backups too. Keep recovery material separate from
encrypted data; test authorized restore and lost-key behavior. Database encryption
does not protect a running process from a compromised administrator.

**POL-09 — Operations.** Log credential IDs and outcomes, not credentials or
private keys. Record enrolment, denied access, ownership changes, renewal and
revocation with restricted retention/export. Define resource limits and monitoring
before external exposure. Keep independent production and test identities.

**POL-10 — Change and release.** Version policy and protocol independently.
Changes require a rationale, compatibility impact, test evidence and reviewer.
No production compliance claim until the threat model, interoperability tests
and independent security review pass. Public policy excludes actual credentials,
CA private material, internal endpoints and recovery secrets.

Key lifecycle principles are informed by
[NIST SP 800-57 Part 1 Rev. 5](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final).
This draft is not a claim of NIST, FIPS or other certification.

## Incident procedure

Identify affected principals; revoke/quarantine their access; preserve restricted
evidence without copying secrets; rotate affected credentials/trust material;
review device ownership and accepted reports; restore only after the recovery
checks pass. Record what was observed and what remains unknown. A compromised
station can fabricate plausible sensor values; encryption cannot establish their
physical correctness.

## Remaining decisions and delivery order

1. Review [threat model and acceptance matrix](FSL_THREAT_MODEL.md).
2. Choose the maintained TLS endpoint, CA/trust distribution, key store and
   operator identity provider for the actual LAN/Internet deployment.
3. Implement enrolment, rotation, revocation and [FSL v1](FSL_V1.md) validation.
4. Run negative security, restart, two-station and restore tests; obtain review.
5. Publish a verified deployment profile, keeping this draft visibly separate
   from implemented capability until those gates pass.
