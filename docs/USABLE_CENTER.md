# Usable center and sensor prototype

## Phase 1 — operator workflow

Open **Merkez** in the local application. The public page explains local-only access and never contacts local services. **Örnek filo** is a separate synthetic workflow; the old bearer HTTP registry is under **Geliştirme araçları**.

Sign in using an existing local account. Administrators open **Cihaz kaydı oluştur**, enter serial, name, model, assigned station, firmware and equipment (one item per line). Enrollment uses the existing operator endpoint. A duplicate serial is rejected without changing the original record. If the request times out, refresh and search the serial before submitting manually again: the operation may have committed.

Operators can search/read devices but cannot enroll them, including through direct API calls. Search covers serial, name, model and station. An empty registry, no matching devices, missing measurements and unavailable service have separate messages. Measurements age locally even while a request stalls; unavailable/stale values are hidden.

Operator errors retain `detail` and add stable `code`: `session_expired`, `permission_denied`, `registry_unavailable`, `registry_tls_invalid`, `registry_identity_rejected`, `duplicate_device`. A browser TLS failure cannot expose a structured HTTP response; check the launcher diagnostics and certificate trust separately.

## Acceptance boundaries

Only civilian device metadata and sensor measurements are covered. No physical aircraft control or physical sensor identity guarantee is provided. Two-PC, physical sensor, LAN and Internet acceptance remain pending.
