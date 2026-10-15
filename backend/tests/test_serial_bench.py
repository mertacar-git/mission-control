import json
import os
import select
import threading
import time
import shutil
import subprocess
from pathlib import Path

import pytest

from mission_control.emulator_protocol import encode
from mission_control.serial_bench import StreamDecoder, Tracker, capture, replay, report


def packet(seq=0, boot=0, stream=bytes(range(16)), source_ms=None):
    return encode(stream, boot, seq, seq*200 if source_ms is None else source_ms,
                  41.0082, 28.9784, 20, 5, 12)


def test_fragmentation_noise_crc_and_bounded_storage():
    decoder = StreamDecoder()
    corrupted = bytearray(packet()); corrupted[50] ^= 1
    data = b'garbageMCT' + corrupted + packet(1) + packet(2)
    frames = []
    for value in data:
        frames.extend(decoder.feed(bytes([value])))
        assert len(decoder.buffer) < 62
    assert [f['sequence'] for _, f in frames] == [1, 2]
    assert decoder.invalid_candidates >= 1
    assert decoder.feed(b'x'*100000) == []
    assert len(decoder.buffer) <= 3


def test_identity_boot_order_missing_values_and_freshness():
    from mission_control.emulator_protocol import decode
    tracker = Tracker()
    def accept(data, elapsed=0):
        return tracker.accept(decode(data), elapsed)
    assert accept(packet()) == 'accepted'
    assert accept(packet()) == 'late_or_duplicate'
    assert accept(packet(2)) == 'accepted'
    assert accept(packet(3, source_ms=0)) == 'clock_regression'
    assert accept(packet(4, stream=b'x'*16)) == 'foreign'
    assert accept(packet(0, boot=1), 2) == 'accepted'
    assert accept(packet(5, boot=0)) == 'late_or_duplicate'
    assert tracker.counts['sequence_gaps'] == 1
    assert tracker.snapshot(5)['state'] == 'fresh'
    assert tracker.snapshot(5.01)['telemetry'] is None
    missing = encode(bytes(range(16)), 1, 1, 1, None, None, None, None, None)
    assert accept(missing, 6) == 'accepted'
    assert tracker.snapshot(6)['telemetry']['latitude'] is None


def test_capture_reconnect_raw_replay_and_exclusive_file(tmp_path, capsys):
    destination = tmp_path/'capture.jsonl'
    stop = threading.Event()
    class Port:
        def __init__(self, chunks): self.chunks = iter(chunks)
        def read(self, size):
            chunk = next(self.chunks)
            if isinstance(chunk, Exception): raise chunk
            if chunk == b'': stop.set()
            return chunk
        def close(self): pass
    ports = iter([Port([packet()[:30], OSError('unplugged')]),
                  Port([packet(), packet(1), b''])])
    result = capture('fake', 115200, destination, 10, stop, lambda **kwargs: next(ports))
    assert result['counts']['accepted'] == 2
    assert result['counts'] == replay(destination)['counts']
    assert result['telemetry']['source'] == 'serial'
    rows = [json.loads(line) for line in destination.read_text().splitlines()]
    assert sum(row.get('kind') == 'connected' for row in rows) == 2
    assert any(row.get('kind') == 'disconnected' for row in rows)
    viewer = tmp_path/'viewer.html'
    report(destination, viewer)
    assert '/*RECORDING*/null' not in viewer.read_text(encoding='utf-8')
    assert '"accepted": 2' in viewer.read_text(encoding='utf-8')
    with pytest.raises(FileExistsError):
        capture('fake', 115200, destination, 1, stop)


def test_replay_rejects_invalid_time_and_preserves_gap(tmp_path):
    recording = tmp_path/'record.jsonl'
    header = dict(format='mission-control-serial', version=1)
    rows = [header, dict(kind='bytes', elapsed_s=0, hex=packet().hex()),
            dict(kind='stopped', elapsed_s=5)]
    recording.write_text('\n'.join(json.dumps(r) for r in rows))
    assert replay(recording)['telemetry'] is None
    rows[-1]['elapsed_s'] = -1
    recording.write_text('\n'.join(json.dumps(r) for r in rows))
    with pytest.raises(ValueError, match='clock'):
        replay(recording)


@pytest.mark.skipif(os.name != 'posix', reason='Linux PTY integration; Windows uses fake reconnect test')
def test_real_pyserial_pseudo_terminal(tmp_path, capsys):
    import pty
    master, slave = pty.openpty()
    path = os.ttyname(slave)
    stop = threading.Event()
    def sender():
        time.sleep(0.3)
        os.write(master, b'noise'+packet()[:13])
        time.sleep(0.05)
        os.write(master, packet()[13:]+packet(1))
        stop.wait(0.5)
        stop.set()
    thread = threading.Thread(target=sender)
    thread.start()
    try:
        result = capture(path, 115200, tmp_path/'pty.jsonl', 3, stop)
        assert result['counts']['accepted'] == 2
    finally:
        stop.set(); thread.join(); os.close(master); os.close(slave)


@pytest.mark.skipif(not shutil.which('g++'), reason='C++ compiler unavailable')
def test_cpp_sender_matches_python_golden_packet(tmp_path):
    root = Path(__file__).resolve().parents[2]
    executable = tmp_path/'sender'
    subprocess.run(['g++', '-std=c++17', '-Wall', '-Wextra', '-Werror',
                    str(root/'prototype/sender_example.cpp'), '-o', str(executable)], check=True)
    actual = subprocess.check_output([str(executable)], text=True).strip()
    assert actual == encode(bytes(range(16)), 2, 17, 3400, 41.0082, 28.9784, 20.25, 5.5, 12.6).hex()
