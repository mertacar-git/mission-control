"""Loopback-only TLS 1.3/mTLS laboratory for the civilian registry."""
import argparse
import hashlib
import json
import secrets
import ssl
from datetime import datetime, timedelta, timezone
from pathlib import Path
import ipaddress

import uvicorn
from uvicorn.protocols.http.h11_impl import H11Protocol
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from starlette.responses import JSONResponse
from .fleet_service import create_fleet_app

IDENTITIES = ('center', 'station-a', 'station-b')


def issue(directory, name, ca_key, ca_cert, *, expired=False, server=False):
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    builder = (x509.CertificateBuilder().subject_name(subject).issuer_name(ca_cert.subject)
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(days=2) if expired else now-timedelta(minutes=1))
        .not_valid_after(now-timedelta(days=1) if expired else now+timedelta(days=7))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH if server else ExtendedKeyUsageOID.CLIENT_AUTH]), critical=True))
    if server:
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'), x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
    cert = builder.sign(ca_key, hashes.SHA256())
    for suffix, body in [('key', key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())), ('crt', cert.public_bytes(serialization.Encoding.PEM))]:
        path = directory/f'{name}.{suffix}'
        with path.open('xb') as stream:
            stream.write(body)
        path.chmod(0o600)
    return cert.fingerprint(hashes.SHA256()).hex()


def initialize(directory):
    # A new directory is required; never overwrite an existing identity.
    directory.mkdir(parents=True, exist_ok=False)
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
    issue(directory, 'server', key, ca, server=True)
    identities = {issue(directory, actor, key, ca): actor for actor in IDENTITIES}
    # Test-only negative fixtures, never usable as enrolled identities.
    issue(directory, 'expired', key, ca, expired=True)
    issue(directory, 'unenrolled', key, ca)
    (directory/'identities.json').write_text(json.dumps(identities), encoding='utf-8')
    (directory/'revoked.json').write_text('[]', encoding='utf-8')
    # CA signing key is deliberately not persisted: regeneration needs a new lab.


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

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        try:
            identities = json.loads((self.directory/'identities.json').read_text(encoding='utf-8'))
            revoked = json.loads((self.directory/'revoked.json').read_text(encoding='utf-8'))
            peer = scope.get('flw_peer')
            actor = identities.get(peer)
            expires = scope.get('flw_peer_expires')
            valid = (isinstance(revoked, list) and peer not in revoked and actor in IDENTITIES
                     and expires is not None and expires > datetime.now(timezone.utc))
        except (OSError, ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            return await JSONResponse({'detail': 'Client identity unavailable, expired or revoked.'}, status_code=403)(scope, receive, send)
        # Network headers never establish identity. Only the verified TLS peer does.
        scope = dict(scope, headers=[(k,v) for k,v in scope['headers'] if k.lower() != b'authorization'] +
                     [(b'authorization', ('Bearer '+self.credentials[actor]).encode())])
        await self.app(scope, receive, send)


def server(directory, port=8771):
    credentials = {actor: secrets.token_urlsafe(32) for actor in IDENTITIES}
    app = CertificateIdentity(create_fleet_app(directory/'registry.sqlite3', credentials), directory, credentials)
    config = uvicorn.Config(app, host='127.0.0.1', port=port, http=PeerProtocol, ws='none',
        proxy_headers=False, access_log=False, ssl_certfile=str(directory/'server.crt'),
        ssl_keyfile=str(directory/'server.key'), ssl_ca_certs=str(directory/'ca.crt'), ssl_cert_reqs=ssl.CERT_REQUIRED)
    config.load()
    config.ssl.minimum_version = ssl.TLSVersion.TLSv1_3
    config.ssl.maximum_version = ssl.TLSVersion.TLSv1_3
    config.ssl.num_tickets = 0
    return uvicorn.Server(config)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=Path('.runtime/fleet-tls'))
    parser.add_argument('--init', action='store_true')
    args = parser.parse_args()
    if args.init:
        initialize(args.directory)
        print('Created private local TLS laboratory. CA signing key was not retained.')
    else:
        server(args.directory).run()


if __name__ == '__main__':
    main()
