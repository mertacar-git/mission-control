# Serial bench acceptance

`synthetic-pty.jsonl` was captured through real pyserial from a Linux OS
pseudo-terminal using `python -m tests.serial_runner` on 2026-10-16 (Istanbul).
No physical sensor, board, USB cable or USB driver was tested.

The sender deliberately split every frame, prefixed noise, inserted one corrupt
CRC candidate, repeated one frame and cleared altitude validity for four frames.
Position and speed were unavailable throughout. It then stopped transmitting
long enough to expire the last sample. `results.json` is recomputed from raw
bytes: 20 accepted, 1 duplicate, 1 invalid candidate, 67 discarded bytes and
unknown final telemetry after >3 seconds. Source clock is not receive time.

`replay.html` is a standalone report generated from that exact recording. Its
copy in `frontend/public/serial-bench/index.html` is deployed by Pages. The test
runner refuses to overwrite outputs; choose a new output directory for a new
experiment rather than silently replacing evidence.

Validation: all 64 backend tests passed on Ubuntu, including six serial tests
and C++17 sender/Python golden-vector equivalence. On Windows the four portable
serial tests passed; Linux PTY and C++ compiler tests were skipped there. The
Windows port-list CLI ran; no listed Bluetooth port was opened.

Browser acceptance checks: seek to a valid synthetic sample, null position and
speed remain blank; seek to sensor-gap window, altitude becomes blank; seek to
end, all old telemetry clears. Play/pause and speed controls checked separately.

For board contract, setup and pending physical acceptance see
[prototype/README.md](../../../prototype/README.md). pyserial read timeout and
port/DTR behaviour follow its [official API documentation](https://pyserial.readthedocs.io/en/latest/pyserial_api.html).
