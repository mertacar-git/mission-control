# Phase 1 acceptance

Software suite passed: 129 backend, 84 frontend, 26 production-browser cases (desktop and 390 px), production build, HTTP/WebSocket, serial PTY and UDP subprocess checks. Source hashes are in source-manifest.json; WSL copy intentionally excludes .git, so revision fields are null. Windows operator account/gateway tests: 9 passed. Browser tests exercise enrollment, duplicate handling, role isolation, search and freshness. Existing real-mTLS gateway test checks direct operator enrollment denial and revoked center identity.

No physical sensor, second-PC, LAN, Internet or new SITL acceptance is claimed.
