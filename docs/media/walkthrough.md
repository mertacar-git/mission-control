# Captioned walkthrough · UI 1.2

[Play/download the 35-second MP4](https://github.com/mertacar-git/mission-control/raw/refs/heads/main/docs/media/walkthrough.mp4).

The video is a sequence of actual browser captures with burned-in Turkish explanations. It is not an uninterrupted real-time screen recording and contains no synthetic application mockups. No narration or soundtrack is included.

| Time | View | Source |
| --- | --- | --- |
| 00–05 s | Route editor and history controls | Local application, planned route |
| 05–10 s | Snapshot review before upload | Local SITL submission dialog |
| 10–15 s | Mission execution | Live ArduCopter 4.6.3 |
| 15–20 s | BRAKE hold at 10 m | Replay of the corrected actual SITL acceptance recording |
| 20–25 s | Missing measurements during heartbeat loss | Replay of the same recording |
| 25–30 s | Timeline, speed control and live-command isolation | Replay of the same recording |
| 30–35 s | Flight metrics and graphs | Analysis of the same recording |

The corrected recording is session `77357acb-9ce1-471e-894b-78142605b762`, captured on 2026-10-15 at 1× simulator speed. [Raw session](../verification/ui-acceptance-session.json), [report](../verification/ui-acceptance-report.json), [CSV](../verification/ui-acceptance-telemetry.csv). Example simulation coordinates are arbitrary and do not identify a user's location.

The separate [automated SITL suite](../verification/sitl-results.json) runs at 4× and includes a sustained altitude assertion during BRAKE, return-to-home and configured low-battery RTL. The earlier LOITER descent finding is retained as [regression evidence](../verification/hold-regression.json).
