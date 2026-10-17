import json
import shutil
import subprocess
import os
import threading
import time
from pathlib import Path
import pytest
from mission_control.sensor_protocol import encode, decode, SIZE
from mission_control.serial_bench import StreamDecoder, replay, capture
from mission_control.serial_service import SerialMeasurement
from mission_control.sensor_sample import write_sample

ROOT = Path(__file__).resolve().parents[2]


def test_shared_vector_and_serial_response_contract():
    fixture = json.loads((ROOT/'prototype/sensor-vector.json').read_text())
    packet = bytes.fromhex(fixture['packet_hex'])
    assert len(packet) == SIZE == 82
    frame = decode(packet)
    assert frame == fixture['decoded']
    assert SerialMeasurement(**frame).model_dump() == dict(frame, source_time_ms=str(frame['source_time_ms']))
    decoder = StreamDecoder()
    frames = []
    for byte in b'noise' + packet:
        frames.extend(decoder.feed(bytes([byte])))
        assert len(decoder.buffer) < SIZE
    assert frames[0][1] == frame
    corrupt = bytearray(packet); corrupt[50] ^= 1
    assert len(decoder.feed(corrupt + packet)) == 1
    assert decoder.invalid_candidates == 1


def test_missing_sensor_groups_and_rejection():
    packet = encode(bytes(16), 1, 0, 0, 256, [None]*6 + [None, 101325, None])
    frame = decode(packet)
    assert frame['acceleration_z_ms2'] is None
    assert frame['pressure_pa'] == 101325
    assert frame['latitude'] is None
    with pytest.raises(ValueError, match='partial_imu'):
        encode(bytes(16), 1, 0, 0, 256, [1, None, 1, 1, 1, 1, 20, 100000, 50])
    for value in (float('nan'), float('inf'), -1, 101):
        with pytest.raises(ValueError):
            encode(bytes(16), 1, 0, 0, 256, [None]*6 + [20, 100000, value])


def test_sample_raw_replay_gap_crc_and_staleness(tmp_path):
    output = tmp_path/'sample.jsonl'
    write_sample(output)
    timeline = []
    summary = replay(output, timeline)
    assert summary['counts']['accepted'] == 99
    assert summary['invalid_candidates'] == 1
    assert summary['counts']['sequence_gaps'] == 1
    assert summary['telemetry'] is None
    assert summary['state'] == 'stale'
    assert timeline[36]['telemetry']['acceleration_x_ms2'] is None
    assert timeline[36]['telemetry']['temperature_c'] == 23.5


def test_cpp_sender_matches_python_vector(tmp_path):
    compiler = shutil.which('g++')
    if not compiler:
        pytest.skip('C++ cross-language check requires g++ (mandatory in Ubuntu CI)')
    fixture = json.loads((ROOT/'prototype/sensor-vector.json').read_text())
    source = tmp_path/'verify.cpp'
    source.write_text('''#include "mcs1.hpp"
#include <cstdio>
int main(){mcs1::Frame f;for(unsigned i=0;i<16;++i)f.stream[i]=i;
f.boot=2;f.sequence=17;f.source_ms=9007199254740993ULL;f.flags=15;
float v[9]={1,-2,9.75,0.1f,-0.2f,0.3f,23.5f,101325,45};
for(unsigned i=0;i<9;++i)f.values[i]=v[i];
std::uint8_t p[mcs1::packet_size];if(!mcs1::encode(f,p))return 1;
for(auto b:p){std::printf("%02x",b);}return 0;}''')
    executable = tmp_path/'verify'
    subprocess.run([compiler,'-std=c++17','-Wall','-Wextra','-Werror','-I',str(ROOT/'prototype/esp32/include'),str(source),'-o',str(executable)],check=True)
    assert subprocess.check_output([str(executable)],text=True) == fixture['packet_hex']


@pytest.mark.skipif(os.name == 'nt', reason='Real PTY transport requires Linux')
def test_sensor_packet_through_actual_serial_transport(tmp_path):
    import pty
    master, slave = pty.openpty()
    path = os.ttyname(slave)
    packet = encode(bytes(16), 1, 0, 0, 256, [0, 0, 9.8, 0, 0, 0, 23, 101325, 45])
    def send():
        time.sleep(0.1)
        os.write(master, packet[:19])
        time.sleep(0.05)
        os.write(master, packet[19:])
    sender = threading.Thread(target=send)
    sender.start()
    destination = tmp_path/'sensor-pty.jsonl'
    try:
        result = capture(path, 115200, destination, 0.5, quiet=True)
        assert result['counts']['accepted'] == 1
        assert replay(destination)['counts'] == result['counts']
        raw = destination.read_text()
        assert 'pressure_pa' in raw
    finally:
        sender.join(timeout=2)
        os.close(master)
        os.close(slave)
