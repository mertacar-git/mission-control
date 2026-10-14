#!/usr/bin/env bash
set -euo pipefail
runtime=${MISSION_RUNTIME:-/opt/mission-control}
if [[ $EUID -eq 0 ]]; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq build-essential git python3-venv python3-dev pkg-config libxml2-dev libxslt1-dev zlib1g-dev rsync cmake
  mkdir -p "$runtime"
  chown "${SUDO_UID:-1001}:${SUDO_GID:-1001}" "$runtime"
  echo "System dependencies prepared. Run this script as the normal WSL user to build SITL."
  exit 0
fi
if [[ ! -d "$runtime" ]]; then echo "Run sudo bash simulator/setup.sh first."; exit 1; fi
if [[ ! -d "$runtime/ardupilot/.git" ]]; then
  git clone --depth 1 --branch Copter-4.6.3 --recurse-submodules --shallow-submodules https://github.com/ArduPilot/ardupilot.git "$runtime/ardupilot"
fi
cd "$runtime/ardupilot"
[[ $(git rev-parse HEAD) == 92b0cd788ec29406f26c6f9c31d5ceedbd1cc538 ]] || { echo "Unexpected simulator revision."; exit 1; }
python3 -m venv "$runtime/venv"
"$runtime/venv/bin/pip" install 'empy==3.3.4' 'future==1.0.0' 'pexpect==4.9.0' 'pymavlink==2.4.49' 'pyserial==3.5' 'lxml>=5,<6' 'setuptools==80.9.0' 'dronecan>=1.0,<2'
"$runtime/venv/bin/python" ./waf configure --board sitl
"$runtime/venv/bin/python" ./waf copter -j 4
echo "SITL installed at $runtime/ardupilot/build/sitl/bin/arducopter"
