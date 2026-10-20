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
python -m mission_control.station_bridge --config .runtime/bridge.json --tls-directory .runtime/tls --serial-token-file .runtime/receiver.token --seconds 300
```

The integrated launch path in Phase 3 replaces terminal token handling with protected local-file exchange.
