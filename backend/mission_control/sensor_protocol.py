"""MCS1 v1 sensor-only companion to MCT1; never feeds flight telemetry."""
import math
import struct
import zlib

HEADER = struct.Struct('<4sBB16sIIQI9f')
SIZE = HEADER.size + 4
FIELDS = ('acceleration_x_ms2', 'acceleration_y_ms2', 'acceleration_z_ms2',
          'angular_velocity_x_rads', 'angular_velocity_y_rads', 'angular_velocity_z_rads',
          'temperature_c', 'pressure_pa', 'humidity_percent')
LIMITS = [(1, -200, 200)] * 3 + [(1, -40, 40)] * 3 + [(2, -40, 85), (4, 30000, 110000), (8, 0, 100)]


def encode(stream, boot, sequence, source_ms, firmware, values):
    if len(values) != 9:
        raise ValueError('sensor_count')
    if any(v is None for v in values[:6]) and not all(v is None for v in values[:6]):
        raise ValueError('partial_imu')
    flags = (1 if values[0] is not None else 0) | sum(flag for flag, value in zip((2, 4, 8), values[6:]) if value is not None)
    body = HEADER.pack(b'MCS1', 1, flags, stream, boot, sequence, source_ms, firmware,
                       *(0 if value is None else value for value in values))
    packet = body + struct.pack('<I', zlib.crc32(body) & 0xffffffff)
    decode(packet)
    return packet


def decode(packet):
    if len(packet) != SIZE:
        raise ValueError('length')
    if zlib.crc32(packet[:-4]) & 0xffffffff != struct.unpack('<I', packet[-4:])[0]:
        raise ValueError('crc')
    magic, version, flags, stream, boot, sequence, source_ms, firmware, *values = HEADER.unpack(packet[:-4])
    if magic != b'MCS1' or version != 1 or flags & ~15:
        raise ValueError('version_or_flags')
    result = dict(source='serial', protocol='MCS1', stream_id=stream.hex(), boot_id=boot,
                  sequence=sequence, source_time_ms=source_ms, firmware_code=firmware,
                  latitude=None, longitude=None, relative_altitude_m=None,
                  ground_speed_ms=None, battery_voltage_v=None)
    for name, value, (flag, low, high) in zip(FIELDS, values, LIMITS):
        if flags & flag and (not math.isfinite(value) or not low <= value <= high):
            raise ValueError('measurement')
        result[name] = value if flags & flag else None
    return result
