# FLW Secure Link — FSL v1 specification and local profile

Date: 18 October 2026. Status: **local equipment.report profile implemented;
production protocol review remains pending**. The [implementation contract](FSL_IMPLEMENTATION.md)
defines the delivered endpoints, quotas, lifecycle and test scope. Broader proposed
operations below are not implemented unless explicitly listed there.

FSL defines the FLW application contract for civilian equipment metadata and
sensor reporting over standard TLS. It does not define encryption, key exchange,
nonce construction or a replacement TLS handshake. No aircraft-control or
operational-approval message is defined.

## Layers and identities

MCT1/MCS1 remains the USB packet layer. A station decodes and validates those
packets before forming an FSL report. The station-to-center network hop is TLS
1.3; the local profile uses mTLS with application authorization.
This protects that hop, not an untrusted USB device, station memory or disk.
A successfully authenticated station may still report false physical readings.

The center owns station/device assignments. `station_id` in a message must match
the authenticated principal; `device_id` must be enrolled for that station.
Browser-selected roles and device-supplied identifiers never establish authority.

## Proposed session lifecycle

After TLS authentication, a station requests an application session. The server
issues an unpredictable session ID bound to the principal, credential generation
and server expiry. Session creation is authenticated and resource-limited.
Reconnecting resumes only an explicitly valid server session; expiry, revocation
or identity changes require a new authorized session. Sessions are not TLS keys
and session IDs are not bearer credentials.

Production restart behavior must be deterministic: either restore validated
session/replay state durably, or invalidate all affected sessions. Never reset
replay counters while silently keeping old sessions authorized. Offline reports
cannot be promoted to current measurements merely because they are uploaded now.

## Proposed envelope

UTF-8 JSON over HTTPS, with an initial proposed 16 KiB decoded body limit.
Reject duplicate object keys, unknown fields, unsupported versions and non-finite
numbers. Proposed limits are FLW design parameters, subject to interoperability
tests. No application-layer encryption or JSON signature is introduced here.

| Field | Meaning |
|---|---|
| `protocol` | Exactly `FSL` |
| `version` | Exactly 1 |
| `message_id` | Unique report identifier used for deduplication |
| `session_id` | Server-issued, principal-bound session |
| `station_id` | Must equal authenticated station identity |
| `device_id` | Enrolled device assigned to that station |
| `sequence` | Strictly increasing within the session/device pair; uint64 decimal string |
| `type` | Allowlisted equipment/report operation |
| `payload` | Versioned, bounded schema for that operation |

Allowed initial types: `equipment.report` for nullable environmental/battery
measurements and `equipment.read` for scoped metadata reads. Enrolment belongs
to a separate authenticated administrator path, not a station self-claim.
There is no arbitrary executable, routing target, command or firmware-upload type.

`payload` retains reported source (`synthetic` or station-reported `serial`),
source boot/sequence/uptime and existing sensor units. Large integers use decimal
strings to preserve precision across Python and JavaScript. Unknown measurements
remain null. Station receipt, center receipt and device uptime are distinct;
source clocks do not establish trusted wall-clock freshness.

## Acceptance and replay rules

The center authenticates transport/principal, checks revocation/session validity,
checks station/device ownership, validates the envelope and payload, then checks
the replay record. These checks are independent of CRC.

Persist the report, deduplication outcome and accepted counter atomically before
acknowledging acceptance or refreshing current data. An identical retry of the
same message within the same valid session returns the recorded outcome without
a second write or freshness refresh. Reusing an ID with different content is
rejected. A new ID with a previously consumed sequence is rejected. Counter
overflow requires a new authorized session, not silent wraparound.

Transport reconnect does not automatically replay queued reports. An explicit
history-ingestion path, if later added, must label history separately and must not
update live freshness. If validity is uncertain, show unknown instead of success.

The response distinguishes accepted-new, duplicate-known and rejected, with a
stable report ID and server receipt time. Rejection reasons must not leak secrets
or unrelated devices. Local endpoints/error codes are specified in the
[implementation contract](FSL_IMPLEMENTATION.md); production compatibility is not frozen.

## Compatibility

Current `/api/v1/fleet` endpoints remain the legacy local registry API. They do
not accept this envelope or implement FSL sessions/deduplication. The TLS server
adds certificate identity to legacy routes and exposes a separate `/api/v1/fsl`
boundary. Do not silently rename
legacy traffic FSL. Preserve MCT1/MCS1 and historical readers. Unknown protocol
versions fail explicitly; insecure fallback is not a migration strategy.

## Decisions still open

The local profile aligns 900-second sessions and replay retention, bounds storage
quotas and restores session/replay state on restart. Production failover, certificate
profiles, distributed enrollment/renewal and authenticated user roles still need
deployment decisions before rollout. Choose
standard implementation libraries and deployment profiles through review; do not
invent cryptographic code to fill these gaps.

See [policy](FLW_CRYPTO_POLICY.md) and [threat/test matrix](FSL_THREAT_MODEL.md).
Transport reference: [TLS 1.3](https://datatracker.ietf.org/doc/html/rfc9846).
