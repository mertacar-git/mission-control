# Hardware handoff — MCT1 serial bench

The PC receiver and portable packet encoder are ready for board integration.
No board SDK, wiring, sensor driver or physical-device acceptance is claimed.
For the integrated **Seri cihaz** screen and isolated Windows service, see
[Windows serial setup](../docs/SERIAL_DEVICE.md). The CLI below remains available.

## Windows PC setup

Run in PowerShell from the repository root. USB is opened on Windows directly;
there is no USB-to-WSL forwarding requirement. This bench is independent of the
WSL SITL backend and its database.

```powershell
py -3.12 -m venv .venv-bench
.venv-bench/Scripts/python.exe -m pip install pyserial==3.5
cd backend
../.venv-bench/Scripts/python.exe -m mission_control.serial_bench --list
../.venv-bench/Scripts/python.exe -m mission_control.serial_bench --port COM5 --baud 115200 --output experiment-001.jsonl --duration 300
../.venv-bench/Scripts/python.exe -m mission_control.serial_bench --replay experiment-001.jsonl --report experiment-001.html
Start-Process experiment-001.html
```

Use the listed device's actual COM port. Output names must be new: captures and
HTML exports never overwrite previous experiments. Ctrl+C preserves the log.
The console prints live telemetry, age, state and counters. The HTML viewer has
pause, seeking and 0.5/1/2× playback and needs no server or internet. A malformed
or truncated last JSONL row is reported rather than silently repaired.

## Board-side contract

- USB CDC or UART adapter, 115200 baud, 8N1, no flow control; 5 Hz recommended.
- Send the 62 binary bytes produced by `mct1::encode` in `mct1_sender.hpp`.
  No newline, JSON, ASCII hex or diagnostic text on the binary channel.
- `sender_example.cpp` is a desktop *synthetic* vector, not a sensor driver.
  Replace acquisition with real measurements and send the binary buffer using
  the board SDK. Encoder returning false means do not transmit that frame.
- Use a stable unique 16-byte device stream ID. Increment a persisted boot ID
  after each reset. Sequence starts at zero and increases during a boot. Source
  time is unsigned 64-bit uptime in milliseconds. Start a new boot before
  sequence overflow; extend a board's 32-bit millisecond clock before encoding.
- Set flags only for measurements actually available. Missing position clears
  bit 0 (both coordinates), altitude bit 1, speed bit 2, voltage bit 3. Unknown
  measurements are null at the receiver, never fabricated zero measurements.
- Altitude is relative to a deliberately established home reference in metres.
  A barometer's raw pressure or sea-level altitude is not this field. Speed is
  ground speed m/s, voltage is volts, coordinates are WGS84 degrees times 1e7.
  An IMU alone cannot supply valid GPS position or ground speed.

The packet layout and CRC remain compatible with
[the computer-emulator protocol](../docs/COMPUTER_EMULATOR.md). C++ encode and
Python decode share a golden-vector test. `mct1.hpp` also supplies a decoder.

## Receiver behaviour

Magic search plus full CRC and semantic validation restores framing after
noise, dropped bytes and partial reads. Internal framing storage stays under
62 bytes. Corrupt candidates advance one byte rather than discarding a whole
packet-sized region. The first valid stream locks identity for that capture;
other streams cannot replace its latest value. Late/duplicate sequence numbers,
older boots and backwards source clocks cannot replace it either.

Reconnect retries the same named port at one-second intervals after an open
failure. A disconnected link immediately clears the displayed current value;
an idle link's last sample becomes unknown after three seconds. A partial frame
is discarded at every reconnect. Re-enumeration under a different COM name
requires a new capture with that port. Boot counters must remain monotonic;
after erasing board persistence start a new capture. Gap count is the number of
sequence slots skipped by accepted frames, not a definitive lost-packet count.

Raw received chunks, timestamps, connection transitions and decoded outcomes
are stored in a separate versioned JSONL format. Replay recomputes outcomes
from raw chunks. It cannot send flight or serial commands. This bench does not
open SITL storage and is not imported as a flight recording in Mission Control.
Use the serial device page or standalone viewer for these recordings. The public Pages demo
cannot access a local Python serial port.

Port open may toggle DTR/RTS and reset some boards; document observed board
behaviour. CRC detects transmission errors, not authenticity. Opening a port
is operator-selected; the software never scans by sending probes or writes
actuator commands.

## Physical acceptance checklist (pending hardware)

Record board model, firmware revision, sensor model, USB adapter, baud rate and
the expected units/reference before testing. Keep a written experiment note
alongside each raw capture.

1. Compare real sensor readings against a known reference and document error.
2. Disconnect/reconnect USB; verify immediate unknown state on detected detach,
   same-port recovery and no promoted duplicate packet.
3. Reset board; verify incremented boot and reset source clock/sequence accepted.
4. Disconnect sensor; verify its validity flag clears and the display is blank.
5. Inject a bad CRC with a test transmitter; verify recovery at the next valid
   frame. Do not label the synthetic test transmitter as sensor evidence.
6. Stop capture; replay raw bytes and compare accepted counters and null fields.

Software tests include a real Linux pseudo-terminal through pyserial, fake
disconnect/reopen transport, fragmented frames, noise/CRC recovery, identity,
boot and ordering rules, freshness gaps, replay and the C++ golden encoder.
These establish software transport behaviour, not physical sensor accuracy.
