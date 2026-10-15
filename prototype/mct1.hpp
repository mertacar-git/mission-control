#pragma once
#include <cstdint>
#include <cstring>
#include <cmath>
#include <cstddef>

namespace mct1 {
constexpr std::size_t packet_size=62;
struct Frame {std::uint8_t flags;std::uint8_t stream[16];std::uint32_t boot,sequence;std::uint64_t source_ms;std::int32_t latitude_e7,longitude_e7;float altitude_m,speed_ms,voltage_v;};
inline std::uint32_t u32(const std::uint8_t* p){return std::uint32_t(p[0])|(std::uint32_t(p[1])<<8)|(std::uint32_t(p[2])<<16)|(std::uint32_t(p[3])<<24);}
inline float f32(const std::uint8_t* p){auto bits=u32(p);float value;static_assert(sizeof(value)==4);std::memcpy(&value,&bits,4);return value;}
inline std::uint32_t crc32(const std::uint8_t* p,std::size_t n){std::uint32_t crc=0xffffffffu;for(std::size_t i=0;i<n;i++){crc^=p[i];for(int bit=0;bit<8;bit++)crc=(crc>>1)^(0xedb88320u& (0u-(crc&1u)));}return crc^0xffffffffu;}
inline bool decode(const std::uint8_t* p,std::size_t size,Frame& out){
  if(size!=packet_size||crc32(p,58)!=u32(p+58)||std::memcmp(p,"MCT1",4)||p[4]!=1||(p[5]&0xf0))return false;
  Frame f{};f.flags=p[5];std::memcpy(f.stream,p+6,16);f.boot=u32(p+22);f.sequence=u32(p+26);f.source_ms=std::uint64_t(u32(p+30))|(std::uint64_t(u32(p+34))<<32);
  auto lat=u32(p+38),lon=u32(p+42);std::memcpy(&f.latitude_e7,&lat,4);std::memcpy(&f.longitude_e7,&lon,4);
  f.altitude_m=f32(p+46);f.speed_ms=f32(p+50);f.voltage_v=f32(p+54);
  if((f.flags&1)&&(std::abs(double(f.latitude_e7))>900000000.0||std::abs(double(f.longitude_e7))>1800000000.0))return false;
  if((f.flags&2)&&(!std::isfinite(f.altitude_m)||f.altitude_m< -1000||f.altitude_m>20000))return false;
  if((f.flags&4)&&(!std::isfinite(f.speed_ms)||f.speed_ms<0||f.speed_ms>500))return false;
  if((f.flags&8)&&(!std::isfinite(f.voltage_v)||f.voltage_v<0||f.voltage_v>100))return false;
  out=f;return true;
}
} // namespace mct1
