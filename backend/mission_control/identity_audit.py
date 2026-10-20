"""Local offline identity-change journal. No signing service or human-account approval."""
import getpass
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from pydantic import Field
from .fleet_service import Strict

MAX_BYTES=2*1024*1024
FINGERPRINT=re.compile(r'^[0-9a-f]{64}$')

class AuditEvent(Strict):
    schema_version: Literal[1] = 1
    operation_id: str = Field(pattern=r'^[0-9a-f-]{36}$')
    utc_ms: int = Field(ge=0,strict=True)
    action: Literal['activate','renew']
    phase: Literal['intent','applied','failed','observed_mapped','observed_not_mapped']
    identity: Literal['station-a','station-b']
    actor_source: Literal['offline-os'] = 'offline-os'
    os_user: str = Field(min_length=1,max_length=80)
    old_fingerprints: list[str] = Field(max_length=20)
    new_fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')


class IdentityStatus(Strict):
    identity: Literal['center','station-a','station-b']
    fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')
    state: Literal['unavailable','valid','expired','not_yet_valid','expires_soon','revoked']
    expires_utc: str | None


class IdentitySnapshot(Strict):
    schema_version: Literal[1]
    scope: Literal['offline-certificate-audit']
    human_approval: Literal[False]
    evaluated_utc_ms: int
    identities: list[IdentityStatus]
    operations: list[AuditEvent]
    total_operations: int
    pending_operations: int
    audit_present: bool


def read_events(directory):
    path=directory/'identity-audit.jsonl'
    if not path.exists():return []
    if path.stat().st_size>MAX_BYTES:raise ValueError('Identity audit exceeds its local read limit.')
    rows=[];operations={}
    with path.open(encoding='utf-8') as source:
        for line in source:
            event=AuditEvent.model_validate_json(line).model_dump()
            if any(not FINGERPRINT.fullmatch(value) for value in event['old_fingerprints']):raise ValueError('Invalid old fingerprint.')
            previous=operations.get(event['operation_id'])
            if event['phase']=='intent':
                if previous:raise ValueError('Duplicate identity audit intent.')
            elif not previous or previous['phase']!='intent' or any(event[key]!=previous[key] for key in ('action','identity','old_fingerprints','new_fingerprint')):
                raise ValueError('Invalid identity audit transition.')
            operations[event['operation_id']]=event
            rows.append(event)
    return rows


def append_event(directory,event):
    # Validate existing data before append; never silently skip a damaged audit row.
    read_events(directory)
    path=directory/'identity-audit.jsonl'
    body=(AuditEvent.model_validate(event).model_dump_json()+'\n').encode('utf-8')
    if (path.stat().st_size if path.exists() else 0)+len(body)>MAX_BYTES:
        raise ValueError('Identity audit is full; perform explicit offline archival.')
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT,0o600),'ab') as stream:
        stream.write(body);stream.flush();os.fsync(stream.fileno())


def latest_events(events):
    return {row['operation_id']:row for row in events}


def ensure_mutation_allowed(directory):
    if any(event['phase']=='intent' for event in latest_events(read_events(directory)).values()):
        raise RuntimeError('Incomplete identity operation requires offline audit reconciliation before another change.')


def registry_state(directory):
    identities=json.loads((directory/'identities.json').read_text(encoding='utf-8'))
    revoked=json.loads((directory/'revoked.json').read_text(encoding='utf-8'))
    if not isinstance(identities,dict) or len(identities)>100 or not isinstance(revoked,list) or len(revoked)>10000:
        raise ValueError('Invalid identity registry.')
    if any(not FINGERPRINT.fullmatch(key) or value not in ('center','station-a','station-b') for key,value in identities.items()):
        raise ValueError('Invalid identity mapping.')
    if any(not isinstance(value,str) or not FINGERPRINT.fullmatch(value) for value in revoked):raise ValueError('Invalid revocation registry.')
    return identities,revoked


def write_mapping(directory,identities):
    temporary=directory/('identities-'+secrets.token_hex(8)+'.tmp')
    try:
        with temporary.open('x',encoding='utf-8') as stream:
            json.dump(identities,stream);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,directory/'identities.json')
    finally:temporary.unlink(missing_ok=True)


