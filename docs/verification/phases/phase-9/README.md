# Phase 9 — sensor software acceptance

Required software suite passed in Ubuntu on 17 October 2026: 108 backend tests, 78 frontend tests and 14 desktop/mobile browser cases.
Includes shared C++/Python wire vector and actual Linux serial PTY sensor capture. Raw transport is software, not a physical USB board.
See summary.json, report.html, test logs and source-manifest.json. Complete raw artifacts are retained locally and published by the CI artifact.
The ESP32 build is a separate mandatory CI job. Physical operation, calibration and accuracy remain pending.
