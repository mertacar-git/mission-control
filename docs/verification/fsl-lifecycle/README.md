# FSL lifecycle acceptance — 18 October 2026

The final Linux software suite includes 118 backend tests, 84 frontend tests and
18 desktop/mobile browser cases, plus production build, HTTP/WS, serial PTY and
subprocess emulator checks. Top-level logs, JUnit, summary, source manifest and
HTML are retained here. Runtime recordings referenced by the report remain in
the local `/home/flwitch/fsl-software-20261018-final` acceptance directory.

Windows also ran the final ten FSL/TLS/registry tests successfully (8.03 seconds).
`windows-tests.log` and `windows-tests.xml` retain that evidence. Actual DPAPI
round-trip/corrupt-input behavior was exercised on Windows, not emulated on Linux.
Linux uses its own private-key permission check instead; this is not a Windows
ACL, cross-user recovery or cross-computer test.

The TLS tests use real loopback sockets and two independent publisher processes.
FSL tests cover session/ownership/parser denial, expiry/quotas, durable replay,
atomic storage rollback, center restart and offline certificate renewal.

No physical sensor, flight behavior, separate LAN computers, Internet deployment,
production CSR enrollment or independent security review was exercised here.
See [implementation and remaining acceptance](../../FSL_IMPLEMENTATION.md).
