# TLS laboratory acceptance — 18 October 2026

The complete Linux software suite passed: 114 backend tests, 84 frontend tests,
18 critical browser cases across desktop/mobile, production build, HTTP/WS,
serial PTY and subprocess emulator checks. Top-level logs, JUnit, summary and
HTML are retained here; referenced runtime recordings remain in the local
acceptance output `/home/flwitch/tls-software-20261018` rather than this directory.

After the full run, the TLS test gained one additional foreign-client-CA case.
The final TLS/registry selection passed all six tests on Windows and Linux
(4.47 s / 3.26 s). The full-run manifest therefore describes the earlier test
file, with identical runtime code. CI reruns the final source on every push.

TLS evidence uses real sockets and two independent synthetic publisher processes.
It does not represent a physical sensor, separate LAN PCs, Internet deployment,
FSL envelopes, certificate renewal or an independent security audit.

See [setup and detailed checks](../../FLEET_TLS_LAB.md).
