#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_BME280.h>
#include <esp_timer.h>
#include "mcs1.hpp"

// Sensor-only USB telemetry. No actuator, radio, MAVLink or command input.
Adafruit_MPU6050 imu;
Adafruit_BME280 environment;
mcs1::Frame frame;
bool imuReady=false, environmentReady=false;
std::uint8_t imuAddress=0x68, environmentAddress=0x76;
std::uint64_t nextSample=0, nextProbe=0;
constexpr std::uint64_t intervalMs=50; // 20 Hz; actual source uptime is transmitted.

bool present(std::uint8_t address) {
  Wire.beginTransmission(address);return Wire.endTransmission()==0;
}
void configureSensors() {
  imuReady=imu.begin(0x68,&Wire);imuAddress=0x68;
  if (!imuReady) { imuReady=imu.begin(0x69,&Wire);imuAddress=0x69; }
  if (imuReady) {
    imu.setAccelerometerRange(MPU6050_RANGE_8_G);
    imu.setGyroRange(MPU6050_RANGE_500_DEG);
    imu.setFilterBandwidth(MPU6050_BAND_21_HZ);
  }
  environmentReady=environment.begin(0x76,&Wire);environmentAddress=0x76;
  if (!environmentReady) { environmentReady=environment.begin(0x77,&Wire);environmentAddress=0x77; }
}
void setup() {
  Serial.begin(115200);
  Wire.begin(21,22);Wire.setClock(100000);Wire.setTimeOut(50);
  const std::uint64_t mac=ESP.getEfuseMac();
  std::memcpy(frame.stream,"FLW-SENSOR",10);
  for (unsigned i=0;i<6;++i) frame.stream[10+i]=std::uint8_t(mac>>(8*i));
  Preferences storage;
  // Stop transmitting if durable boot identity cannot be maintained.
  if (!storage.begin("flw-vector",false)) { while (true) delay(1000); }
  const std::uint32_t previous=storage.getUInt("boot",0);
  if (previous==UINT32_MAX || storage.putUInt("boot",previous+1)!=4) {
    storage.end();while (true) delay(1000);
  }
  frame.boot=previous+1;storage.end();
  configureSensors();
}
void loop() {
  const std::uint64_t now=std::uint64_t(esp_timer_get_time()/1000);
  if (now<nextSample) { delay(1);return; }
  nextSample=now+intervalMs;
  if ((!imuReady || !environmentReady) && now>=nextProbe) {
    configureSensors();nextProbe=now+5000;
  }
  frame.flags=0;frame.source_ms=std::uint64_t(esp_timer_get_time()/1000);
  if (imuReady && present(imuAddress)) {
    sensors_event_t a{},g{},t{};
    if (imu.getEvent(&a,&g,&t)) {
      const float v[6]={a.acceleration.x,a.acceleration.y,a.acceleration.z,g.gyro.x,g.gyro.y,g.gyro.z};
      bool valid=true;
      for (unsigned i=0;i<6;++i) { frame.values[i]=v[i];valid=valid && std::isfinite(v[i]) && std::abs(v[i]) <= (i<3?200:40); }
      if (valid) frame.flags|=1;
    } else imuReady=false;
  } else imuReady=false;
  if (environmentReady && present(environmentAddress)) {
    frame.values[6]=environment.readTemperature();
    frame.values[7]=environment.readPressure();
    frame.values[8]=environment.readHumidity();
    const float low[3]={-40,30000,0},high[3]={85,110000,100};
    for (unsigned i=0;i<3;++i) if (std::isfinite(frame.values[6+i]) && frame.values[6+i]>=low[i] && frame.values[6+i]<=high[i]) frame.flags|=std::uint8_t(2<<i);
  } else environmentReady=false;
  std::uint8_t packet[mcs1::packet_size];
  if (mcs1::encode(frame,packet)) Serial.write(packet,sizeof(packet));
  // Sequence wrap requires a new durable boot ID; do not silently wrap.
  if (frame.sequence==UINT32_MAX) { Serial.flush();ESP.restart(); }
  ++frame.sequence;
}
