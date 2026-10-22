# Certificate approval software acceptance

This bundle accompanies the session-bound administrator approval path documented
in [the operator workflow](../../CERTIFICATE_APPROVAL.md).

- `windows-targeted.xml`: Windows tests for account authorization, enrollment,
  identity audit and the new approval/activation path.
- `summary.json`, `report.html`, `junit.xml`: required software acceptance results.
- `source-manifest.json`: SHA-256 manifest of the exercised application sources.
- Backend/frontend XML and raw logs preserve individual test results.
- `prototype-browser/approvals-*.png`: production UI on real local services,
  using the test-only CA-pinned TLS 1.3 browser adapter. Browser/OS certificate
  trust installation is not accepted by this adapter.
- `approval-*-ui.png`: API-fixture browser coverage of explicit review,
  invalidation on edits, single submission and responsive layout.

Coverage includes actual local mTLS identity replacement, rejection of the old
certificate, administrator-only API access, stale mapping rejection, logout,
account disable, expiration, revocation and single-use failure handling.
Approval creation itself does not alter the registry. The activation command
links the authenticated account approval to the existing offline journal.

No physical board, second PC, LAN, Internet deployment or production PKI is
claimed. Synthetic serial prototype flows remain labeled synthetic. Existing
OS-authorized offline activation remains a separate host-administration path.

## Preserved initial failure

`initial-failed-run` retains the unsuccessful mobile browser run. Opening the
approval panel initially reused the mutation busy flag while loading its list;
a rapid controlled textarea fill could lose its value when that asynchronous
load disabled the field. Inventory loading no longer disables draft controls,
and late inventory responses are ignored after a newer operator action. The
browser scenario explicitly checks that the public-certificate draft survives.
The failed run is not counted as passing acceptance.
