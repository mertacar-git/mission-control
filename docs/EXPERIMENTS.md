# Fault experiments and incident investigation (v1.4)

The laboratory turns three fixed hypotheses into replayable observations. A green result requires the expected telemetry, not merely a command or parameter acknowledgement. Public Pages serves checked-in **real SITL evidence**; it does not run a simulator. Select **Senaryo laboratuvarı** and **Olayları incele** to inspect a recording. New experiments require the local backend in **Yerel SITL** mode.

## Reproduce

Install and build the pinned firmware using `simulator/setup.sh`. With no existing simulator or recording open, start the local application and select the laboratory. Each run creates a fresh app-owned Copter-4.6.3 process, uses 4× simulation speed, records the entire experiment, and destroys that process on completion, failure or cancellation. Its isolated EEPROM directory is never reused. Physical endpoints and arbitrary parameters are not accepted.

For unattended acceptance, from `backend`:

```bash
/opt/mission-control/venv/bin/python -m tests.integration_runner
/opt/mission-control/venv/bin/python -m tests.scenario_runner
```

The first command runs the existing seven flight/transfer/boundary scenarios. The second runs three additional experiments and writes evidence into `docs/verification/scenarios` and the identical public replay fixtures in `frontend/public/verification`.

## Hypotheses

| Experiment | Injection and configuration | Required observations |
| --- | --- | --- |
| Telemetry interruption | Pause the owned process on the ground using SIGSTOP; later SIGCONT | stale after the 3 s heartbeat threshold, disconnected after 10 s, new command rejected, fresh telemetry after recovery |
| Low battery | BATT_FS_LOW_ACT=2, BATT_LOW_VOLT=11.5, BATT_CRT_VOLT=10, BATT_LOW_TIMER=2; inject SIM_BATT_VOLTAGE=11 after takeoff | measured voltage below threshold, RTL, subsequent disarm |
| GPS loss | FS_EKF_ACTION=1, FS_DR_ENABLE=0; inject SIM_GPS_DISABLE=1 after takeoff | GPS_RAW_INT fix_type below 3, LAND, subsequent disarm |

These parameter names were checked against the pinned firmware source. GPS loss uses the EKF failsafe, not the archived GPS failsafe. See the official [simulation parameter documentation](https://ardupilot.org/dev/docs/SITL_simulation_parameters.html) and [EKF failsafe documentation](https://ardupilot.org/copter/docs/common-ekf-inav-failsafe.html). The test explicitly disables dead reckoning return so the expected behavior is unambiguous.

**Scope:** pausing the process also freezes its vehicle clock and physics. That experiment validates receiver freshness, command gating and recovery; it is not an RF outage or airborne GCS failsafe experiment. Low battery and GPS experiments observe the autopilot's configured response without sending an application RTL or LAND command. Disarm after an observed airborne state is the landing completion criterion; it is not a separate ground-contact sensor measurement.

## Acceptance report

SQLite persists run identity, UTC start/end, firmware hash, speedup, verified parameter values, recording identity, checks, observed snapshots and failure reason. Each wait has a finite timeout. `latency_s` is the **wall time spent waiting for that individual check**, not total flight time or a universal reaction-time benchmark. Simulation speedup is reported separately. Every successful observation also records its actual snapshot in the recording before its corresponding event, aligning investigation with the acceptance evidence.

Failures are not converted to passes. Cancellation is `interrupted`, with cleanup awaited. An unfinished run after a backend restart is also `interrupted`. There is no automatic force-arm or start retry. A scenario reserves the application control path; manual connect/disconnect, mission transfers, commands and recording changes are rejected while it runs. The owner's lease can still renew, and the owner can explicitly cancel. A second experiment cannot overlap.

REST additions:

- `GET /api/v1/scenarios`: latest 100 persistent acceptance reports.
- `POST /api/v1/scenarios`: `{ "kind": "heartbeat_loss" | "low_battery" | "gps_loss" }`; requires controller header and idle application.
- `POST /api/v1/scenarios/cancel`: owner-only cancellation and awaited process cleanup.

No generic fault-injection or parameter endpoint is exposed.

## Incident investigation

Every replay has a selectable incident list: scenario stages, boundary violation/unknown transitions, stale/disconnected/recovered connections, failed or unobserved commands, and warning-or-higher vehicle messages. Select an event to pause and seek the shared replay clock. The map, telemetry cards, route trace and gold cursor on the full-recording altitude/speed chart follow that clock. The inspector shows the preceding command event and ±10 s event context, not an inferred cause.

UTC event times are aligned to a recorded telemetry sample's connection clock, including recordings that started long after connection. Seeking is clamped to available telemetry. Missing samples beyond 3 s make position, mode, arm state, GPS and battery unknown; chart-only null separators break lines across gaps without adding invented measurements to JSON or CSV. Old recordings without the optional `gps_fix_type` field remain valid; exports leave that cell empty.

Replay never sends a live command or injects a fault. Public experiment controls remain disabled; their evidence can be inspected and downloaded. The application’s fixed simulation origin is not a user location.
