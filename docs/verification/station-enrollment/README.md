# Station CSR enrollment acceptance — 18 October 2026

Linux software acceptance: 120 backend tests, 84 frontend tests, 18 desktop/mobile
browser cases, production build, HTTP/WS, serial PTY and subprocess emulator.
Top-level logs, JUnit, summary, source manifest and HTML are retained here; raw
runtime recordings referenced by the HTML remain in `/home/flwitch/csr-software-20261018`.

Windows ran all 12 CSR/FSL/TLS/registry tests (10.23 seconds), including real DPAPI
key handling. Retained `windows-tests.log` and XML describe that separate run.

CSR acceptance generates a station key through the CLI, checks public-only signing
output and unchanged local key, completes the station bundle, activates it against
a live TLS service and submits an FSL report. Wrong identity, wrong local key,
wrong CA, revoked certificate and overwriting existing bundles are rejected.

All processes ran on one PC. No physical sensor, two-PC LAN, Internet deployment,
human login/approval audit or production PKI recovery acceptance was performed.
See [commands and limitations](../../STATION_ENROLLMENT.md).
