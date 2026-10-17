"""Generate explicitly synthetic MCS1 evidence; no serial port or hardware claim."""
import argparse
import json
import math
from pathlib import Path
from .sensor_protocol import encode


def write_sample(destination):
    rows = [dict(format='mission-control-serial', version=1, source='serial',
                 experiment='Synthetic MCS1 contract sample; no physical sensors',
                 transport='synthetic', sample_rate_hz=20),
            dict(kind='connected', elapsed_s=0)]
    stream = b'FLW-SENSOR' + bytes.fromhex('001122334455')
    for i in range(100):
        values = [math.sin(i/20), 0, 9.80665, 0, 0, 0.1, 23.5, 101325, 45]
        if 30 <= i < 50:
            values[:6] = [None] * 6
        packet = encode(stream, 1, i, i*50, 0x100, values)
        if i == 60:
            packet = bytearray(packet); packet[46] ^= 1
        rows.append(dict(kind='bytes', elapsed_s=i/20, hex=bytes(packet).hex()))
    rows.append(dict(kind='stopped', elapsed_s=9))
    with Path(destination).open('x', encoding='utf-8') as output:
        output.write('\n'.join(json.dumps(r, allow_nan=False) for r in rows) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    write_sample(parser.parse_args().output)
