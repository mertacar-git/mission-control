"""Independent local HTTPS human accounts. No aircraft or station credential API."""
import argparse
import getpass
import hashlib
import secrets
import sqlite3
import ssl
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse
from pydantic import Field
from .fleet_service import Strict
from .key_custody import key_password
from .fleet_service import Device


class OperatorError(HTTPException):
    def __init__(self, status, detail, code):
        super().__init__(status, detail)
        self.code = code


class Login(Strict):
    username: str = Field(pattern=r'^[a-z][a-z0-9_-]{2,39}$')
    password: str = Field(min_length=15, max_length=128, repr=False)


class NewUser(Login):
    role: Literal['admin', 'operator']


class PasswordChange(Strict):
    current_password: str = Field(min_length=1, max_length=128, repr=False)
    new_password: str = Field(min_length=15, max_length=128, repr=False)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=131072, r=8, p=1,
                          maxmem=256*1024*1024, dklen=32)


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Accounts:
    def __init__(self, database, clock=time.time):
        self.clock, self.lock = clock, threading.RLock()
        self.db = sqlite3.connect(str(database), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version not in (0, 1):
            self.db.close()
            raise ValueError('Unsupported account schema.')
        self.db.executescript('''PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY, role TEXT, salt BLOB, hash BLOB, active INTEGER);
            CREATE TABLE IF NOT EXISTS sessions(digest TEXT PRIMARY KEY, username TEXT, issued REAL, expires REAL);
            CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, utc_ms INTEGER, actor TEXT, event TEXT, subject TEXT);
            CREATE TABLE IF NOT EXISTS failures(username TEXT PRIMARY KEY, count INTEGER, until REAL);
            PRAGMA user_version=1;''')
        from .certificate_approvals import initialize as initialize_approvals
        try:
            initialize_approvals(self)
        except Exception:
            self.db.close()
            raise
        # Same cost for unknown users; no plaintext dummy password is persisted.
        self.dummy_salt, self.dummy_hash = secrets.token_bytes(16), secrets.token_bytes(32)

    def log(self, actor, event, subject=''):
        self.db.execute('INSERT INTO audit(utc_ms,actor,event,subject) VALUES(?,?,?,?)',
                        (int(self.clock()*1000), actor, event, subject))

    def create(self, user, actor):
        with self.lock, self.db:
            if self.db.execute('SELECT COUNT(*) FROM users').fetchone()[0] >= 100:
                raise HTTPException(429, 'Local account limit reached.')
            salt = secrets.token_bytes(16)
            hashed = password_hash(user.password, salt)
            try:
                self.db.execute('INSERT INTO users VALUES(?,?,?,?,1)', (user.username, user.role, salt, hashed))
            except sqlite3.IntegrityError:
                raise HTTPException(409, 'Username already exists.')
            self.log(actor, 'user.created', user.username)

    def login(self, credentials):
        # Serialize expensive KDF calls to bound concurrent memory consumption.
        with self.lock:
            now = self.clock()
            failure = self.db.execute('SELECT * FROM failures WHERE username=?', (credentials.username,)).fetchone()
            if failure and failure['count'] >= 5 and now < failure['until']:
                raise HTTPException(429, 'Login temporarily rate limited.')
            user = self.db.execute('SELECT * FROM users WHERE username=?', (credentials.username,)).fetchone()
            valid = secrets.compare_digest(password_hash(credentials.password, user['salt'] if user else self.dummy_salt), user['hash'] if user else self.dummy_hash)
            with self.db:
                self.db.execute('DELETE FROM failures WHERE until<=?', (now,))
                if not valid or not user or not user['active']:
                    if self.db.execute('SELECT COUNT(*) FROM failures').fetchone()[0] >= 1000 and not failure:
                        raise HTTPException(429, 'Login temporarily rate limited.')
                    self.db.execute('INSERT INTO failures VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET count=count+1', (credentials.username, now+300))
                    self.log(user['username'] if user else 'unknown', 'login.denied')
                else:
                    self.db.execute('DELETE FROM failures WHERE username=?', (credentials.username,))
                    self.db.execute('DELETE FROM sessions WHERE expires<=?', (now,))
                    if self.db.execute('SELECT COUNT(*) FROM sessions WHERE username=?', (user['username'],)).fetchone()[0] >= 8:
                        raise HTTPException(429, 'Active session limit reached.')
                    token = secrets.token_urlsafe(32)
                    self.db.execute('INSERT INTO sessions VALUES(?,?,?,?)', (digest(token), user['username'], now, now+900))
                    self.log(user['username'], 'login.accepted')
            if not valid or not user or not user['active']:
                raise HTTPException(401, 'Invalid credentials.')
            return dict(token=token, token_type='Bearer', expires_utc_ms=int((now+900)*1000), username=user['username'], role=user['role'])

    def authenticate(self, authorization, admin=False):
        with self.lock:
            token = authorization.removeprefix('Bearer ') if authorization and authorization.startswith('Bearer ') else ''
            row = self.db.execute('SELECT s.*,u.role,u.active FROM sessions s JOIN users u USING(username) WHERE digest=?', (digest(token),)).fetchone()
            if not row or not row['active'] or not row['issued'] <= self.clock() < row['expires']:
                raise HTTPException(401, 'Session unavailable or expired.')
            if admin and row['role'] != 'admin':
                with self.db:
                    self.log(row['username'], 'authorization.denied')
                raise HTTPException(403, 'Administrator required.')
            return dict(username=row['username'], role=row['role'])


def create_operator_app(database, clock=time.time, tls_directory=None, registry_origin='https://127.0.0.1:8771', static_directory=None, serial_token_file=None, prototype_file=None):
    from urllib.parse import urlparse
    target = urlparse(registry_origin)
    if target.scheme != 'https' or target.hostname != '127.0.0.1' or target.path or target.query or target.fragment or target.username:
        raise ValueError('Operator gateway requires a fixed loopback HTTPS registry origin.')
    @asynccontextmanager
    async def lifespan(app):
        Path(database).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        app.state.accounts = Accounts(database, clock)
        app.state.registry_client = None
        app.state.serial_client = None
        try:
            if serial_token_file is not None:
                import httpx
                from .key_custody import read_secret
                app.state.serial_client = httpx.AsyncClient(base_url='http://127.0.0.1:8767',
                    headers={'Authorization':'Bearer '+read_secret(serial_token_file)}, trust_env=False, follow_redirects=False, timeout=3)
            if tls_directory is not None:
                import httpx
                context = ssl.create_default_context(cafile=str(tls_directory/'ca.crt'))
                context.minimum_version = ssl.TLSVersion.TLSv1_3
                key = tls_directory/'center.key'
                context.load_cert_chain(str(tls_directory/'center.crt'), str(key), password=key_password(key))
                app.state.registry_client = httpx.Client(base_url=registry_origin, verify=context, trust_env=False, follow_redirects=False, timeout=3)
            yield
        finally:
            if app.state.serial_client is not None:
                await app.state.serial_client.aclose()
            if app.state.registry_client is not None:
                app.state.registry_client.close()
            app.state.accounts.db.close()
    app = FastAPI(title='FLW VECTOR local human accounts', lifespan=lifespan)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['localhost', '127.0.0.1'])
    app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:8000','http://localhost:8000'],
                       allow_methods=['GET','POST','DELETE'], allow_headers=['Authorization','Content-Type','X-Control-Session'])
    @app.exception_handler(RequestValidationError)
    async def invalid_input(request, exception):
        # FastAPI's default error can echo rejected password input.
        return JSONResponse({'detail': 'Invalid account request.'}, status_code=422)

    @app.exception_handler(HTTPException)
    async def operator_error(request, exception):
        codes = {401: 'session_expired', 403: 'permission_denied', 429: 'rate_limited'}
        code = getattr(exception, 'code', codes.get(exception.status_code, 'request_rejected'))
        if exception.detail == 'Invalid credentials.':
            code = 'invalid_credentials'
        return JSONResponse({'detail': exception.detail, 'code': code}, status_code=exception.status_code)
    @app.middleware('http')
    async def headers(request, call_next):
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        return response
    @app.post('/api/v1/operators/login')
    def login(credentials: Login):
        return app.state.accounts.login(credentials)
    @app.get('/api/v1/operators/me')
    def me(authorization: str | None = Header(default=None)):
        return app.state.accounts.authenticate(authorization)
    @app.post('/api/v1/operators/logout')
    def logout(authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock, accounts.db:
            actor = accounts.authenticate(authorization)
            accounts.db.execute('DELETE FROM sessions WHERE digest=?', (digest(authorization.removeprefix('Bearer ')),))
            accounts.log(actor['username'], 'logout')
        return {'logged_out': True}
    @app.post('/api/v1/operators/users', status_code=201)
    def create(user: NewUser, authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock:
            actor = accounts.authenticate(authorization, admin=True)
            accounts.create(user, actor['username'])
        return dict(username=user.username, role=user.role)
    @app.get('/api/v1/operators/users')
    def users(authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock:
            accounts.authenticate(authorization, admin=True)
            return [dict(username=row['username'], role=row['role'], active=bool(row['active']))
                    for row in accounts.db.execute('SELECT username,role,active FROM users ORDER BY username')]
    @app.post('/api/v1/operators/password')
    def change_password(change: PasswordChange, authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock:
            actor = accounts.authenticate(authorization)
            now = accounts.clock()
            counter_key = 'password:'+actor['username']
            failure = accounts.db.execute('SELECT * FROM failures WHERE username=?', (counter_key,)).fetchone()
            if failure and failure['count'] >= 5 and now < failure['until']:
                raise HTTPException(429, 'Password change temporarily rate limited.')
            user = accounts.db.execute('SELECT salt,hash FROM users WHERE username=?', (actor['username'],)).fetchone()
            valid = secrets.compare_digest(password_hash(change.current_password, user['salt']), user['hash'])
            with accounts.db:
                if not valid:
                    accounts.db.execute('DELETE FROM failures WHERE username=? AND until<=?', (counter_key,now))
                    accounts.db.execute('INSERT INTO failures VALUES(?,1,?) ON CONFLICT(username) DO UPDATE SET count=count+1', (counter_key,now+300))
                    accounts.log(actor['username'], 'password.change.denied')
                elif change.current_password != change.new_password:
                    salt = secrets.token_bytes(16)
                    hashed = password_hash(change.new_password, salt)
                    accounts.db.execute('UPDATE users SET salt=?,hash=? WHERE username=?', (salt,hashed,actor['username']))
                    accounts.db.execute('DELETE FROM sessions WHERE username=?', (actor['username'],))
                    accounts.db.execute('DELETE FROM failures WHERE username IN (?,?)', (actor['username'],counter_key))
                    accounts.log(actor['username'], 'password.changed')
            if not valid:
                raise HTTPException(403, 'Current password was not verified.')
            if change.current_password == change.new_password:
                raise HTTPException(409, 'New password must differ.')
        return {'password_changed': True, 'reauthentication_required': True}
    @app.post('/api/v1/operators/users/{username}/disable')
    def disable(username: str, authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock:
            actor = accounts.authenticate(authorization, admin=True)
            if username == actor['username']:
                raise HTTPException(409, 'Self-disable is not supported.')
            target = accounts.db.execute('SELECT role FROM users WHERE username=?', (username,)).fetchone()
            if not target:
                raise HTTPException(404, 'User unavailable.')
            with accounts.db:
                accounts.db.execute('UPDATE users SET active=0 WHERE username=?', (username,))
                accounts.db.execute('DELETE FROM sessions WHERE username=?', (username,))
                accounts.log(actor['username'], 'user.disabled', username)
        return {'disabled': True}
    @app.get('/api/v1/operators/audit')
    def audit(authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock:
            accounts.authenticate(authorization, admin=True)
            return [dict(row) for row in accounts.db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 500')]
    from .identity_audit import IdentitySnapshot, snapshot as identity_snapshot
    @app.get('/api/v1/operators/station-identities', response_model=IdentitySnapshot)
    def station_identities(authorization: str | None = Header(default=None)):
        app.state.accounts.authenticate(authorization, admin=True)
        if tls_directory is None:
            raise OperatorError(503, 'Certificate directory is not configured.', 'identity_audit_unavailable')
        try:
            return identity_snapshot(tls_directory)
        except FileExistsError:
            raise OperatorError(409, 'An offline identity operation is active or requires lock recovery.', 'identity_operation_busy') from None
        except (OSError,ValueError,TypeError,KeyError):
            raise OperatorError(503, 'Certificate registry or audit is unreadable; no verified snapshot.', 'identity_audit_unavailable') from None

    def registry_request(method, path, payload=None):
        import httpx
        client = app.state.registry_client
        if client is None:
            raise OperatorError(503, 'Registry gateway is not configured.', 'registry_unavailable')
        try:
            response = client.request(method, path, json=payload)
        except httpx.TransportError as error:
            cause = error
            certificate_error = False
            while cause is not None:
                certificate_error |= isinstance(cause, ssl.SSLCertVerificationError)
                cause = cause.__cause__
            raise OperatorError(503, 'Registry certificate verification failed.' if certificate_error else
                                'Registry connection unavailable; no current data.',
                                'registry_tls_invalid' if certificate_error else 'registry_unavailable') from None
        if response.status_code not in (200, 201):
            code = {403: 'registry_identity_rejected', 409: 'duplicate_device', 422: 'registry_validation_failed'}.get(response.status_code, 'registry_unavailable')
            raise OperatorError(response.status_code if response.status_code in (403,409,422) else 503,
                                'Registry rejected the request or is unavailable.', code)
        return response.json()
    @app.get('/api/v1/operators/registry')
    def snapshot(authorization: str | None = Header(default=None)):
        actor = app.state.accounts.authenticate(authorization)
        return dict(user=actor, registry=registry_request('GET', '/api/v1/fleet/snapshot'))
    @app.post('/api/v1/operators/devices', status_code=201)
    def register(device: Device, authorization: str | None = Header(default=None)):
        accounts = app.state.accounts
        with accounts.lock:
            actor = accounts.authenticate(authorization, admin=True)
            # Durable intent precedes downstream mutation; no cross-service atomicity claim.
            with accounts.db:
                accounts.log(actor['username'], 'device.enrollment.requested', device.serial)
            result = registry_request('POST', '/api/v1/fleet/devices', device.model_dump())
            with accounts.db:
                accounts.log(actor['username'], 'device.enrollment.accepted', device.serial)
        return result
    from .certificate_approvals import install as install_approvals
    install_approvals(app, tls_directory)
    from .operator_serial import install_serial_gateway
    install_serial_gateway(app, prototype_file)
    if static_directory is not None:
        from fastapi.staticfiles import StaticFiles
        app.mount('/', StaticFiles(directory=static_directory, html=True), name='production-ui')
    return app


def operator_server(database, tls_directory, port=8772, registry_origin='https://127.0.0.1:8771', **options):
    import uvicorn
    config = uvicorn.Config(create_operator_app(database, tls_directory=tls_directory, registry_origin=registry_origin, **options), host='127.0.0.1', port=port,
        access_log=False, proxy_headers=False, ws='none', ssl_certfile=str(tls_directory/'server.crt'),
        ssl_keyfile=str(tls_directory/'server.key'), ssl_keyfile_password=key_password(tls_directory/'server.key'))
    config.load()
    config.ssl.minimum_version = ssl.TLSVersion.TLSv1_3
    config.ssl.maximum_version = ssl.TLSVersion.TLSv1_3
    config.ssl.num_tickets = 0
    return uvicorn.Server(config)


def recover_account(database, username, password):
    """Offline OS-file administrator recovery; never creates or re-enables users."""
    credentials = Login(username=username, password=password)
    if not database.is_file():
        raise FileNotFoundError('Existing account database required.')
    accounts = Accounts(database)
    try:
        with accounts.lock, accounts.db:
            user = accounts.db.execute('SELECT active FROM users WHERE username=?', (credentials.username,)).fetchone()
            if not user or not user['active']:
                raise ValueError('Recovery requires an existing enabled account.')
            salt = secrets.token_bytes(16)
            hashed = password_hash(credentials.password, salt)
            accounts.db.execute('UPDATE users SET salt=?,hash=? WHERE username=?', (salt,hashed,credentials.username))
            accounts.db.execute('DELETE FROM sessions WHERE username=?', (credentials.username,))
            accounts.db.execute('DELETE FROM failures WHERE username IN (?,?)', (credentials.username,'password:'+credentials.username))
            accounts.log('offline-recovery', 'password.recovered', credentials.username)
    finally:
        accounts.db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.runtime/operators'))
    parser.add_argument('--tls-directory', type=Path)
    parser.add_argument('--bootstrap', action='store_true')
    parser.add_argument('--recover', metavar='USERNAME')
    parser.add_argument('--username', default='admin')
    args = parser.parse_args()
    if args.bootstrap and args.recover:
        parser.error('--bootstrap and --recover are mutually exclusive.')
    if args.bootstrap or args.recover:
        password = getpass.getpass('New password: ')
        if password != getpass.getpass('Confirm new password: '):
            parser.error('Passwords did not match.')
        try:
            credentials = Login(username=args.recover or args.username, password=password)
        except ValueError:
            parser.error('Invalid username or password length (15–128 characters required).')
    if args.recover:
        recover_account(args.directory/'accounts.sqlite3', credentials.username, credentials.password)
        print('Recovered existing enabled account; all prior sessions were revoked.')
    elif args.bootstrap:
        user = NewUser(username=credentials.username, password=credentials.password, role='admin')
        args.directory.mkdir(parents=True, exist_ok=False, mode=0o700)
        accounts = Accounts(args.directory/'accounts.sqlite3')
        try:
            accounts.create(user, 'offline-bootstrap')
        finally:
            accounts.db.close()
        print('Created local administrator. Password was not printed or saved in plaintext.')
    else:
        if not args.tls_directory:
            parser.error('HTTPS requires --tls-directory; plaintext server startup is not supported.')
        operator_server(args.directory/'accounts.sqlite3', args.tls_directory).run()


if __name__ == '__main__':
    main()
