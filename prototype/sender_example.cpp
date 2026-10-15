// Desktop contract example. Replace only sensor acquisition and byte transport
// with the selected board SDK; these numbers are synthetic, not sensor output.
#include "mct1_sender.hpp"
#include <cstdio>
int main() {
  mct1::Frame frame{};
  for(unsigned i=0;i<16;i++) frame.stream[i]=std::uint8_t(i);
  frame.flags=15;frame.boot=2;frame.sequence=17;frame.source_ms=3400;
  frame.latitude_e7=410082000;frame.longitude_e7=289784000;
  frame.altitude_m=20.25f;frame.speed_ms=5.5f;frame.voltage_v=12.6f;
  std::uint8_t bytes[mct1::packet_size];
  if(!mct1::encode(frame,bytes)) return 1;
  for(auto byte:bytes) std::printf("%02x",unsigned(byte));
  std::printf("\n");
}
