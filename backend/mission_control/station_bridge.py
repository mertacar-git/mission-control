"""Read-only MCS1 receiver bridge. No serial driver, replay, retries or flight API."""
import argparse
import json
import ssl
import time
from pathlib import Path
from typing import Literal
from uuid import uuid4
from urllib.parse import urlparse
import httpx
from pydantic import Field
from .fleet_service import Strict
from .fsl import FSLMeasurement
from .serial_service import SerialStatus
from .sensor_protocol import FIELDS
from .key_custody import key_password


class BridgeConfig(Strict):
    station_id: Literal['station-a', 'station-b']
    device_id: str = Field(pattern=r'^[A-Za-z0-9_-]{1,80}$')
    stream_id: str = Field(pattern=r'^[0-9a-f]{32}$')
    receiver: Literal['http://127.0.0.1:8767', 'http://localhost:8767'] = 'http://127.0.0.1:8767'
    center: str = 'https://127.0.0.1:8771'

    def verified_center(self):
        parsed = urlparse(self.center)
        if parsed.scheme != 'https' or parsed.hostname not in ('localhost', '127.0.0.1') or parsed.path not in ('', '/') or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('This prototype requires a loopback HTTPS center origin.')
        return self.center.rstrip('/')


class BridgeError(RuntimeError):
    """Stable non-secret diagnostic code."""


def sensor_payload(status: SerialStatus, config: BridgeConfig):
    frame = status.telemetry
    if not frame or status.state != 'fresh' or status.age_s is None or not 0 <= status.age_s < 3 or status.connection != 'connected' or not status.run or status.run.status != 'running':
        return None
    if frame.protocol != 'MCS1':
        raise BridgeError('source_protocol_mismatch')
    if frame.stream_id != config.stream_id:
        raise BridgeError('source_stream_mismatch')
    if status.run.transport != status.transport:
        raise BridgeError('source_transport_mismatch')
    return FSLMeasurement(source='synthetic' if status.transport == 'synthetic' else 'serial',
        boot=frame.boot_id, sequence=frame.sequence, source_time_ms=str(frame.source_time_ms),
        sensor_protocol='MCS1', stream_id=frame.stream_id, firmware_code=frame.firmware_code,
        **{name: getattr(frame, name) for name in FIELDS})


class StationBridge:
    def __init__(self, config, receiver, center, clock=time.monotonic):
        self.config, self.receiver, self.center, self.clock = config, receiver, center, clock
        self.session = None
        self.previous = None
        self.run_id = None
        self.last_send = None
        self.counter = 0
        self.state, self.error = 'waiting', None
        self.forwarded = 0

    def request(self, client, method, path, **kwargs):
        try:
            response = client.request(method, path, **kwargs)
            if response.status_code not in (200, 201):
                raise BridgeError('identity_rejected' if response.status_code in (401,403) else 'request_rejected')
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise BridgeError('communication_or_ack_unknown') from None

    def initialize(self):
        try:
            snapshot = self.request(self.center, 'GET', '/api/v1/fleet/snapshot')
            if snapshot.get('actor') != self.config.station_id or not any(row['device']['serial'] == self.config.device_id and row['device']['station'] == self.config.station_id for row in snapshot['devices']):
                raise BridgeError('station_device_binding_rejected')
            response = self.request(self.center, 'POST', '/api/v1/fsl/sessions')
            if response.get('protocol') != 'FSL' or response.get('version') != 1 or not isinstance(response.get('session_id'), str):
                raise BridgeError('session_ack_invalid')
            self.session = response['session_id']
        except Exception as error:
            self.fail(error)

    def fail(self, error):
        self.state = 'error'
        self.error = str(error) if isinstance(error, BridgeError) else 'invalid_source_or_response'
        raise BridgeError(self.error) from None

    def step(self):
        if self.state == 'error':
            raise BridgeError('bridge_requires_restart')
        if self.session is None:
            raise BridgeError('bridge_not_initialized')
        try:
            status = SerialStatus.model_validate(self.request(self.receiver, 'GET', '/api/v1/serial/status'))
            payload = sensor_payload(status, self.config)
            if payload is None:
                self.state = 'waiting'
                return False
            if self.run_id is not None and status.run.id != self.run_id:
                raise BridgeError('receiver_run_changed_restart_required')
            self.run_id = status.run.id
            key = (payload.boot, payload.sequence, payload.source_time_ms)
            if self.previous is None:
                # Discard the cached snapshot on every bridge start. Only later packets are live.
                self.previous = key
                self.state = 'waiting'
                return False
            if key == self.previous:
                return False
            old_boot, old_sequence, old_time = self.previous
            if payload.boot < old_boot or (payload.boot == old_boot and (payload.sequence <= old_sequence or payload.source_time_ms < old_time)):
                raise BridgeError('source_packet_regression')
            now = self.clock()
            if self.last_send is not None and now-self.last_send < .2:
                return False
            message_id = str(uuid4())
            body = dict(protocol='FSL', version=1, session_id=self.session, message_id=message_id,
                station_id=self.config.station_id, device_id=self.config.device_id, sequence=str(self.counter),
                type='equipment.report', payload=payload.model_dump(mode='json'))
            response = self.request(self.center, 'POST', '/api/v1/fsl/reports', json=body)
            if response.get('protocol') != 'FSL' or response.get('version') != 1 or response.get('message_id') != message_id or response.get('status') != 'accepted-new':
                raise BridgeError('report_ack_unknown')
            self.previous, self.last_send = key, now
            self.counter += 1
            self.forwarded += 1
            self.state = 'running'
            return True
        except Exception as error:
            self.fail(error)

    def status(self):
        return dict(state=self.state, code=self.error, forwarded=self.forwarded, station=self.config.station_id,
                    device=self.config.device_id, stream=self.config.stream_id, full_packet_archive=False)


def tls_context(directory, identity):
    context = ssl.create_default_context(cafile=str(directory/'ca.crt'))
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    key = directory/f'{identity}.key'
    context.load_cert_chain(str(directory/f'{identity}.crt'), str(key), password=key_password(key))
    return context


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--tls-directory', type=Path, required=True)
    parser.add_argument('--serial-token-file', type=Path, required=True)
    parser.add_argument('--seconds', type=int, choices=range(1, 601), default=300)
    args = parser.parse_args()
    config = BridgeConfig.model_validate_json(args.config.read_text())
    token = args.serial_token_file.read_text().strip()
    with httpx.Client(base_url=config.receiver, headers={'Authorization':'Bearer '+token}, trust_env=False, follow_redirects=False, timeout=2) as receiver, httpx.Client(base_url=config.verified_center(), verify=tls_context(args.tls_directory, config.station_id), trust_env=False, follow_redirects=False, timeout=3) as center:
        bridge = StationBridge(config, receiver, center)
        try:
            bridge.initialize()
            deadline = time.monotonic()+args.seconds
            while time.monotonic() < deadline:
                bridge.step()
                time.sleep(.2)
        except BridgeError:
            print(json.dumps(bridge.status()), flush=True)
            raise SystemExit(1)
        except KeyboardInterrupt:
            bridge.state = 'stopped'
        print(json.dumps(bridge.status()), flush=True)


if __name__ == '__main__':
    main()
