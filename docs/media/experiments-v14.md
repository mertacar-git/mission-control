# v1.4 captioned walkthrough

[Watch the 20-second video](https://github.com/mertacar-git/mission-control/raw/refs/heads/main/docs/media/experiments-v14.mp4).

| Time | Actual application screen |
| --- | --- |
| 0–5 s | Local laboratory after a browser-operated low-battery experiment passed |
| 5–10 s | Its real SITL recording at the observed RTL event: 11.00 V and 18.2 s from the first sample |
| 10–15 s | Same recording's incident context and preceding command |
| 15–20 s | Mobile 390×844 laboratory layout |

This is a captioned sequence of actual browser screenshots, not a continuous screen recording. No synthetic telemetry, mock screens, voiceover or generated imagery is used. The local UI experiment and its cancellation test are preserved in `docs/verification/scenarios/ui-runs.json`; the successful flight is `ui-low-battery.json`. Runtime speed was 4×; displayed time is backend reception wall time.

Experiment definitions, limits and reproduction: [EXPERIMENTS.md](../EXPERIMENTS.md).
