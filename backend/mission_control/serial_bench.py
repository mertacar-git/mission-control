"""Read-only MCT1 serial bench. No flight commands or SITL store access.

Run on the computer hosting the USB device (Windows supported):
python -m mission_control.serial_bench --port COM5 --output bench.jsonl
"""

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from .emulator_protocol import SIZE, decode
from . import sensor_protocol


class StreamDecoder:
    """Bounded stream framing: search magic, CRC-check, advance one byte on failure."""

    def __init__(self):
        self.buffer = bytearray()
        self.discarded_bytes = 0
        self.invalid_candidates = 0

    def feed(self, chunk):
        frames = []
        # Process incrementally so even arbitrarily large input cannot grow the buffer.
        for byte in chunk:
            self.buffer.append(byte)
            while len(self.buffer) >= 4:
                if self.buffer[:4] not in (b"MCT1", b"MCS1"):
                    del self.buffer[0]
                    self.discarded_bytes += 1
                    continue
                sensor = self.buffer[:4] == b"MCS1"
                size = sensor_protocol.SIZE if sensor else SIZE
                if len(self.buffer) < size:
                    break
                packet = bytes(self.buffer[:size])
                try:
                    frame = sensor_protocol.decode(packet) if sensor else decode(packet)
                except ValueError:
                    self.invalid_candidates += 1
                    self.discarded_bytes += 1
                    del self.buffer[0]
                    continue
                del self.buffer[:size]
                frame["source"] = "serial"
                frames.append((packet, frame))
        return frames


class Tracker:
    """Promote strictly increasing sequence numbers within a non-decreasing boot ID."""

    def __init__(self):
        self.stream = None
        self.boot = None
        self.sequence = -1
        self.source_ms = -1
        self.latest = None
        self.received_at = None
        self.counts = dict(
            accepted=0,
            late_or_duplicate=0,
            foreign=0,
            clock_regression=0,
            sequence_gaps=0,
        )

    def accept(self, frame, elapsed):
        if self.stream is not None and frame["stream_id"] != self.stream:
            result = "foreign"
        elif self.boot is not None and (
            frame["boot_id"] < self.boot
            or (frame["boot_id"] == self.boot and frame["sequence"] <= self.sequence)
        ):
            result = "late_or_duplicate"
        elif self.boot == frame["boot_id"] and frame["source_time_ms"] < self.source_ms:
            result = "clock_regression"
        else:
            result = "accepted"
            if self.boot == frame["boot_id"]:
                self.counts["sequence_gaps"] += max(
                    0, frame["sequence"] - self.sequence - 1
                )
            self.stream, self.boot = frame["stream_id"], frame["boot_id"]
            self.sequence, self.source_ms = frame["sequence"], frame["source_time_ms"]
            self.latest, self.received_at = frame, elapsed
        self.counts[result] += 1
        return result

    def snapshot(self, elapsed):
        age = None if self.received_at is None else elapsed - self.received_at
        return dict(
            state="unknown" if age is None else "fresh" if age <= 3 else "stale",
            age_s=age,
            telemetry=self.latest if age is not None and age <= 3 else None,
            counts=dict(self.counts),
        )


def replay(path, timeline=None):
    """Re-run the decoder on raw received bytes; recorded classifications are not trusted."""
    decoder, tracker = StreamDecoder(), Tracker()
    elapsed = 0.0
    with open(path, encoding="utf-8") as source:
        first = json.loads(next(source))
        if first.get("format") != "mission-control-serial" or first.get("version") != 1:
            raise ValueError("Unsupported serial recording")
        for line in source:
            row = json.loads(line)
            value = row["elapsed_s"]
            if not isinstance(value, (float, int)) or not elapsed <= value < float(
                "inf"
            ):
                raise ValueError("Invalid recording clock")
            elapsed = value
            if row["kind"] == "bytes":
                for _, frame in decoder.feed(bytes.fromhex(row["hex"])):
                    tracker.accept(frame, elapsed)
            elif row["kind"] in ("connected", "disconnected"):
                decoder.buffer.clear()
                tracker.received_at = None
            if timeline is not None and row["kind"] != "frame":
                timeline.append(dict(elapsed_s=elapsed, **tracker.snapshot(elapsed)))
    return dict(
        **tracker.snapshot(elapsed),
        experiment=first.get("experiment", "Device origin not verified"),
        discarded_bytes=decoder.discarded_bytes,
        invalid_candidates=decoder.invalid_candidates,
        duration_s=elapsed,
    )


