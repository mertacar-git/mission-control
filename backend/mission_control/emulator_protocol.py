"""MCT1 v1: little-endian fixed 62-byte packets; CRC-32/ISO-HDLC (zlib)."""
import math,struct,zlib
HEADER=struct.Struct('<4sBB16sIIQiifff')
SIZE=HEADER.size+4

def encode(stream,boot,sequence,source_ms,latitude,longitude,altitude,speed,voltage):
    flags=(1 if latitude is not None and longitude is not None else 0)|(2 if altitude is not None else 0)|(4 if speed is not None else 0)|(8 if voltage is not None else 0)
    body=HEADER.pack(b'MCT1',1,flags,stream,boot,sequence,source_ms,round((latitude or 0)*1e7),round((longitude or 0)*1e7),altitude or 0,speed or 0,voltage or 0)
    packet=body+struct.pack('<I',zlib.crc32(body)&0xffffffff)
    decode(packet)
    return packet

def decode(packet):
    if len(packet)!=SIZE:raise ValueError('length')
    body=packet[:-4]
    if zlib.crc32(body)&0xffffffff!=struct.unpack('<I',packet[-4:])[0]:raise ValueError('crc')
    magic,version,flags,stream,boot,sequence,source_ms,lat,lon,alt,speed,voltage=HEADER.unpack(body)
    if magic!=b'MCT1' or version!=1 or flags&~15:raise ValueError('version_or_flags')
    if flags&1 and (abs(lat/1e7)>90 or abs(lon/1e7)>180):raise ValueError('position')
    for value,flag,low,high in [(alt,2,-1000,20000),(speed,4,0,500),(voltage,8,0,100)]:
        if flags&flag and (not math.isfinite(value) or not low<=value<=high):raise ValueError('measurement')
    return dict(source='emulator',stream_id=stream.hex(),boot_id=boot,sequence=sequence,source_time_ms=source_ms,
        latitude=lat/1e7 if flags&1 else None,longitude=lon/1e7 if flags&1 else None,
        relative_altitude_m=alt if flags&2 else None,ground_speed_ms=speed if flags&4 else None,battery_voltage_v=voltage if flags&8 else None)
