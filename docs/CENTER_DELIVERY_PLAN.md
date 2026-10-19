# Civilian center delivery sequence

Each stage ships independently with software evidence. No hardware or network
acceptance is inferred from a local test. No additional general approval is
needed to continue authorized software work.

| Stage | Delivery | Gate and status |
|---|---|---|
| A | Human accounts, admin/operator enforcement, expiry/logout/disable audit | Delivered; 124 backend / 84 frontend / 20 browser checks, CI passed |
| B | HTTPS center UI and mTLS read/enrollment gateway | Delivered local foundation; browser certificate trust setup remains a deployment step |
| C | Connection/identity recovery and administration workflow | User/admin UI, password change and offline account recovery implemented; station certificate action audit and separate-PC recovery remain pending |
| D | Separate-PC LAN deployment | Remaining: explicit host/origin/certificate configuration and two-PC acceptance; current services remain loopback |
| E | Physical ESP32 sensor acceptance | Blocked on actual board connection/calibration; synthetic fixtures do not pass this gate |
| F | Internet operations | Remaining: chosen hosting/domain, production PKI, monitoring/rate hardening, encrypted backup recovery |
| G | Unified versioned release and demonstration | After applicable gates: release, operator install package, recorded real end-to-end demo and portfolio update |

Current account permissions apply to the new operator gateway. They do not
retroactively authorize SITL commands, browser-synthetic permissions or offline
CA/file administration. The legacy registry remains a separately scoped service.

See [account/gateway setup](OPERATOR_CENTER.md), [CSR enrollment](STATION_ENROLLMENT.md),
[FSL contract](FSL_IMPLEMENTATION.md) and [sensor acceptance](SENSOR_NODE.md).
