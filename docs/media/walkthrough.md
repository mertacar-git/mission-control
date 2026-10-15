# Captioned walkthrough · UI 1.3

[Play/download the 40-second MP4](https://github.com/mertacar-git/mission-control/raw/refs/heads/main/docs/media/walkthrough.mp4).

The video is a sequence of actual browser captures with burned-in Turkish explanations. It is not an uninterrupted real-time screen recording and contains no synthetic application mockups. No narration or soundtrack is included.

| Time | View | Source |
| --- | --- | --- |
| 00–05 s | Separate allowed/survey areas and concave route, grid-only map | Local planning workspace |
| 05–10 s | Explicit route preview and application | Local geometry engine |
| 10–15 s | Invalid area geometry blocks confirmation | Browser demo validation |
| 15–20 s | Polygon/limits snapshot before upload | Local SITL submission dialog |
| 20–25 s | Generated survey execution | Live ArduCopter 4.6.3 |
| 25–30 s | Timeline, speed and live-command isolation | Actual SITL recording replay |
| 30–35 s | Flight metrics and graphs | Analysis of the same recording |
| 35–40 s | Boundary metrics and export controls | Analysis of the same recording |

The browser-operated survey recording is session `5aed94d5-124f-4be7-9c0e-ee000d2b2507`, captured on 2026-10-15 at 1× simulator speed. [Raw session](../verification/survey-ui-session.json), [report](../verification/survey-ui-report.json), [CSV](../verification/survey-ui-telemetry.csv). It contains 213 samples over 109.017 wall seconds, including post-landing data. Example simulation coordinates are arbitrary and do not identify a user's location.

The separate [seven-scenario automated SITL suite](../verification/sitl-results.json) runs at 4×. Its narrow-boundary flight is separate from the no-violation UI flight shown here. [Narrow-boundary report](../verification/narrow-boundary-report.json), [planning method and limits](../SURVEY_PLANNING.md). The earlier LOITER descent finding remains available as [regression evidence](../verification/hold-regression.json).
