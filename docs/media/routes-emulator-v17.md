# v1.7 route and emulator walkthrough

[Watch the 20-second captioned video](https://github.com/mertacar-git/mission-control/raw/refs/heads/main/docs/media/routes-emulator-v17.mp4).

| Time | Actual application view |
| --- | --- |
| 0–5 s | 0°/90° candidate comparison; explicit duration model and independent local backend validation |
| 5–10 s | Actual 1× SITL flight recordings, both plans/tracks and per-leg analysis |
| 10–15 s | A browser-started separate-process UDP emulator recording with CRC/sequence counters |
| 15–20 s | Mobile emulator replay at 390×844 |

The video is a captioned sequence of actual browser screenshots, not a continuous screen recording. The SITL recordings came from the real pinned autopilot. The emulator's sensor values are intentionally synthetic and explicitly labeled as a separate source; its packet reception records came from actual Python subprocesses and loopback UDP. No physical board or sensor was used. There is no voiceover or generated UI mockup.

[Route method and evidence](../ROUTE_EXPERIMENTS.md) · [Computer protocol and prototype handoff](../COMPUTER_EMULATOR.md).
