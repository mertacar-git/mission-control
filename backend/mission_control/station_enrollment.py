"""Offline civilian station enrollment; private keys stay on their generating PC."""
import argparse
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from .key_custody import write_key, key_password
from .fleet_tls import identity_lock
import json

STATIONS = ('station-a', 'station-b')


def subject(actor):
    if actor not in STATIONS:
        raise ValueError('Only allowlisted civilian stations can enroll.')
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, actor)])


def read_public(path):
    with Path(path).open('rb') as stream:
        body = stream.read(16385)
    if len(body) > 16384:
        raise ValueError('Enrollment artifact exceeds 16 KiB.')
    return body


def public_key_bytes(key):
    return key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


def request_identity(directory, actor):
    name = subject(actor)
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    key = ec.generate_private_key(ec.SECP256R1())
    write_key(directory/f'{actor}.key', key)
    csr = x509.CertificateSigningRequestBuilder().subject_name(name).sign(key, hashes.SHA256())
    with (directory/f'{actor}.csr').open('xb') as stream:
        stream.write(csr.public_bytes(serialization.Encoding.PEM))


def sign_request(authority, request_file, actor, output):
    """An administrator selects actor explicitly; CSR names do not grant scope."""
    csr = x509.load_pem_x509_csr(read_public(request_file))
    public = csr.public_key()
    if (not csr.is_signature_valid or csr.subject != subject(actor) or len(csr.extensions)
        or not isinstance(public, ec.EllipticCurvePublicKey) or not isinstance(public.curve, ec.SECP256R1)
        or not isinstance(csr.signature_hash_algorithm, hashes.SHA256)):
        raise ValueError('Invalid signature, station identity or CSR profile.')
    ca = x509.load_pem_x509_certificate(read_public(authority/'ca.crt'))
    now = datetime.now(timezone.utc)
    if not ca.not_valid_before_utc <= now < ca.not_valid_after_utc or not ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca:
        raise ValueError('Authority is unavailable or expired.')
    key = serialization.load_pem_private_key((authority/'ca.key').read_bytes(), password=key_password(authority/'ca.key'))
    if public_key_bytes(key.public_key()) != public_key_bytes(ca.public_key()):
        raise ValueError('Authority key mismatch.')
    cert = (x509.CertificateBuilder().subject_name(subject(actor)).issuer_name(ca.subject)
        .public_key(public).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(minutes=1)).not_valid_after(min(now+timedelta(days=7), ca.not_valid_after_utc))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), critical=True)
        .sign(key, hashes.SHA256()))
    output.mkdir(parents=True, exist_ok=False)
    (output/f'{actor}.crt').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (output/'ca.crt').write_bytes(ca.public_bytes(serialization.Encoding.PEM))


def validate_certificate(certificate_file, trusted_ca, actor):
    return validate_certificate_bytes(read_public(certificate_file), read_public(trusted_ca), actor)


def validate_certificate_bytes(certificate_body, ca_body, actor):
    if len(certificate_body)>16384 or b'PRIVATE KEY' in certificate_body:
        raise ValueError('Only a bounded public certificate is accepted.')
    cert = x509.load_pem_x509_certificate(certificate_body)
    ca = x509.load_pem_x509_certificate(ca_body)
    cert.verify_directly_issued_by(ca)
    now = datetime.now(timezone.utc)
    public = cert.public_key()
    if (cert.subject != subject(actor) or not cert.not_valid_before_utc <= now < cert.not_valid_after_utc
        or not ca.not_valid_before_utc <= now < ca.not_valid_after_utc
        or not ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
        or cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
        or list(cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value) != [ExtendedKeyUsageOID.CLIENT_AUTH]
        or not isinstance(public, ec.EllipticCurvePublicKey) or not isinstance(public.curve, ec.SECP256R1)):
        raise ValueError('Certificate does not match the station client profile.')
    return cert


def complete_identity(directory, certificate_file, trusted_ca, actor):
    """Station validates against an independently trusted CA and its own key."""
    cert = validate_certificate(certificate_file, trusted_ca, actor)
    key_file = directory/f'{actor}.key'
    key = serialization.load_pem_private_key(key_file.read_bytes(), password=key_password(key_file))
    if public_key_bytes(key.public_key()) != public_key_bytes(cert.public_key()):
        raise ValueError('Certificate belongs to a different station key.')
    for destination in (directory/f'{actor}.crt', directory/'ca.crt'):
        if destination.exists():
            raise FileExistsError('Station bundle already completed; no files overwritten.')
    with (directory/f'{actor}.crt').open('xb') as stream:
        stream.write(cert.public_bytes(serialization.Encoding.PEM))
    with (directory/'ca.crt').open('xb') as stream:
        stream.write(read_public(trusted_ca))


def activate_identity(center, certificate_file, actor):
    """Explicit offline admin activation replaces only the approved station."""
    cert = validate_certificate(certificate_file, center/'ca.crt', actor)
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    with identity_lock(center/'identity-update.lock'):
        identities = json.loads((center/'identities.json').read_text(encoding='utf-8'))
        revoked = json.loads((center/'revoked.json').read_text(encoding='utf-8'))
        if not isinstance(identities, dict) or not isinstance(revoked, list) or fingerprint in revoked:
            raise ValueError('Invalid identity state or revoked certificate.')
        if not any(value == actor for value in identities.values()):
            raise ValueError('Station is not enrolled; activation cannot create roles.')
        if fingerprint in identities:
            raise ValueError('Certificate is already activated or assigned.')
        from .identity_audit import replace_identity
        return replace_identity(center, identities, actor, cert, 'activate')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    request = commands.add_parser('request')
    request.add_argument('--directory', type=Path, required=True)
    sign = commands.add_parser('sign')
    sign.add_argument('--authority', type=Path, required=True)
    sign.add_argument('--csr', type=Path, required=True)
    sign.add_argument('--output', type=Path, required=True)
    complete = commands.add_parser('complete')
    complete.add_argument('--directory', type=Path, required=True)
    complete.add_argument('--trusted-ca', type=Path, required=True)
    activate = commands.add_parser('activate')
    activate.add_argument('--center-directory', type=Path, required=True)
    for command in (request, sign, complete, activate):
        command.add_argument('--identity', choices=STATIONS, required=True)
    for command in (complete, activate):
        command.add_argument('--certificate', type=Path, required=True)
    reconcile = commands.add_parser('audit-reconcile')
    reconcile.add_argument('--center-directory', type=Path, required=True)
    approved = commands.add_parser('activate-approved')
    approved.add_argument('--center-directory', type=Path, required=True)
    approved.add_argument('--accounts-db', type=Path, required=True)
    approved.add_argument('--approval-id', required=True)
    args = parser.parse_args()
    if args.action == 'activate-approved':
        from .certificate_approvals import activate_approved
        print(json.dumps(activate_approved(args.center_directory, args.accounts_db, args.approval_id)))
        return
    if args.action == 'audit-reconcile':
        from .identity_audit import reconcile as reconcile_audit
        count = reconcile_audit(args.center_directory)
        print(f'Reconciled {count} pending operations from current mapping; historical completion remains unconfirmed.')
        return
    if args.action == 'request':
        request_identity(args.directory, args.identity)
    elif args.action == 'sign':
        sign_request(args.authority, args.csr, args.identity, args.output)
    elif args.action == 'complete':
        complete_identity(args.directory, args.certificate, args.trusted_ca, args.identity)
    else:
        activate_identity(args.center_directory, args.certificate, args.identity)
    print(f'Completed {args.action}; private keys are never printed or transferred by this tool.')


if __name__ == '__main__':
    main()
