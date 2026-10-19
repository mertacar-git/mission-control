# Civilian center delivery sequence

Each stage ships independently with software evidence. No hardware or network
acceptance is inferred from a local test. No additional general approval is
needed to continue authorized software work.

| Stage | Delivery | Gate and status |
|---|---|---|
| A | Human accounts, admin/operator enforcement, expiry/logout/disable audit | Implemented; software acceptance in this delivery |
| B | HTTPS center UI and mTLS read/enrollment gateway | Initial implementation; local software checks, certificate trust setup required |
| C | Connection/identity recovery and administration workflow | Remaining: admin UI, password recovery/change, station certificate action audit, outage/recovery acceptance |
| D | Separate-PC LAN deployment | Remaining: explicit host/origin/certificate configuration and two-PC acceptance; current services remain loopback |
| E | Physical ESP32 sensor acceptance | Blocked on actual board connection/calibration; synthetic fixtures do not pass this gate |
| F | Internet operations | Remaining: chosen hosting/domain, production PKI, monitoring/rate hardening, encrypted backup recovery |
| G | Unified versioned release and demonstration | After applicable gates: release, operator install package, recorded real end-to-end demo and portfolio update |

Current account permissions apply to the new operator gateway. They do not
retroactively authorize SITL commands, browser-synthetic permissions or offline
CA/file administration. The legacy registry remains a separately scoped service.

See [account/gateway setup](OPERATOR_CENTER.md), [CSR enrollment](STATION_ENROLLMENT.md),
[FSL contract](FSL_IMPLEMENTATION.md) and [sensor acceptance](SENSOR_NODE.md).
