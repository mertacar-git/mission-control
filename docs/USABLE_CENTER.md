# Usable center and sensor prototype

## Phase 1 — operator workflow

Open **Merkez** in the local application. The public page explains local-only access and never contacts local services. **Örnek filo** is a separate synthetic workflow; the old bearer HTTP registry is under **Geliştirme araçları**.

Sign in using an existing local account. Administrators open **Cihaz kaydı oluştur**, enter serial, name, model, assigned station, firmware and equipment (one item per line). Enrollment uses the existing operator endpoint. A duplicate serial is rejected without changing the original record. If the request times out, refresh and search the serial before submitting manually again: the operation may have committed.

Operators can search/read devices but cannot enroll them, including through direct API calls. Search covers serial, name, model and station. An empty registry, no matching devices, missing measurements and unavailable service have separate messages. Measurements age locally even while a request stalls; unavailable/stale values are hidden.

Operator errors retain `detail` and add stable `code`: `session_expired`, `permission_denied`, `registry_unavailable`, `registry_tls_invalid`, `registry_identity_rejected`, `duplicate_device`. A browser TLS failure cannot expose a structured HTTP response; check the launcher diagnostics and certificate trust separately.

## Acceptance boundaries

Only civilian device metadata and sensor measurements are covered. No physical aircraft control or physical sensor identity guarantee is provided. Two-PC, physical sensor, LAN and Internet acceptance remain pending.

## Phase 2 — receiver-to-center bridge

`mission_control.station_bridge` reads authenticated `/api/v1/serial/status`. It never opens a COM port, starts captures or reads replay. Configure `station_id`, `device_id`, `stream_id` and local HTTPS `center` in a JSON file. The device must already be enrolled to that station. The receiver remains the only serial reader.

The labelled `TEST:MCS1` source is now available when the receiver runs with `--synthetic`. Choose it on the serial page to record MCS1 environmental and IMU samples. The source is software, including when reports traverse real TLS.

Bridge startup discards the cached first source packet. Later unique packets are sent at no more than 5 Hz. Source loss/staleness stops reports; the center independently ages its last report and hides stale measurements. A changed stream/protocol, packet regression, receiver run change, rejected identity or uncertain ACK stops the bridge. Restart is explicit and again discards its initial cache; no queue, retry, replay or HTTP fallback exists.

MCS1 fields retain °C, Pa, %, m/s² and rad/s units and missing values. uint64 source clocks retain decimal-string JSON precision. Optional FSL fields preserve legacy reports. Firmware/stream labels are station reports, not proof of physical authenticity. Full raw bytes remain only in the serial archive; center reports are selected snapshots.

CLI example (from backend, using your own local paths):

```powershell
python -m mission_control.station_bridge --config .runtime/bridge.json --tls-directory .runtime/tls --serial-token-file .runtime/prototype/run-RUN_ID/serial.token --seconds 300
```

The token file must use the protected format written by the launcher (DPAPI on Windows, private mode on Linux). Plain text token files are rejected. The integrated launch path below handles this exchange automatically.

## Phase 3 — one local HTTPS address

Windows prerequisites: Python 3.12 (`py -3.12`), Node/npm and PowerShell. No ArduPilot, WSL, pymavlink or Shapely is required for the sensor-center prototype. Full SITL development still uses the existing WSL environment.

From the repository root:

```powershell
# First installation only. Prompts for the administrator password; default is synthetic.
.\simulator\run-prototype.ps1 -Action Setup
# Check existing installation without changing credentials or starting services.
.\simulator\run-prototype.ps1 -Action Check
# Normal startup: no package installation, account creation or certificate generation.
.\simulator\run-prototype.ps1 -Action Start
```

Setup uses the separate `backend/requirements-center.txt` dependency set and builds the UI. Runtime files are under `.runtime/prototype`; a second setup refuses that existing directory. Keep the sibling offline CA authority private. The short-lived local certificates need explicit renewal using the existing certificate procedures; startup never renews them silently.

The page is `https://127.0.0.1:8772`. Explicitly trust the generated **public CA certificate** (`.runtime/prototype/tls/ca.crt`) in your browser/OS using your normal local development certificate procedure after verifying its provenance/fingerprint. Never import a private key or bypass a browser certificate warning. Trust-store installation is a manual acceptance step, not performed by the launcher.

Sign in and use **Merkez**. Enroll serial **MCS-BENCH-01** to **station-a** (the displayed configuration is authoritative). Open **Seri alıcı ve ayrı kayıt arşivi**, verify **TEST:MCS1** and start capture. Watch the configured device receive explicitly synthetic MCS1 measurements. Stop capture: center values disappear after three seconds. Open **Seri kaydı aç** separately to replay the raw bytes; replay does not feed the bridge. A different receiver run requires restarting the launcher/bridge explicitly.

The center serves the production assets and authenticates its fixed serial gateway with the existing human session. The receiver token never reaches this UI. It is exchanged through a per-run file protected with current-user DPAPI on Windows or mode 0600 inside a private directory on Linux. The launcher removes that token file on shutdown. Standalone legacy receiver mode remains available; only the new protected-file path suppresses terminal token output.

`Ctrl+C` shuts down only processes started by this launcher. Occupied ports cause a diagnostic, never process termination. Startup failure cleans up owned children. A forced OS kill/power loss cannot run cleanup; inspect the runtime lock and service ownership manually before recovery. Do not blindly remove a lock while the original launcher is running.

For an explicitly selected real receiver, use a **new** setup directory and provide both COM port and expected stream ID:

```powershell
.\simulator\run-prototype.ps1 -Action Setup -Directory C:\FLW\sensor-prototype -Profile serial -Port COM7 -Stream 00112233445566778899aabbccddeeff
.\simulator\run-prototype.ps1 -Action Start -Directory C:\FLW\sensor-prototype
```

No port is automatically switched. If its name changes, edit the existing configuration explicitly after checking the new port and expected stream. A `serial` label is not physical sensor authenticity or accuracy acceptance. Physical sensors, second PC, LAN and Internet remain pending.

Diagnostics are displayed by the launcher and per-run local logs. `bridge-status.json` and the center panel expose only state, stable diagnostic code and forwarded-snapshot count; no token/private key is included. Identity/ACK/stream errors stop the bridge without retry. Initial waiting for the configured device to be enrolled is allowed and does not retry failed communication.
