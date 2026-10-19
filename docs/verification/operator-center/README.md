# Operator center acceptance

Delivery reviewed 19 October 2026. Original run timestamps are retained unchanged.
Linux software acceptance passed 124 backend tests, 84 frontend tests and 20
desktop/mobile browser cases, production build, HTTP/WS, PTY and UDP checks.
Top-level logs, source manifest, JUnit, summary and HTML are retained here.
Referenced runtime recordings remain in `/home/flwitch/operator-software-20261018`.

Windows separately verifies roles, account disable/logout, session expiry/restart,
persistent rate limits, redacted validation, a real human HTTPS login and the
real mTLS registry gateway. Human browser UI tests use an intercepted fixture;
they do not establish actual browser trust in the local CA or two-PC connectivity.

No physical board, separate-PC LAN, Internet, MFA, recovery or production audit
acceptance is claimed. See [setup](../../OPERATOR_CENTER.md) and
[remaining stages](../../CENTER_DELIVERY_PLAN.md).
