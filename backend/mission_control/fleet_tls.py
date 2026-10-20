"""Loopback-only TLS 1.3/mTLS laboratory for the civilian registry."""
import argparse
import hashlib
import json
import secrets
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path
import ipaddress
import os
from contextlib import contextmanager

import uvicorn
from uvicorn.protocols.http.h11_impl import H11Protocol
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from starlette.responses import JSONResponse
from .fleet_service import create_fleet_app
from .key_custody import write_key, key_password

IDENTITIES = ('center', 'station-a', 'station-b')


def issue(directory, name, ca_key, ca_cert, *, expired=False, server=False):
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(ca_cert.subject)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(days=2) if expired else now-timedelta(minutes=1))
        .not_valid_after(now-timedelta(days=1) if expired else min(now+timedelta(days=7), ca_cert.not_valid_after_utc))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH if server else ExtendedKeyUsageOID.CLIENT_AUTH]), critical=True))
    if server:
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
    cert = builder.sign(ca_key, hashes.SHA256())
    write_key(directory/f'{name}.key', key)
    for suffix, body in [('crt', cert.public_bytes(serialization.Encoding.PEM))]:
        path = directory/f'{name}.{suffix}'
        with path.open('xb') as stream:
            stream.write(body)
        path.chmod(0o600)
    return cert.fingerprint(hashes.SHA256()).hex()


