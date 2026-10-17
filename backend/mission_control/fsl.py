"""FSL v1 civilian reports: mTLS-bound sessions and transactional deduplication."""
import json
import secrets
import time
from typing import Literal
from uuid import UUID
from fastapi import HTTPException, Request
from pydantic import Field, ValidationError, field_validator
from .fleet_service import Strict, Measurement

class FSLMeasurement(Measurement):
    @field_validator('source_time_ms', mode='before')
    @classmethod
    def precision(cls, value):
        if isinstance(value, str) and value.isascii() and value.isdecimal() and (value == '0' or not value.startswith('0')):
            return int(value)
        if type(value) is not int or value > 9007199254740991:
            raise ValueError('Large source clock requires a canonical decimal string.')
        return value


class Envelope(Strict):
    protocol: Literal['FSL']
    version: Literal[1]
    message_id: UUID
    session_id: str = Field(min_length=32, max_length=64)
    station_id: Literal['station-a', 'station-b']
    device_id: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    sequence: str = Field(pattern=r'^(0|[1-9][0-9]{0,19})$')
    type: Literal['equipment.report']
    payload: FSLMeasurement

    @field_validator('version', mode='before')
    @classmethod
    def strict_version(cls, value):
        if type(value) is not int:
            raise ValueError('Version must be an integer.')
        return value

    @field_validator('sequence')
    @classmethod
    def counter(cls, value):
        if int(value) > 18446744073709551615:
            raise ValueError('Sequence exceeds uint64.')
        return value

def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON key.')
        result[key] = value
    return result

async def decode(request):
    body = bytearray()
    async for chunk in request.stream():
        if len(body)+len(chunk) > 16384:
            raise HTTPException(413, 'FSL body exceeds 16 KiB.')
        body.extend(chunk)
    try:
        return Envelope.model_validate(json.loads(body.decode('utf-8'), object_pairs_hook=unique_pairs,
            parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON.'))))
    except (ValueError, UnicodeError, ValidationError):
        raise HTTPException(422, 'Invalid FSL v1 envelope.')

def install(app):
    def tables(registry):
        # Separate additive schema; legacy registry format is unchanged.
        registry.db.execute('CREATE TABLE IF NOT EXISTS fsl_schema(version INTEGER PRIMARY KEY)')
        version = registry.db.execute('SELECT version FROM fsl_schema').fetchall()
        if version and [row[0] for row in version] != [1]:
            raise HTTPException(503, 'Unsupported FSL storage schema.')
        registry.db.execute('INSERT OR IGNORE INTO fsl_schema VALUES(1)')
        registry.db.execute('CREATE TABLE IF NOT EXISTS fsl_sessions(id TEXT PRIMARY KEY, actor TEXT, peer TEXT, issued REAL, expires REAL)')
        registry.db.execute('CREATE TABLE IF NOT EXISTS fsl_messages(session TEXT, id TEXT, device TEXT, sequence TEXT, body TEXT, outcome TEXT, PRIMARY KEY(session,id))')
        registry.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS fsl_counter ON fsl_messages(session,device,sequence)')

    def identity(request):
        peer = request.scope.get('flw_peer')
        validate = request.scope.get('flw_authorize')
        actor = validate(peer, request.scope.get('flw_peer_expires')) if validate else None
        if actor not in ('station-a', 'station-b') or not peer:
            raise HTTPException(403, 'FSL requires an authenticated station certificate.')
        return actor, peer

    @app.post('/api/v1/fsl/sessions', status_code=201)
    def session(request: Request):
        actor, peer = identity(request)
        registry = app.state.registry
        now = time.time()
        expires = min(now+900, request.scope['flw_peer_expires'].timestamp())
        with registry.lock, registry.db:
            tables(registry)
            # Expired session/replay rows are deleted together; valid evidence is retained.
            registry.db.execute('DELETE FROM fsl_messages WHERE session IN (SELECT id FROM fsl_sessions WHERE expires<=?)', (now,))
            registry.db.execute('DELETE FROM fsl_sessions WHERE expires<=?', (now,))
            if registry.db.execute('SELECT COUNT(*) FROM fsl_sessions WHERE actor=?', (actor,)).fetchone()[0] >= 8:
                raise HTTPException(429, 'Station session limit reached.')
            identifier = secrets.token_urlsafe(32)
            registry.db.execute('INSERT INTO fsl_sessions VALUES(?,?,?,?,?)', (identifier, actor, peer, now, expires))
        return dict(protocol='FSL', version=1, session_id=identifier, expires_utc_ms=int(expires*1000))

    @app.post('/api/v1/fsl/reports')
    async def report(request: Request):
        envelope = await decode(request)
        actor, peer = identity(request)
        if envelope.station_id != actor:
            raise HTTPException(403, 'Station identity mismatch.')
        registry = app.state.registry
        body = envelope.model_dump_json()
        identifier = str(envelope.message_id)
        with registry.lock:
            with registry.db:
                tables(registry)
                session = registry.db.execute('SELECT * FROM fsl_sessions WHERE id=?', (envelope.session_id,)).fetchone()
                now = time.time()
                if not session or session['actor'] != actor or session['peer'] != peer or not session['issued'] <= now < session['expires']:
                    raise HTTPException(403, 'Session unavailable or expired.')
                device = registry.db.execute('SELECT station FROM devices WHERE serial=?', (envelope.device_id,)).fetchone()
                if not device or device['station'] != actor:
                    raise HTTPException(403, 'Device is not assigned to this station.')
                old = registry.db.execute('SELECT * FROM fsl_messages WHERE session=? AND id=?', (envelope.session_id, identifier)).fetchone()
                if old:
                    if old['body'] != body:
                        raise HTTPException(409, 'Message ID reused with different content.')
                    return dict(json.loads(old['outcome']), status='duplicate-known')
                last = registry.db.execute('SELECT sequence FROM fsl_messages WHERE session=? AND device=? ORDER BY length(sequence) DESC, sequence DESC LIMIT 1', (envelope.session_id, envelope.device_id)).fetchone()
                if last and int(last[0]) >= int(envelope.sequence):
                    raise HTTPException(409, 'Sequence already consumed or regressed.')
                if registry.db.execute('SELECT COUNT(*) FROM fsl_messages WHERE session=?', (envelope.session_id,)).fetchone()[0] >= 10000:
                    raise HTTPException(429, 'Session report limit reached; request a new session.')
                registry.write_measurement(envelope.device_id, envelope.payload, actor)
                outcome = dict(protocol='FSL', version=1, status='accepted-new', message_id=identifier, received_utc_ms=int(time.time()*1000))
                registry.db.execute('INSERT INTO fsl_messages VALUES(?,?,?,?,?,?)', (envelope.session_id, identifier, envelope.device_id, envelope.sequence, body, json.dumps(outcome)))
            registry.received[envelope.device_id] = registry.clock()
        return outcome
