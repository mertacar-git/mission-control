# Windows serial receiver and application integration

The **Seri cihaz** page is independent of SITL and flight recordings. It talks
directly from the Windows browser to a read-only Windows service bound to
`127.0.0.1:8767`; SITL/FastAPI remain in WSL on port 8000. No USB forwarding,
MAVLink hardware endpoint or serial write/actuator command is provided.

## Start

From the repository root in PowerShell:

```powershell
./simulator/run-serial.ps1 -Synthetic
```

This creates `.venv-serial`, installs `backend/requirements-serial.txt`, then
starts an explicitly labelled software byte source. It opens no physical or OS
serial port. For the real serial receiver, omit `-Synthetic`. Python 3.12 is
required. If script execution is unavailable, use the equivalent manual steps:

```powershell
py -3.12 -m venv .venv-serial
.venv-serial/Scripts/python.exe -m pip install -r backend/requirements-serial.txt
cd backend
../.venv-serial/Scripts/python.exe -m mission_control.serial_service --synthetic
```

Open the local application at `http://127.0.0.1:8000/`, select **Seri cihaz**,
paste only the receiver token printed in its terminal and click **Alıcıya
bağlan**. The token is regenerated on service restart, stays in UI memory and
is not saved in recordings or browser storage. It must be re-entered after page
reload. Do not copy the token to public issue reports.

Choose a listed port, baud, experiment note and capture duration. Start both
reading and recording with **Okumayı ve kaydı başlat**. Capture ends on explicit
stop or the configured duration (1–3600 s for real ports; 1–60 s for software
tests). Leaving the page does not stop the independent receiver. One reader and
one controller lease are allowed; another valid controller cannot be displaced.
An expired lease can be claimed explicitly without reopening the device.

Opening a real port can toggle DTR/RTS and reset some boards. The receiver never
probes by transmitting bytes. A renamed COM device requires selecting its new
port for a new capture. Physical board/sensor acceptance is still pending; see
the [board contract](../prototype/README.md).

## Replay and data integrity

Captures are exclusive UUID-named JSONL files under `.runtime/serial`, with
atomic metadata sidecars. Interrupted service runs are marked interrupted at
next service startup. Raw bytes are never silently repaired. Stop capture before
opening its frozen recording from the serial archive. Truncated/corrupt JSONL
structure produces an explicit error.

The browser independently redecodes raw MCT1 chunks, validates CRC and fields,
locks stream identity, excludes duplicate/late/old-boot/backwards-clock frames
from the current value, and handles 0.5/1/2x replay and seeking. Missing sensors
remain null. Measurements older than 3 s are not shown as current. Live stop or
disconnect clears current values; historical replay is explicitly labelled.
Timeline counters cover the entire recording, not just the selected instant.
Sequence-gap counts are skipped sequence slots, not proof of total packet loss.

The uint64 source clock is preserved as a decimal string if it exceeds
JavaScript's safe integer range. It is not synchronized with receive time and
cannot establish one-way latency. JSONL retains the existing version-1 format.
The viewer limits are 64 MB and 200,000 lines; larger files remain on disk for
offline tools. Serial records cannot be imported as flight records or command
sources. Public Pages enables only the synthetic archived example.

## Local API

All HTTP requests require `Authorization: Bearer TOKEN`. Writes additionally
use `X-Control-Session`. Browser origins are restricted to localhost/127.0.0.1
on ports 8000 and 5173; public Pages and other origins are rejected. Host checks
also restrict the service to localhost/127.0.0.1.

- `GET /api/v1/serial/ports`, `/status`, `/recordings`, `/recordings/{uuid}`.
- `POST /api/v1/serial/control/claim`, `/control/renew`.
- `POST /api/v1/serial/connection`: listed `port`, allowed `baud`, `experiment`,
  bounded integer `duration_s`; optional `test_profile` only in synthetic mode.
- `DELETE /api/v1/serial/connection`: owner-only stop.
- `/ws/serial`: allowed Origin, then an authenticated first message containing
  token and controller session; bounded messages and read-only snapshots. No
  credential is placed in the URL.

The software source offers seeded nominal, mixed CRC/order/duplicate and sensor
gap profiles (seed 42). Test duration defines the generated frame count at 5 Hz;
the sensor-gap interval falls in its middle third. This is a software source,
not a board reset, sensor driver or USB-serial-driver test.

## Verification

Evidence is under `docs/verification/phases/phase-4`. Clean native Windows
installation ran without pymavlink or Shapely. Native UI acceptance covers
authenticated connection, live mixed packets, null sensor fields during a gap,
explicit stop clearing telemetry and archive replay. Linux tests additionally
exercise the HTTP receiver through real pyserial on an OS pseudo-terminal.
Python/TypeScript replay counters match both the PTY and Windows captures; shared
C++/Python golden packets and full uint64-clock vectors are checked in the
browser decoder. Physical USB and sensor accuracy have not been tested.
