# Session-bound certificate approval

Administrators can review an offline-signed **public station certificate** in
**Merkez → İstasyon sertifikası için yönetici onayı**. This does not sign or
activate a certificate. Station private keys remain at the station; the CA key
remains offline. Never paste private keys into the form.

1. Choose the station, paste its public PEM certificate and explain the change.
2. Review the old and new SHA-256 fingerprints and certificate expiration.
3. Explicitly approve. Editing any input invalidates the preview.
4. On the center host, using its existing account database, run:

```powershell
python -m mission_control.station_enrollment activate-approved --center-directory PATH_TO_CENTER_TLS --accounts-db PATH_TO_ACCOUNTS_DB --approval-id APPROVAL_UUID
```

The approval expires after at most 15 minutes and no later than the approving
session. Logout, account disable, password reset and session expiration invalidate
unused approvals. The command rechecks authorization, certificate validity,
revocation and the exact previous fingerprint mapping. It cannot create roles.

Approval consumption is committed before any identity mutation. A failed or
uncertain activation cannot reuse the approval: inspect the offline identity
journal and current mapping, reconcile uncertain journal entries using the
existing offline procedure, then obtain a fresh review if needed. No automatic
retry is performed. A successful response links the authenticated administrator,
approval UUID and offline journal operation UUID in the account audit.

## Security boundary

This is an application approval path, not protection against an administrator
who controls local files. Existing offline OS-authorized `activate` and `renew`
commands remain available and are separately labeled in the identity journal.
That journal continues to identify an OS actor, not an authenticated human. The
approval audit records the verified account separately. Neither local journal
is tamper-evident. Protect and back up the account database and certificate
registry using host access controls.

The API accepts public certificates only, not keys or signing requests. It never
provides network activation or CA signing. Production multi-host enrollment,
physical sensors, LAN/Internet transport and browser/OS trust installation remain
separate acceptance tasks.

For the default Windows prototype directory, run from `backend` with the existing
center environment (replace only the approval UUID):

```powershell
& ../.venv-center/Scripts/python.exe -m mission_control.station_enrollment activate-approved --center-directory ../.runtime/prototype/tls --accounts-db ../.runtime/prototype/operators/accounts.sqlite3 --approval-id APPROVAL_UUID
```

Do not run Setup again to use this command. A custom launcher `-Directory`
requires its corresponding `tls` and `operators/accounts.sqlite3` paths.
