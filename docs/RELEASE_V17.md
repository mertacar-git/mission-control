# Mission Control v1.7 — three planned increments

## v1.5 route comparison

- Cancellable Web Worker; 12 fixed headings plus the selected heading.
- Route/survey/connector distances, deflection angles, turns and explicit duration model.
- Shared-plane A/B overlay; every local candidate independently checked by the backend.
- Explicit preview/apply and one-step undo; changed inputs invalidate old results.
- Additive generation metadata in mission schema 2; old missions/recordings retained.

## v1.6 actual execution comparison

- Frozen mission and task-index attribution, not nearest parallel line.
- Per-leg observed time/deviation/speed, reached-event turn windows and bounded-gap corridor union.
- Two actual 1× Copter-4.6.3 flights of the same area at 0° and 90°.
- Both plans and both measured tracks; recording selectors; JSON/CSV export.
- Missing measurements and changed generation metadata yield unknown/unclassified results.

## Computer-emulator prototype preparation

- Separate owned Python sender process on loopback UDP 14600, isolated from MAVLink.
- Versioned 62-byte CRC protocol; sensor validity, boot/sequence IDs and distinct source/receive clocks.
- Nominal, loss, corruption, repeat/reorder, mixed, sensor-gap and actual sender-restart profiles.
- Independent SQLite raw recordings and live/replay UI; owner-only cancellation and bounded process lifetime.
- Allocation-free C++17 decoder, golden packet and Python/C++ compatibility tests.
- Protocol, reproduction and physical-prototype handoff documents; board/wiring validation remains a later physical task.

## Evidence

- 69 frontend tests and 58 backend tests; TypeScript and production build.
- [Twelve candidate fixtures](verification/comparison/candidates.json), independently checked by Python.
- [Two actual SITL flights](verification/comparison/sitl-results.json), raw recordings and independent execution reports in the same directory.
- [Five real process/UDP checks](verification/emulator/results.json), including process restart and cancellation; raw recordings in the same directory.
- Existing seven SITL scenarios and three fault experiments retained in GitHub acceptance.

Definitions and limitations: [route experiments](ROUTE_EXPERIMENTS.md), [computer emulator](COMPUTER_EMULATOR.md). Duration estimates exclude climb/descent/acceleration/wind. Observed corridor length is not camera coverage. The emulator is a synthetic software source, not an autopilot or tested physical flight computer.
