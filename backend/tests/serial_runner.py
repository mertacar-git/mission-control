"""Generate honest synthetic PTY evidence and a portable HTML replay (Linux)."""
import json
import os
import pty
import threading
import time
from pathlib import Path

from mission_control.serial_bench import capture, report
from mission_control.emulator_protocol import encode


def main():
    directory = Path(__file__).resolve().parents[2]/'docs/verification/serial'
    directory.mkdir(parents=True, exist_ok=True)
    recording = directory/'synthetic-pty.jsonl'
    master, slave = pty.openpty()
    stop = threading.Event()
    def send():
        time.sleep(0.4)
        for i in range(20):
            frame = encode(bytes(range(16)), 1, i, i*200,
                           None, None, None if 7 <= i <= 10 else 20+i/10, None, 12.4)
            if i == 4:
                bad = bytearray(frame);bad[-1] ^= 1;os.write(master, bad)
            os.write(master, b'noise' if i == 0 else b'')
            os.write(master, frame[:17]);time.sleep(0.01);os.write(master, frame[17:])
            if i == 8: os.write(master, frame)
            time.sleep(0.19)
        stop.wait(3.3);stop.set()
    thread = threading.Thread(target=send);thread.start()
    try:
        result = capture(os.ttyname(slave), 115200, recording, 12, stop,
                         experiment='SENTETİK TEST · Linux sanal seri portu; fiziksel kart ve sensör kullanılmadı')
    finally:
        stop.set();thread.join();os.close(master);os.close(slave)
    assert result['counts']['accepted'] == 20
    assert result['counts']['late_or_duplicate'] == 1
    assert result['invalid_candidates'] == 1
    assert result['state'] == 'stale' and result['telemetry'] is None
    (directory/'results.json').write_text(json.dumps(dict(
        source='synthetic Linux PTY through real pyserial; no board or sensor',
        result=result), indent=2)+'\n', encoding='utf-8')
    report(recording, directory/'replay.html')


if __name__ == '__main__':
    main()
