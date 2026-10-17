# FLW VECTOR sensor node — ESP32 firmware 0.1.0

USB sensor-only prototype for ESP32 ESP-32S (classic ESP32), MPU6050/GY-521 and
BME280. No actuator, MAVLink, Wi-Fi or incoming command path exists.
Physical board operation, calibration and measurement accuracy are **pending**.

## Build and flash

Install Python and PlatformIO Core 6.1.18. Dependencies and target platform are
pinned in `platformio.ini`. From this directory:

```powershell
python -m pip install platformio==6.1.18
python -m platformio run
# After the board arrives, select its actual COM port explicitly:
python -m platformio run --target upload --upload-port COM5
```

Replace COM5 with the device's actual port. Stop the serial receiver before
uploading; only one program can own the port. After upload, close the upload tool
and run the existing Windows receiver (`simulator/run-serial.ps1`). Open the local
FLW VECTOR **Seri cihaz** screen, enter the receiver token, select the port and
115200 baud, then start a recording. Public Pages only plays sample recordings.
Serial terminal output is binary; it is not human-readable text.

## Proposed wiring

Disconnect USB while wiring. Verify module labels and their 3.3 V compatibility
against the actual purchased boards; the ESP32 GPIO bus must not be pulled to 5 V.

| ESP32 | MPU6050/GY-521 | BME280 |
|---|---|---|
| 3V3 | VCC (compatible module) | VCC/VIN (compatible module) |
| GND | GND | GND |
| GPIO21 | SDA | SDA |
| GPIO22 | SCL | SCL |

The shared I2C bus is 100 kHz. MPU addresses 0x68/0x69 and BME addresses 0x76/0x77
are probed; missing devices are retried at five-second intervals. BME280 is
required for humidity; BMP280 is not a substitute. MPU range is ±8 g and ±500°/s,
with 21 Hz filter bandwidth. Transmission target is 20 Hz; bus errors can reduce
the observed rate. Each packet carries actual monotonic source uptime.

Place the IMU on a rigid base with its X/Y/Z axes marked. Keep the BME280 away
from ESP32 heat and provide ventilation. No offset correction is applied before
physical calibration. Acceleration includes gravity; compass heading, position,
battery voltage and flight altitude are not derived or invented.

The firmware uses [Adafruit MPU6050](https://github.com/adafruit/Adafruit_MPU6050)
and [Adafruit BME280](https://github.com/adafruit/Adafruit_BME280_Library). Boot
identity is persisted with [Espressif Preferences](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/preferences.html).
One NVS write occurs per boot, not per sample. Failed persistence stops binary
transmission. Erasing NVS resets boot numbering: stop the old capture and create
a new recording. The device ID is a reported MAC-derived identifier, not proof
of authenticity. Version 0.1.0 is transmitted as `0x00000100`.

## Physical acceptance checklist

1. Confirm the chosen board enumerates and flashes successfully.
2. Verify supply voltage and I2C module identity/address.
3. Check stationary gravity response and gyro bias; document orientation.
4. Remove each sensor: its fields must become unknown, while other fields remain.
5. Reconnect sensors, unplug USB, reboot and inspect boot/sequence behavior.
6. Record 30 minutes; inspect packet gaps, discarded bytes and replay consistency.
7. Compare environmental readings against a reference before claiming accuracy.

Build success and synthetic replay cannot substitute for these physical checks.
