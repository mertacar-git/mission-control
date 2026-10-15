# Mission Control v1.4

- [x] Fixed owned-SITL fault experiments with persistent pass/fail/interrupted reports.
- [x] Telemetry pause/recovery, configured low-battery RTL, GPS-loss EKF LAND; separate measured checks and finite timeouts.
- [x] Owner lease renewal, exclusive control, cancellation and cleanup, interrupted-run recovery.
- [x] Actual recording fixtures available in public Pages; browser execution disabled.
- [x] Incident selection synchronizes replay telemetry, map and chart cursor, with preceding command and ±10 s context.
- [x] Unknown values across gaps, chart separators without invented exports, optional GPS fix field and old recording support.
- [x] 64 frontend and 47 backend tests; TypeScript and production build.
- [x] Seven existing actual SITL acceptance scenarios and three new recorded fault experiments.
- [x] Browser-operated local low-battery experiment passed; explicit cancellation persisted as interrupted and closed owned process/recording.

Definitions, API and limits: [EXPERIMENTS.md](EXPERIMENTS.md). Evidence: [three experiments](verification/scenarios/scenario-runs.json), [UI runs](verification/scenarios/ui-runs.json), [UI recording](verification/scenarios/ui-low-battery.json).

Telemetry interruption pauses physics too; this is not an RF/GCS failsafe validation. Published recordings contain the application's arbitrary simulation origin, not a physical vehicle or user location. All timestamps reflect actual execution.
