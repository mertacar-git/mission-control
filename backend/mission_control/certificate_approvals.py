"""Session-bound human approval for offline station activation. Never signs certificates."""
import json
import sqlite3
import time
from pathlib import Path
from typing import Literal
from uuid import uuid4
from pydantic import Field
from cryptography.hazmat.primitives import hashes
from .fleet_service import Strict
from .fleet_tls import identity_lock
from .identity_audit import registry_state, ensure_mutation_allowed, replace_identity
from .station_enrollment import validate_certificate_bytes, read_public


class CertificateReview(Strict):
    station_id: Literal['station-a','station-b']
    certificate_pem: str = Field(min_length=1,max_length=16384,repr=False)


class CertificateApproval(CertificateReview):
    expected_fingerprints: list[str] = Field(min_length=1,max_length=20)
    expected_new_fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')
    reason: str = Field(min_length=5,max_length=300)


def initialize(accounts):
    versions=accounts.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='certificate_approval_schema'").fetchone()
    if versions and [row[0] for row in accounts.db.execute('SELECT version FROM certificate_approval_schema')]!=[1]:
        raise ValueError('Unsupported certificate approval schema.')
    accounts.db.executescript('''
        CREATE TABLE IF NOT EXISTS certificate_approval_schema(version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO certificate_approval_schema VALUES(1);
        CREATE TABLE IF NOT EXISTS certificate_approvals(
            id TEXT PRIMARY KEY, station TEXT NOT NULL, fingerprint TEXT NOT NULL,
            old_fingerprints TEXT NOT NULL, certificate TEXT NOT NULL, reason TEXT NOT NULL,
            username TEXT NOT NULL, session_digest TEXT NOT NULL, issued REAL NOT NULL,
            expires REAL NOT NULL, state TEXT NOT NULL, operation_id TEXT);
    ''')


def review(directory,body):
    cert=validate_certificate_bytes(body.certificate_pem.encode('utf-8'),read_public(directory/'ca.crt'),body.station_id)
    fingerprint=cert.fingerprint(hashes.SHA256()).hex()
    identities,revoked=registry_state(directory)
    ensure_mutation_allowed(directory)
    previous=sorted(key for key,value in identities.items() if value==body.station_id)
    if not previous or fingerprint in identities or fingerprint in revoked:
        raise ValueError('Certificate is already assigned, revoked, or the station is not enrolled.')
    return cert,dict(station_id=body.station_id,new_fingerprint=fingerprint,old_fingerprints=previous,
                    expires_utc=cert.not_valid_after_utc.isoformat())


def public_row(row,db,now):
    session=db.execute('SELECT s.issued,s.expires,u.active,u.role FROM sessions s JOIN users u USING(username) WHERE s.digest=? AND s.username=?',(row['session_digest'],row['username'])).fetchone()
    usable=bool(session and session['active'] and session['role']=='admin' and session['issued']<=now<session['expires'])
    state=row['state']
    if state=='approved':
        if not row['issued']<=now<row['expires']:state='expired'
        elif not usable:state='authorization_revoked'
    return dict(id=row['id'],station_id=row['station'],new_fingerprint=row['fingerprint'],old_fingerprints=json.loads(row['old_fingerprints']),
        reason=row['reason'],approved_by=row['username'],issued_utc_ms=int(row['issued']*1000),expires_utc_ms=int(row['expires']*1000),state=state,operation_id=row['operation_id'])


def activate_approved(directory,database,identifier,clock=time.time):
    """Uses only an existing local approval DB; consumes before touching the identity map."""
    database=Path(database)
    if not database.is_file():raise ValueError('Existing approval account database required.')
    db=sqlite3.connect(database.resolve().as_uri()+'?mode=rw',uri=True);db.row_factory=sqlite3.Row
    try:
        if [row[0] for row in db.execute('SELECT version FROM certificate_approval_schema')]!=[1]:raise ValueError('Unsupported approval schema.')
        with identity_lock(directory/'identity-update.lock'):
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM certificate_approvals WHERE id=?',(identifier,)).fetchone()
            if row is None or public_row(row,db,clock())['state']!='approved':raise ValueError('Approval unavailable, expired, revoked or already consumed.')
            body=CertificateReview(station_id=row['station'],certificate_pem=row['certificate'])
            cert,checked=review(directory,body)
            if checked['old_fingerprints']!=json.loads(row['old_fingerprints']) or checked['new_fingerprint']!=row['fingerprint']:
                raise ValueError('Identity mapping changed; a new review and approval are required.')
            db.execute("UPDATE certificate_approvals SET state='consumed' WHERE id=?",(identifier,))
            db.execute('INSERT INTO audit(utc_ms,actor,event,subject) VALUES(?,?,?,?)',(int(clock()*1000),row['username'],'certificate.approval.consumed',identifier))
            db.commit() # Durable single-use boundary precedes file mutation.
            db.execute('BEGIN IMMEDIATE')
            # Hold the account write transaction through the mapping change, so
            # disabling the account/session cannot race this final decision.
            if public_row(dict(row,state='approved'),db,clock())['state']!='approved':
                db.execute("UPDATE certificate_approvals SET state='authorization_revoked' WHERE id=?",(identifier,))
                db.execute('INSERT INTO audit(utc_ms,actor,event,subject) VALUES(?,?,?,?)',(int(clock()*1000),row['username'],'certificate.approval.authorization_revoked',identifier))
                db.commit()
                raise ValueError('Approval authorization expired before activation.')
            try:
                identities,_=registry_state(directory)
                operation=replace_identity(directory,identities,row['station'],cert,'activate')
            except Exception:
                db.execute("UPDATE certificate_approvals SET state='unknown' WHERE id=?",(identifier,))
                db.execute('INSERT INTO audit(utc_ms,actor,event,subject) VALUES(?,?,?,?)',(int(clock()*1000),row['username'],'certificate.activation.unknown',identifier))
                db.commit()
                raise RuntimeError('Approval consumed; activation result is unconfirmed. Inspect the identity journal; do not retry this approval.') from None
            try:
                db.execute("UPDATE certificate_approvals SET state='applied',operation_id=? WHERE id=?",(operation,identifier))
                db.execute('INSERT INTO audit(utc_ms,actor,event,subject) VALUES(?,?,?,?)',(int(clock()*1000),row['username'],'certificate.activation.applied',identifier))
                db.commit()
            except Exception:
                db.rollback()
                raise RuntimeError('Identity mapping may have changed; approval remains consumed. Inspect the identity journal; do not retry.') from None
            return dict(approval_id=identifier,operation_id=operation,state='applied',approved_by=row['username'])
    finally:db.close()


