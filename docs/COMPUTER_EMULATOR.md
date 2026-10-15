# Computer emulator and prototype contract

This is a **software telemetry prototype**, not an autopilot, a physical flight computer, or a hardware-in-the-loop validation. A separate Python subprocess emits synthetic position, relative altitude, ground speed and battery voltage. The FastAPI process receives packets on fixed loopback UDP **14600**. It never feeds this data into the MAVLink manager or its flight recordings. No actuator/control channel exists.

## Run and inspect

In a local application, open **Bilgisayar emülatörü**, select a profile/seed/duration and start. The bounded duration is 5–60 seconds at 5 Hz. A new stream UUID is created per experiment. Public Pages can inspect actual checked-in software-emulator recordings; execution is disabled.

Profiles:

| Profile | Behavior |
| --- | --- |
| nominal | All planned datagrams |
| loss | Seeded packet drops |
| corruption | Selected payload bit changes without updating the CRC |
| reorder | Selected 350 ms deferrals and repeated datagrams |
| mixed | Seeded drops/corruption/delay plus repeated datagrams |
| sensor_gap | Position and altitude validity bits clear for the middle third |
| restart | Stop the first owned sender and launch a second process with boot ID 1, sequence/time reset |

The synthetic position follows a 15 m circle at 5 m/s; altitude varies sinusoidally and voltage declines slowly. These are generated sensor values, not physics or aircraft-performance measurements. The seed repeats the **fault schedule** for the same software/version/settings; OS scheduling and packet reception timestamps are actual observations and are not promised to repeat exactly.

## MCT1 v1 wire format

Packets are exactly **62 bytes**, little endian. Float fields are IEEE-754 binary32; coordinate fields are signed int32 degrees ×10⁷. CRC is CRC-32/ISO-HDLC, matching Python `zlib.crc32`, over bytes 0–57; the uint32 result is stored at 58–61.

| Byte offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | ASCII `MCT1` magic |
| 4 | 1 | Version, exactly 1 |
| 5 | 1 | Validity bits: 0 position, 1 altitude, 2 speed, 3 voltage; upper bits reserved zero |
| 6 | 16 | Stream UUID bytes |
| 22 | 4 | Boot ID, uint32 |
| 26 | 4 | Sequence, uint32 |
| 30 | 8 | Source uptime milliseconds, uint64 |
| 38 | 4 | Latitude ×10⁷, int32 |
| 42 | 4 | Longitude ×10⁷, int32 |
| 46 | 4 | Relative altitude metres, float32 |
| 50 | 4 | Ground speed m/s, float32 |
| 54 | 4 | Battery volts, float32 |
| 58 | 4 | CRC uint32 |

With a validity bit clear, the wire placeholder is ignored and the decoded value is null. NaN/infinite or out-of-range **valid** measurements are rejected. A bad length, magic/version, reserved bit or CRC rejects the whole packet. Finite binary32 values naturally have float rounding; the receiver does not invent additional precision.

CRC detects accidental corruption; it is not authentication. The loopback-only receiver also checks the experiment's stream ID before accepting data. This prototype has no remote-network exposure or security claim for hostile senders.

## Receiver and recording semantics

The receiver tracks `(boot_id, sequence)` pairs. Duplicate packets and late/out-of-order packets are recorded and counted, but cannot replace the latest current sample. Packets from an older boot cannot roll the receiver back after a restart. The missing-sequence counter is provisional during the experiment; after a normally completed sender run it uses the known planned count minus unique valid packets. It includes intentionally dropped and CRC-rejected packets. Accepted-current and out-of-order counts are separate; their sum is the unique valid count.

Source uptime and backend receive elapsed time are stored separately. They are **not synchronized**, so no one-way network latency is computed. After 3 s without a current accepted packet, live/replay values are unknown. Sensor validity bits can make individual fields unknown even while packets are current. The chart displays observed points without connecting missing measurements.

SQLite stores each experiment, raw datagram hex, byte count, reception time, receiver decision, decoded frame, counters and completion/failure reason in an independent table. Replay has its own time/speed/playback controls and cannot start or stop a sender. Counters shown in replay describe the final full experiment; the packet list is filtered to the selected instant. JSON export retains the raw evidence. Interrupted experiments remain interrupted after a backend restart.

API:

- `GET /api/v1/emulator`: current owned experiment and derived live freshness.
- `POST /api/v1/emulator`: fixed profile, bounded seed/duration; requires session header.
- `POST /api/v1/emulator/stop`: only the starting session may cancel; awaits sender cleanup.
- `GET /api/v1/emulator/runs` and `/runs/{id}`: stored summaries and raw recording.

Emulator ownership is independent from the SITL control lease. No caller-selected executable, host, port or raw command is accepted.

## Prototype handoff

[`prototype/mct1.hpp`](../prototype/mct1.hpp) is an allocation-free C++17 decoder with byte-wise little-endian reads, CRC checking and validity/range checks. [`prototype/verify.cpp`](../prototype/verify.cpp) is a desktop test harness, and [`golden-vectors.json`](../prototype/golden-vectors.json) supplies a common packet/reference value set. Python tests compile and compare the C++ decoder when a compiler is available; local validation ran it with `-Wall -Wextra -Werror`.

Reproduce software subprocess/UDP/restart/cancellation acceptance from `backend`:

```bash
/opt/mission-control/venv/bin/python -m tests.emulator_runner
```

Actual runs are in [`verification/emulator`](verification/emulator/results.json). They are software process/network tests, not real sensor or MCU measurements.

The next physical prototype needs a selected board, sensor/voltage-level decisions and transport adapter. The decoder can be reused, but UART would additionally need stream framing/resynchronization because the current receiver relies on UDP datagram boundaries. Board firmware, wiring, power design and hardware timing remain unvalidated until a physical build is selected and tested. No purchase or board-specific installation is assumed by this delivery.
