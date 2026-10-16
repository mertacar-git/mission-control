# v1.8 acceptance evidence

Both executions passed on 16 October 2026 in a separate Ubuntu source copy with
a new Python 3.12.3 environment and Linux npm dependencies. The pinned firmware
installation was shared from `/opt/mission-control`; it was not rebuilt for this
run. Simulator startup verifies the pinned checkout revision for every session.

- [All-suite summary](all/summary.json), [HTML report](all/report.html),
  [JUnit](all/junit.xml): 103 backend, 76 frontend and 10 browser tests; real
  HTTP/WebSocket, pyserial PTY and UDP subprocesses; seven baseline SITL scenarios,
  five versioned experiment runs and two real-time heading flights.
- [Final software summary](software/summary.json), [HTML report](software/report.html),
  [JUnit](software/junit.xml): all software checks repeated after the final
  presentation refinements.
- [Source parity](source-parity.json): the two tested snapshots differ only in
  frontend spacing/serial counter-card presentation; backend source is identical.
  Each bundle contains its full source manifest. Digests identify exact tested
  bytes; checkout line-ending normalization can change them.
- `all/sitl-baseline`, `all/sitl-experiments`, `all/sitl-paired-flights`: actual
  recordings, expected/observed checks, mission results and reports.
- `simulator-logs`: actual stdout from twelve isolated firmware processes.
- `software/browser-artifacts`: recorded isolated browser test runs; traces and
  screenshots are retained on failures. All ten final cases passed without retry.

The archive copy did not include `.git`, so Git revision/dirty metadata is null;
the source-manifest hashes remain available. Node 22.23.3 was downloaded from the
official distribution and checked against its SHA-256 list. Playwright 1.64.1
used its pinned Chromium build. No real receiver token enters this evidence.

Source labels remain explicit: real SITL, browser demo, synthetic UDP and
synthetic serial. No physical USB board, sensor calibration or aircraft was
validated. Hardware acceptance remains pending.

[Reproduce](../../../ACCEPTANCE.md) · [Delivery phases](../../../PHASE_DELIVERY.md).
