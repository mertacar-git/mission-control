# Unified acceptance

Use Python 3.12 and Node.js 22 in the **same Ubuntu environment**. Install Node
from its [official distribution](https://nodejs.org/en/download), then from the
repository root:

```bash
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd frontend
npm ci --no-audit --no-fund
npx playwright install --with-deps chromium
cd ../backend
../.venv/bin/python -m tests.acceptance_runner --suite software
```

Use separate Windows/Linux checkouts or install dependencies separately; do not
share `node_modules` across platforms. Windows frontend development and the
independent Windows serial receiver remain supported. The PTY test and pinned
SITL require Linux. Missing prerequisites fail required acceptance, rather than
silently passing via skipped tests.

For firmware acceptance first run the pinned build procedure in the README.
Leave UDP 14550 free; close the application's simulator and recording. Acceptance
owns its simulator directly and does not require a separate HTTP backend.

```bash
python -m tests.acceptance_runner --suite sitl
python -m tests.acceptance_runner --suite all
```

`--output /absolute/new-directory` selects a **new** evidence folder. Otherwise a
unique UTC/UUID folder is created under `.runtime/acceptance`. Prior evidence is
never overwritten. The runner does not install dependencies or download firmware
implicitly. Initial reports list all mandatory checks as not run. Nonzero exits,
timeouts, missing reports, skips and unexecuted checks cannot produce a pass.
Interrupting stops the owned command and leaves later checks not run. Inspect
cleanup logs if a timeout exceeds its grace period.

## Required checks

| Suite | Checks |
|---|---|
| Software | Backend pytest; frontend Vitest; TypeScript/production build; actual installed Uvicorn HTTP/WebSocket startup and close; pyserial Linux PTY; subprocess UDP emulator; desktop and 390 px Chromium critical flows |
| SITL | Seven mission/control/connection/survey/boundary scenarios; five versioned experiment runs (normal twice, heartbeat interruption, battery RTL, GPS LAND); two real-time paired heading flights |
| All | Both suites, sequentially |

Browser tests run the production build in an isolated profile. They exercise
upload review, demo controls, route history without tiles, real-recording replay
isolation, multi-flight HTML/CSV, serial null fields/source separation and missing
evidence. These are software UI tests. The separate SITL suite verifies autopilot
behavior. No real serial access token enters browser traces.

## Output

- `summary.json`: schema/version, UTC times, dependencies, source provenance,
  required commands, results, durations and failure reasons.
- `source-manifest.json`: SHA-256 of tested source/config/public fixtures,
  including archives where Git metadata is unavailable.
- `junit.xml`, `report.html`, per-command raw logs and individual test reports.
- `browser-artifacts`: UI videos, failure screenshots and traces.
- `serial-pty`, `emulator`, `sitl-*`: raw recordings and measured reports;
  acceptance does not replace published fixtures.

Simulator stdout remains in
`backend/.runtime/{integration,experiments,comparison}/flight-*/sitl.log`. The SITL
workflow uploads these alongside the bundle. The Pages workflow requires the
software suite before deploying; both workflows upload failure evidence too.

**Physical hardware remains pending in every report.** Synthetic PTY/packet tests
do not establish USB electronics, calibration, board firmware or sensor accuracy.

Official Playwright references: [test web server](https://playwright.dev/docs/test-webserver),
[recorded test videos](https://playwright.dev/docs/videos).
