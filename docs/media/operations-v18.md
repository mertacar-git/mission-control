# Mission Control v1.8 walkthrough

[Watch the captioned video](https://github.com/mertacar-git/mission-control/raw/refs/heads/main/docs/media/operations-v18.mp4).

| Time | Actual application view |
|---|---|
| 0–6 s | Immutable experiment definition and independently preserved SITL run |
| 6–12 s | Two actual concave-mission recordings, measured completion/duration/deviation and shared tracks |
| 12–18 s | Native Windows receiver's independently replayed synthetic MCT1 capture, CRC/sequence counters |
| 18–24 s | 390×844 mobile replay of a real SITL recording with flight commands disabled |

This is a captioned sequence of actual application screenshots, rather than a
continuous screen recording. No UI mockups or voiceover are generated. Full
isolated browser-test recordings are also retained in the acceptance bundle.
SITL measurements came from pinned Copter-4.6.3. The Windows packet source was
explicitly synthetic: no physical USB board, sensor or aircraft was validated.
Flight durations use the backend's wall clock; the shown paired experiment runs
used 4× simulation speed and are not interchangeable with real-time flights.

Regenerate on Linux with FFmpeg/DejaVu Sans using
`python docs/media/render-v18.py`. Input screenshots are checked in beside this
document. [Acceptance procedure](../ACCEPTANCE.md),
[experiment contract](../VERSIONED_EXPERIMENTS.md).
