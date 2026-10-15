#include "mct1.hpp"
#include <iostream>
#include <string>
#include <vector>
#include <iomanip>
int main(){std::string hex;while(std::cin>>hex){std::vector<std::uint8_t> data;try{if(hex.size()%2)throw 1;for(std::size_t i=0;i<hex.size();i+=2)data.push_back(static_cast<std::uint8_t>(std::stoul(hex.substr(i,2),nullptr,16)));}catch(...){std::cout<<"invalid\n";continue;}mct1::Frame f{};if(!mct1::decode(data.data(),data.size(),f)){std::cout<<"invalid\n";continue;}std::cout<<unsigned(f.flags)<<","<<f.boot<<","<<f.sequence<<","<<f.source_ms<<","<<f.latitude_e7<<","<<f.longitude_e7<<","<<std::setprecision(9)<<f.altitude_m<<","<<f.speed_ms<<","<<f.voltage_v<<"\n";}}
