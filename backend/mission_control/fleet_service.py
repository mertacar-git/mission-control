"""Independent civilian equipment registry. Read-only measurements; no flight API."""
import argparse
import json
import secrets
import sqlite3
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Annotated
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_serializer


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Device(Strict):
    serial: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    name: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=100)
    station: Literal['station-a', 'station-b']
    firmware: str = Field(min_length=1, max_length=80)
    equipment: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=20)


class Measurement(Strict):
    source: Literal['synthetic', 'serial']
    boot: int = Field(ge=0, le=4294967295, strict=True)
    sequence: int = Field(ge=0, le=4294967295, strict=True)
    source_time_ms: int = Field(ge=0, le=18446744073709551615, strict=True)
    battery_percent: float | None = Field(default=None, ge=0, le=100)
    temperature_c: float | None = Field(default=None, ge=-40, le=85)
    pressure_pa: float | None = Field(default=None, ge=30000, le=110000)
    humidity_percent: float | None = Field(default=None, ge=0, le=100)

    @field_serializer('source_time_ms')
    def clock(self, value):
        return str(value) if value > 9007199254740991 else value


class Registry:
    def __init__(self, path, clock=time.monotonic):
        self.clock, self.received = clock, {}
        self.lock = threading.RLock()
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version not in (0,1):
            self.db.close()
            raise ValueError('Unsupported registry database schema.')
        self.db.executescript('''PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS devices(serial TEXT PRIMARY KEY, station TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS reports(serial TEXT PRIMARY KEY, boot INTEGER, sequence INTEGER, source_ms TEXT, body TEXT);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, received_utc_ms INTEGER, actor TEXT, kind TEXT, serial TEXT);
        ''')
        self.db.commit()
        self.db.execute('PRAGMA user_version=1')

    def register(self, device, actor):
        with self.lock, self.db:
            self.db.execute('INSERT INTO devices VALUES(?,?,?)', (device.serial, device.station, device.model_dump_json()))
            self.log(actor, 'registered', device.serial)

    def log(self, actor, kind, serial):
        self.db.execute('INSERT INTO audit(received_utc_ms,actor,kind,serial) VALUES(?,?,?,?)',
                        (int(time.time()*1000), actor, kind, serial))

    def receive(self, serial, frame, actor):
        with self.lock:
            with self.db:
                device = self.db.execute('SELECT station FROM devices WHERE serial=?', (serial,)).fetchone()
                if not device:
                    raise HTTPException(404, 'Device not enrolled.')
                if device['station'] != actor:
                    raise HTTPException(403, 'Station does not own this device.')
                old = self.db.execute('SELECT * FROM reports WHERE serial=?', (serial,)).fetchone()
                if old and (frame.boot < old['boot'] or (frame.boot == old['boot'] and
                    (frame.sequence <= old['sequence'] or frame.source_time_ms < int(old['source_ms'])))):
                    raise HTTPException(409, 'Duplicate, old boot, sequence or clock regression.')
                self.db.execute('INSERT OR REPLACE INTO reports VALUES(?,?,?,?,?)',
                                (serial, frame.boot, frame.sequence, str(frame.source_time_ms), frame.model_dump_json()))
                self.log(actor, 'measurement', serial)
            # Promote freshness only after the durable transaction succeeds.
            self.received[serial] = self.clock()


    def snapshot(self, actor):
        with self.lock:
            rows = self.db.execute('SELECT d.*,r.body AS sample FROM devices d LEFT JOIN reports r USING(serial) ORDER BY d.serial').fetchall()
            result = []
            for row in rows:
                if actor != 'center' and row['station'] != actor:
                    continue
                age = None if row['serial'] not in self.received else max(0, self.clock()-self.received[row['serial']])
                state = 'unknown' if age is None else 'fresh' if age < 3 else 'stale' if age < 10 else 'disconnected'
                result.append(dict(device=json.loads(row['body']), state=state, age_s=age,
                                   measurement=json.loads(row['sample']) if state == 'fresh' and row['sample'] else None))
            return dict(schema_version=1, actor=actor, received_utc_ms=int(time.time()*1000), devices=result,
                        scope='civilian-equipment-registry; no aircraft commands')


