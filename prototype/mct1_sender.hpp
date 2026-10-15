#pragma once
#include "mct1.hpp"

namespace mct1 {
inline void put32(std::uint8_t* p, std::uint32_t value) {
  for (unsigned i=0;i<4;i++) p[i]=std::uint8_t(value>>(i*8));
}
// Supply missing sensors by clearing the corresponding Frame.flags bit.
// The caller supplies a stable device stream ID and a boot counter persisted
// across resets. No allocation, board SDK, transport or actuator dependency.
inline bool encode(const Frame& frame, std::uint8_t (&packet)[packet_size]) {
  std::memset(packet,0,packet_size); std::memcpy(packet,"MCT1",4);
  packet[4]=1;packet[5]=frame.flags;std::memcpy(packet+6,frame.stream,16);
  put32(packet+22,frame.boot);put32(packet+26,frame.sequence);
  put32(packet+30,std::uint32_t(frame.source_ms));put32(packet+34,std::uint32_t(frame.source_ms>>32));
  put32(packet+38,std::uint32_t(frame.latitude_e7));put32(packet+42,std::uint32_t(frame.longitude_e7));
  std::uint32_t bits;
  std::memcpy(&bits,&frame.altitude_m,4);put32(packet+46,bits);
  std::memcpy(&bits,&frame.speed_ms,4);put32(packet+50,bits);
  std::memcpy(&bits,&frame.voltage_v,4);put32(packet+54,bits);
  put32(packet+58,crc32(packet,58));
  Frame check{};return decode(packet,packet_size,check);
}
}