def replace_identity(directory,identities,actor,certificate,action):
    """Caller holds the existing identity-update lock and validated the certificate."""
    current,revoked=registry_state(directory)
    if current!=identities:raise ValueError('Identity registry changed before replacement.')
    ensure_mutation_allowed(directory)
    fingerprint=certificate.fingerprint(hashes.SHA256()).hex()
    if fingerprint in revoked:raise ValueError('Certificate is revoked.')
    old=sorted(key for key,value in identities.items() if value==actor)
    if not old or len(old)>20 or fingerprint in identities:raise ValueError('Invalid station identity replacement.')
    desired={key:value for key,value in identities.items() if value!=actor};desired[fingerprint]=actor
    event=AuditEvent(operation_id=str(uuid4()),utc_ms=int(time.time()*1000),action=action,phase='intent',identity=actor,
        os_user=(getpass.getuser() or 'unknown')[:80],old_fingerprints=old,new_fingerprint=fingerprint).model_dump()
    append_event(directory,event) # A failed intent write must prevent identity mutation.
    try:
        archive=directory/'public-certificates';archive.mkdir(exist_ok=True,mode=0o700)
        path=archive/(fingerprint+'.crt');body=certificate.public_bytes(serialization.Encoding.PEM)
        if path.exists():
            if path.read_bytes()!=body:raise ValueError('Public certificate archive mismatch.')
        else:
            with path.open('xb') as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
        write_mapping(directory,desired)
    except Exception:
        try:
            current,_=registry_state(directory)
            if current!=identities:raise RuntimeError('Identity outcome unknown.')
            append_event(directory,dict(event,phase='failed',utc_ms=int(time.time()*1000)))
        except Exception:
            raise RuntimeError('Identity outcome or audit completion unknown; inspect mapping and reconcile before retrying.') from None
        raise RuntimeError('Identity update failed; previous mapping was observed unchanged.') from None
    try:append_event(directory,dict(event,phase='applied',utc_ms=int(time.time()*1000)))
    except Exception:
        raise RuntimeError('Identity changed but audit completion was not confirmed; reconcile before retrying.') from None
    return event['operation_id']


def reconcile(directory):
    from .fleet_tls import identity_lock
    with identity_lock(directory/'identity-update.lock'):
        identities,_=registry_state(directory);count=0
        for event in latest_events(read_events(directory)).values():
            if event['phase']!='intent':continue
            mapped=identities.get(event['new_fingerprint'])==event['identity']
            append_event(directory,dict(event,phase='observed_mapped' if mapped else 'observed_not_mapped',utc_ms=int(time.time()*1000),os_user=(getpass.getuser() or 'unknown')[:80]))
            count+=1
        return count


def snapshot(directory):
    from .fleet_tls import identity_lock
    with identity_lock(directory/'identity-update.lock'):
        identities,revoked=registry_state(directory)
        events=read_events(directory)
        now=datetime.now(timezone.utc);rows=[]
        for fingerprint,actor in sorted(identities.items(),key=lambda item:(item[1],item[0])):
            certificate=None
            for path in (directory/'public-certificates'/(fingerprint+'.crt'),directory/(actor+'.crt')):
                if not path.is_file():continue
                if path.stat().st_size>16384:raise ValueError('Public certificate exceeds limit.')
                candidate=x509.load_pem_x509_certificate(path.read_bytes())
                if candidate.fingerprint(hashes.SHA256()).hex()==fingerprint:certificate=candidate;break
            state='unavailable';expires=None
            if certificate:
                expires=certificate.not_valid_after_utc.isoformat()
                state='expired' if now>=certificate.not_valid_after_utc else 'not_yet_valid' if now<certificate.not_valid_before_utc else 'expires_soon' if (certificate.not_valid_after_utc-now).total_seconds()<86400 else 'valid'
            if fingerprint in revoked:state='revoked'
            rows.append(dict(identity=actor,fingerprint=fingerprint,state=state,expires_utc=expires))
        operations=list(latest_events(events).values())
        return dict(schema_version=1,scope='offline-certificate-audit',human_approval=False,evaluated_utc_ms=int(now.timestamp()*1000),identities=rows,
            operations=list(reversed(operations[-100:])),total_operations=len(operations),
            pending_operations=sum(row['phase']=='intent' for row in operations),audit_present=(directory/'identity-audit.jsonl').exists())
