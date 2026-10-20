# Offline identity audit acceptance

Final software acceptance passed: 149 backend tests, 84 frontend tests, 28 critical browser cases and 2 real-service desktop/mobile flows, production build, real HTTP/WebSocket, PTY and emulator subprocess checks. The final source manifest matched the tested WSL tree after completion. The WSL source copy excludes .git; hashes identify tested inputs.

Windows targeted tests: 13 passed (windows-targeted.xml). New tests cover actual mTLS activation and loss of the old identity's access, renewal, public-only archive, failed intent/mapping/completion writes, explicit reconciliation for mapped and unmapped outcomes, corrupt journals and admin-only read access. The new audit-reconcile CLI was also run on Windows against an injected pending record: it preserved mappings and recorded observed_not_mapped, not historical success.

The initial acceptance run failed one existing lifecycle test with a cancelled TestClient future at context teardown; its failed report, log and original manifest remain in initial-run/. The lifecycle regression test now uses actual Uvicorn/WebSocket transport, verifies three disconnects release subscribers within one second without telemetry, and shuts down its own server. No flight/command implementation was changed to suppress the error. The final full run passed all mandatory checks.

Real-service browser tests open the new read-only administrator panel and verify initial missing-journal status, station identity and no overflow at 1440 and 390 px. Critical browser tests also verify expiry warning, incomplete operation warning and removal of data after a failed refresh. Certificate screenshots are in prototype-browser/certificates-*.png. This browser adapter fetches actual HTTPS responses using the run's CA with verified TLS 1.3; it does not prove OS/browser trust-store enrollment.

Offline OS-user attribution is not human-account approval; the local journal is not tamper-evident. No private key, runtime token or account database is included. Physical sensor, second-PC/LAN, Internet, production PKI and new SITL acceptance remain outside this software result.