def report(path, destination):
    """Standalone offline viewer; no commands, network dependencies or server."""
    timeline = []
    summary = replay(path, timeline)
    data = json.dumps(
        dict(summary=summary, timeline=timeline), allow_nan=False
    ).replace("<", "\\u003c")
    template = (
        Path(__file__).with_name("serial_report.html").read_text(encoding="utf-8")
    )
    with open(destination, "x", encoding="utf-8") as output:
        output.write(template.replace("/*RECORDING*/null", data))


def capture(
    port,
    baud,
    output,
    duration,
    stop=None,
    serial_factory=None,
    clock=time.monotonic,
    experiment="Device origin not verified",
    on_update=None,
    quiet=False,
):
    if serial_factory is None:
        import serial

        serial_factory = serial.Serial
    decoder, tracker = StreamDecoder(), Tracker()
    started = clock()
    connection = None
    connection_state = "connecting"

    def publish():
        value = dict(
            **tracker.snapshot(clock() - started),
            connection=connection_state,
            discarded_bytes=decoder.discarded_bytes,
            invalid_candidates=decoder.invalid_candidates,
        )
        if on_update:
            on_update(value)
        if not quiet:
            print(json.dumps(value, allow_nan=False), flush=True)

    # Exclusive creation prevents accidental overwrite of previous experiments.
    with open(output, "x", encoding="utf-8", buffering=1) as destination:

        def event(kind, **fields):
            destination.write(
                json.dumps(
                    dict(kind=kind, elapsed_s=clock() - started, **fields),
                    allow_nan=False,
                )
                + "\n"
            )

        destination.write(
            json.dumps(
                dict(
                    format="mission-control-serial",
                    version=1,
                    source="serial",
                    port=port,
                    baud=baud,
                    experiment=experiment,
                    started_at=datetime.now(timezone.utc).isoformat(),
                )
            )
            + "\n"
        )
        try:
            while clock() - started < duration and not (stop and stop.is_set()):
                if connection is None:
                    try:
                        connection = serial_factory(
                            port=port, baudrate=baud, timeout=0.2, write_timeout=0.2
                        )
                        decoder.buffer.clear()
                        tracker.received_at = None
                        event("connected")
                        connection_state = "connected"
                        publish()
                    except OSError as error:
                        event("disconnected", error=str(error))
                        connection_state = "disconnected"
                        tracker.received_at = None
                        publish()
                        if stop:
                            stop.wait(1)
                        else:
                            time.sleep(1)
                        continue
                try:
                    chunk = connection.read(256)
                    if chunk:
                        event("bytes", hex=chunk.hex())
                        for packet, frame in decoder.feed(chunk):
                            result = tracker.accept(frame, clock() - started)
                            event(
                                "frame",
                                classification=result,
                                packet_hex=packet.hex(),
                                telemetry=frame,
                            )
                    publish()
                except OSError as error:
                    event("disconnected", error=str(error))
                    connection.close()
                    connection = None
                    decoder.buffer.clear()
                    tracker.received_at = None
                    connection_state = "disconnected"
                    publish()
        finally:
            if connection is not None:
                connection.close()
            event(
                "stopped",
                counts=tracker.counts,
                discarded_bytes=decoder.discarded_bytes,
                invalid_candidates=decoder.invalid_candidates,
            )
            connection_state = "closed"
            tracker.received_at = None
            publish()
    return replay(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true", help="List local serial ports")
    parser.add_argument("--port")
    parser.add_argument(
        "--baud", type=int, choices=(9600, 57600, 115200, 230400), default=115200
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--duration", type=int, default=300)
    parser.add_argument(
        "--experiment",
        default="Device origin not verified",
        help="Describe board/sensor or synthetic transmitter",
    )
    parser.add_argument("--replay", type=Path)
    parser.add_argument(
        "--report", type=Path, help="With --replay: create standalone HTML viewer"
    )
    args = parser.parse_args()
    if args.list:
        from serial.tools.list_ports import comports

        print(
            json.dumps(
                [
                    dict(
                        port=p.device,
                        description=p.description,
                        serial_number=p.serial_number,
                    )
                    for p in comports()
                ],
                indent=2,
            )
        )
    elif args.replay:
        print(json.dumps(replay(args.replay), indent=2))
        if args.report:
            report(args.replay, args.report)
    elif args.port and args.output and 1 <= args.duration <= 86400:
        try:
            capture(
                args.port,
                args.baud,
                args.output,
                args.duration,
                experiment=args.experiment,
            )
        except KeyboardInterrupt:
            print("Capture stopped. Recording retained; use --replay to inspect.")
    else:
        parser.error(
            "Use --list, --replay FILE, or --port PORT --output FILE --duration 1..86400"
        )


if __name__ == "__main__":
    main()
