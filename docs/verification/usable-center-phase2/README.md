# Phase 2 acceptance

Software suite passed: 136 backend, 84 frontend and 26 browser cases, production build, HTTP/WebSocket, PTY and subprocess checks. Source hashes are recorded; WSL copy excludes .git. Seven bridge tests also passed on Windows.

The new tests use shared MCS1 vectors and check units, uint64 clocks, nulls, source provenance, startup cache discard, duplicate suppression, 5 Hz cap, reboot, source loss, wrong protocol/stream and uncertain ACK fail-stop behavior. An actual receiver and local verified mTLS center carry synthetic MCS1 samples, then source cut causes hidden stale values. Two separate station bridge processes use real local TLS; revoking station-a stops it while station-b completes.

These are software/local socket tests, not physical sensors, two-PC, LAN or Internet acceptance. Historical SITL evidence is unchanged.