def create_fleet_app(database, credentials, clock=time.monotonic):
    credentials = dict(credentials)
    if set(credentials) != {'center', 'station-a', 'station-b'} or len(set(credentials.values())) != 3 or any(len(k)<24 for k in credentials.values()):
        raise ValueError('Three distinct strong center/station credentials are required.')
    @asynccontextmanager
    async def lifespan(app):
        if str(database) != ':memory:':
            Path(database).parent.mkdir(parents=True, exist_ok=True)
        app.state.registry = Registry(database, clock)
        try:
            yield
        finally:
            app.state.registry.db.close()
    app = FastAPI(title='FLW VECTOR civilian equipment registry', lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost'])
    app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8000','http://localhost:8000'],
                       allow_methods=['GET','POST'], allow_headers=['Authorization','Content-Type'])
    def actor(authorization):
        if not authorization or not authorization.startswith('Bearer '):
            raise HTTPException(401, 'Registry bearer credential required.')
        token = (authorization or '').removeprefix('Bearer ')
        for identity, secret in credentials.items():
            if secrets.compare_digest(token.encode(), secret.encode()):
                return identity
        raise HTTPException(401, 'Invalid registry credential.')
    @app.get('/api/v1/fleet/snapshot')
    def snapshot(authorization: str | None = Header(default=None)):
        return app.state.registry.snapshot(actor(authorization))
    @app.post('/api/v1/fleet/devices', status_code=201)
    def register(device: Device, authorization: str | None = Header(default=None)):
        identity = actor(authorization)
        if identity != 'center':
            raise HTTPException(403, 'Only the center can enroll equipment.')
        try:
            app.state.registry.register(device, identity)
        except sqlite3.IntegrityError:
            raise HTTPException(409, 'Serial number already enrolled.')
        return device
    @app.post('/api/v1/fleet/devices/{serial}/measurements', status_code=202)
    def receive(serial: str, frame: Measurement, authorization: str | None = Header(default=None)):
        identity = actor(authorization)
        if identity == 'center':
            raise HTTPException(403, 'The center cannot publish station measurements.')
        app.state.registry.receive(serial, frame, identity)
        return {'accepted': True}
    @app.get('/api/v1/fleet/audit')
    def audit(authorization: str | None = Header(default=None)):
        if actor(authorization) != 'center':
            raise HTTPException(403, 'Only the center can inspect the registry audit.')
        with app.state.registry.lock:
            return [dict(row) for row in app.state.registry.db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 500')]
    return app


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.runtime/fleet'))
    parser.add_argument('--init', action='store_true')
    args = parser.parse_args()
    config = args.directory/'credentials.json'
    if args.init:
        args.directory.mkdir(parents=True, exist_ok=True)
        if any((args.directory/name).exists() for name in ('credentials.json','center.token','station-a.token','station-b.token')):
            raise FileExistsError('Credential files already exist; no secrets were overwritten.')
        values = {k:secrets.token_urlsafe(32) for k in ('center','station-a','station-b')}
        with config.open('x', encoding='utf-8') as file:
            json.dump(values, file)
        config.chmod(0o600)
        for identity, secret in values.items():
            target = args.directory/(identity+'.token')
            with target.open('x', encoding='utf-8') as output:
                output.write(secret)
            target.chmod(0o600)
        print(f'Created local credential file: {config.resolve()}. Keep private; do not commit.')
        return
    credentials = json.loads(config.read_text(encoding='utf-8'))
    import uvicorn
    uvicorn.run(create_fleet_app(args.directory/'registry.sqlite3',credentials),host='127.0.0.1',port=8770,access_log=False)


if __name__ == '__main__':
    main()