def install(app,directory):
    from fastapi import Request
    from .operator_accounts import OperatorError,digest
    from .fsl import unique_pairs
    async def body(request,model):
        data=bytearray()
        async for chunk in request.stream():
            if len(data)+len(chunk)>20000:raise OperatorError(413,'Public certificate request exceeds limit.','approval_invalid')
            data.extend(chunk)
        try:return model.model_validate(json.loads(data,object_pairs_hook=unique_pairs))
        except (ValueError,UnicodeError):raise OperatorError(422,'Invalid public certificate request.','approval_invalid') from None
    def configured():
        if directory is None:raise OperatorError(503,'Certificate directory unavailable.','approval_unavailable')
    @app.get('/api/v1/operators/station-approvals')
    def approvals(request:Request):
        accounts=app.state.accounts
        with accounts.lock:
            accounts.authenticate(request.headers.get('authorization'),admin=True)
            return [public_row(row,accounts.db,accounts.clock()) for row in accounts.db.execute('SELECT * FROM certificate_approvals ORDER BY issued DESC LIMIT 100')]
    @app.post('/api/v1/operators/station-approvals/preview')
    async def preview(request:Request):
        accounts=app.state.accounts
        accounts.authenticate(request.headers.get('authorization'),admin=True);configured()
        candidate=await body(request,CertificateReview)
        try:
            with identity_lock(directory/'identity-update.lock'):
                _,result=review(directory,candidate)
            return result
        except FileExistsError:raise OperatorError(409,'Identity operation busy.','approval_busy') from None
        except Exception:raise OperatorError(422,'Public certificate or identity state was rejected.','approval_invalid') from None
    @app.post('/api/v1/operators/station-approvals',status_code=201)
    async def approve(request:Request):
        accounts=app.state.accounts;authorization=request.headers.get('authorization')
        accounts.authenticate(authorization,admin=True);configured()
        candidate=await body(request,CertificateApproval)
        try:
            with accounts.lock,identity_lock(directory/'identity-update.lock'):
                actor=accounts.authenticate(authorization,admin=True)
                _,checked=review(directory,candidate)
                if checked['old_fingerprints']!=candidate.expected_fingerprints or checked['new_fingerprint']!=candidate.expected_new_fingerprint:
                    raise OperatorError(409,'Review no longer matches the identity mapping.','approval_stale')
                with accounts.db:
                    if accounts.db.execute('SELECT COUNT(*) FROM certificate_approvals').fetchone()[0]>=10000:
                        raise OperatorError(429,'Approval archive limit reached.','approval_limit')
                    identifier=str(uuid4());now=accounts.clock()
                    session=accounts.db.execute('SELECT expires FROM sessions WHERE digest=?',(digest(authorization.removeprefix('Bearer ')),)).fetchone()
                    expires=min(now+900,session['expires'])
                    accounts.db.execute('INSERT INTO certificate_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',
                        (identifier,candidate.station_id,checked['new_fingerprint'],json.dumps(checked['old_fingerprints']),candidate.certificate_pem,candidate.reason,actor['username'],digest(authorization.removeprefix('Bearer ')),now,expires,'approved'))
                    accounts.log(actor['username'],'certificate.approval.created',identifier)
                return public_row(accounts.db.execute('SELECT * FROM certificate_approvals WHERE id=?',(identifier,)).fetchone(),accounts.db,now)
        except OperatorError:raise
        except FileExistsError:raise OperatorError(409,'Identity operation busy.','approval_busy') from None
        except Exception:raise OperatorError(422,'Certificate approval was rejected.','approval_invalid') from None
