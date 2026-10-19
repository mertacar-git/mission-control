# Operator administration acceptance — 19 October 2026

The full local software baseline passed 129 backend tests, 84 frontend tests,
22 desktop/mobile browser cases, production build, HTTP/WS, PTY and subprocess
emulator checks. Original top-level logs, JUnit, summary and source manifest are
retained here. Referenced runtime recordings remain under
`/home/flwitch/operator-admin-software-20261019-final`.

A subsequent frontend-only freshness fix was verified by another production
build and all 24 browser cases, including two stalled-request cases. See
`production-build-final.log`, `browser-final.log`, `browser-final.xml` and
`final-source-manifest.json`. Backend source is unchanged between these runs.
CI runs the complete final source after push; the baseline summary is not relabeled
as if it contained the later browser cases.

Windows separately passed all nine account/administration/gateway cases,
including password-change rollback, all-session invalidation, offline recovery,
disabled/missing-user refusal and CLI password-error redaction.

Browser administration uses explicitly intercepted test fixtures. Real HTTPS
and downstream mTLS behavior is tested separately by the backend suite. The
manual Opera screenshot shows the actual local login form without entering an
account or bypassing browser certificate warnings.

No production CA/browser-trust setup, separate-PC LAN, physical hardware,
Internet rollout or independent security audit passed as part of this work.
See [remaining stages](../../CENTER_DELIVERY_PLAN.md).
