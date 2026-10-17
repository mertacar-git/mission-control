#pragma once
#include <cstdint>
#include <cstring>
#include <cmath>

namespace mcs1 {
constexpr unsigned packet_size = 82;
struct Frame {
  std::uint8_t stream[16]{};
  std::uint32_t boot{}, sequence{}, firmware{0x00000100};
  std::uint64_t source_ms{};
  std::uint8_t flags{};
  float values[9]{};
};
inline void put32(std::uint8_t* p, std::uint32_t v) {
  for (unsigned i=0;i<4;++i) p[i]=std::uint8_t(v>>(8*i));
}
inline std::uint32_t crc32(const std::uint8_t* p, unsigned n) {
  std::uint32_t crc=0xffffffff;
  for (unsigned i=0;i<n;++i) {
    crc ^= p[i];
    for (unsigned j=0;j<8;++j) crc=(crc>>1)^((crc&1)?0xedb88320:0);
  }
  return crc^0xffffffff;
}
inline bool encode(const Frame& f, std::uint8_t (&p)[packet_size]) {
  if (f.flags&0xf0) return false;
  const float low[9]={-200,-200,-200,-40,-40,-40,-40,30000,0};
  const float high[9]={200,200,200,40,40,40,85,110000,100};
  const unsigned bits[9]={1,1,1,1,1,1,2,4,8};
  std::memset(p,0,packet_size);std::memcpy(p,"MCS1",4);
  p[4]=1;p[5]=f.flags;std::memcpy(p+6,f.stream,16);
  put32(p+22,f.boot);put32(p+26,f.sequence);
  put32(p+30,std::uint32_t(f.source_ms));put32(p+34,std::uint32_t(f.source_ms>>32));
  put32(p+38,f.firmware);
  for (unsigned i=0;i<9;++i) {
    if (!(f.flags&bits[i])) continue;
    if (!std::isfinite(f.values[i]) || f.values[i]<low[i] || f.values[i]>high[i]) return false;
    std::uint32_t value;std::memcpy(&value,&f.values[i],4);put32(p+42+i*4,value);
  }
  put32(p+78,crc32(p,78));return true;
}
}