def initialize(directory, authority=None):
    # A new directory is required; never overwrite an existing identity.
    authority = authority or directory.with_name(directory.name+'-authority')
    if directory.exists() or authority.exists():
        raise FileExistsError('Laboratory or authority directory already exists.')
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    authority.mkdir(parents=True, exist_ok=False, mode=0o700)
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'FLW local test CA')])
    ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
        .serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(minutes=1))
        .not_valid_after(now+timedelta(days=8))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
        .sign(key, hashes.SHA256()))
    (directory/'ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (authority/'ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    write_key(authority/'ca.key', key)
    issue(directory, 'server', key, ca, server=True)
    identities = {issue(directory, actor, key, ca): actor for actor in IDENTITIES}
    # Test-only negative fixtures, never usable as enrolled identities.
    issue(directory, 'expired', key, ca, expired=True)
    issue(directory, 'unenrolled', key, ca)
    (directory/'identities.json').write_text(json.dumps(identities), encoding='utf-8')
    (directory/'revoked.json').write_text('[]', encoding='utf-8')
    # Offline authority is separate from the serving/publisher directory.


@contextmanager
def identity_lock(path):
    stream = path.open('x')
    try:
        yield
    finally:
        stream.close()
        path.unlink()


def renew(directory, actor, authority, output):
    """Offline administrator action: replace one certificate mapping atomically."""
    if actor not in ('station-a', 'station-b'):
        raise ValueError('Only station identities can be renewed here.')
    ca = x509.load_pem_x509_certificate((authority/'ca.crt').read_bytes())
    trusted = x509.load_pem_x509_certificate((directory/'ca.crt').read_bytes())
    if ca.fingerprint(hashes.SHA256()) != trusted.fingerprint(hashes.SHA256()) or ca.not_valid_after_utc <= datetime.now(timezone.utc):
        raise ValueError('Authority does not match the active, valid laboratory CA.')
    key = serialization.load_pem_private_key((authority/'ca.key').read_bytes(), password=key_password(authority/'ca.key'))
    if key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo) != ca.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo):
        raise ValueError('Authority key does not match certificate.')
    lock = directory/'identity-update.lock'
    with identity_lock(lock):
        identities = json.loads((directory/'identities.json').read_text(encoding='utf-8'))
        if not isinstance(identities, dict) or not any(value == actor for value in identities.values()):
            raise ValueError('Station identity is not enrolled.')
        from .identity_audit import ensure_mutation_allowed
        ensure_mutation_allowed(directory)
        output.mkdir(parents=True, exist_ok=False, mode=0o700)
        fingerprint = issue(output, actor, key, ca)
        (output/'ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.PEM))
        from .identity_audit import replace_identity
        cert = x509.load_pem_x509_certificate((output/f'{actor}.crt').read_bytes())
        replace_identity(directory, identities, actor, cert, 'renew')


class PeerProtocol(H11Protocol):
    def connection_made(self, transport):
        super().connection_made(transport)
        tls = transport.get_extra_info('ssl_object')
        certificate = tls.getpeercert(binary_form=True) if tls else None
        fingerprint = hashlib.sha256(certificate).hexdigest() if certificate else None
        expires = x509.load_der_x509_certificate(certificate).not_valid_after_utc if certificate else None
        app = self.app

        async def peer_app(scope, receive, send):
            scope = dict(scope, flw_peer=fingerprint, flw_peer_expires=expires)
            await app(scope, receive, send)
        self.app = peer_app


class CertificateIdentity:
    def __init__(self, app, directory, credentials):
        self.app, self.directory, self.credentials = app, directory, credentials

    def resolve(self, peer, expires):
        try:
            identities = json.loads((self.directory/'identities.json').read_text(encoding='utf-8'))
            revoked = json.loads((self.directory/'revoked.json').read_text(encoding='utf-8'))
            actor = identities.get(peer)
            valid = (isinstance(revoked, list) and peer not in revoked and actor in IDENTITIES
                     and expires is not None and expires > datetime.now(timezone.utc))
        except (OSError, ValueError, TypeError, AttributeError):
            valid = False
        return actor if valid else None

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        actor = self.resolve(scope.get('flw_peer'), scope.get('flw_peer_expires'))
        if actor is None:
            return await JSONResponse({'detail': 'Client identity unavailable, expired or revoked.'}, status_code=403)(scope, receive, send)
        # Network headers never establish identity. Only the verified TLS peer does.
        scope = dict(scope, flw_actor=actor, flw_authorize=self.resolve, headers=[(k,v) for k,v in scope['headers'] if k.lower() != b'authorization'] +
                     [(b'authorization', ('Bearer '+self.credentials[actor]).encode())])
        await self.app(scope, receive, send)


def server(directory, port=8771):
    credentials = {actor: secrets.token_urlsafe(32) for actor in IDENTITIES}
    registry_app = create_fleet_app(directory/'registry.sqlite3', credentials)
    from .fsl import install
    install(registry_app)
    app = CertificateIdentity(registry_app, directory, credentials)
    config = uvicorn.Config(app, host='127.0.0.1', port=port, http=PeerProtocol, ws='none',
        proxy_headers=False, access_log=False, ssl_certfile=str(directory/'server.crt'),
        ssl_keyfile=str(directory/'server.key'), ssl_keyfile_password=key_password(directory/'server.key'),
        ssl_ca_certs=str(directory/'ca.crt'), ssl_cert_reqs=ssl.CERT_REQUIRED)
    config.load()
    config.ssl.minimum_version = ssl.TLSVersion.TLSv1_3
    config.ssl.maximum_version = ssl.TLSVersion.TLSv1_3
    config.ssl.num_tickets = 0
    return uvicorn.Server(config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.runtime/fleet-tls'))
    parser.add_argument('--init', action='store_true')
    parser.add_argument('--authority', type=Path)
    parser.add_argument('--renew', choices=('station-a','station-b'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.init and args.renew:
        parser.error('--init and --renew are mutually exclusive.')
    if args.init:
        initialize(args.directory, args.authority)
        print('Created local TLS laboratory and separate private offline authority.')
    elif args.renew:
        if not args.authority or not args.output:
            parser.error('Renewal requires --authority and a new --output directory.')
        renew(args.directory, args.renew, args.authority, args.output)
        print('Station certificate replaced. Old certificate and sessions are no longer authorized.')
    else:
        server(args.directory).run()


if __name__ == '__main__':
    main()
