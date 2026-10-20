"""Windows current-user DPAPI protects PEM passwords; POSIX uses private files."""
import ctypes
import os
import secrets
from pathlib import Path
from cryptography.hazmat.primitives import serialization


def dpapi(value, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('DPAPI is available only on Windows.')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    function = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    function.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.POINTER(Blob), ctypes.c_void_p,
                         ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    function.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = (ctypes.c_ubyte * len(value)).from_buffer_copy(value)
    source, target = Blob(len(value), buffer), Blob()
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.memset(target.data, 0, target.size)
        kernel.LocalFree(target.data)


def write_key(path, key):
    path = Path(path)
    password = secrets.token_bytes(32) if os.name == 'nt' else None
    protection = serialization.BestAvailableEncryption(password) if password else serialization.NoEncryption()
    body = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, protection)
    # Private creation mode from the first write, rather than chmod after exposure.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(body)
    if password:
        sidecar = path.with_suffix(path.suffix+'.dpapi')
        with sidecar.open('xb') as stream:
            stream.write(dpapi(password))


def key_password(path):
    path = Path(path)
    sidecar = path.with_suffix(path.suffix+'.dpapi')
    if sidecar.exists():
        return dpapi(sidecar.read_bytes(), decrypt=True)
    if os.name != 'nt' and path.stat().st_mode & 0o077:
        raise PermissionError('Private key must not be accessible to group/other users.')
    # Legacy unencrypted test keys remain readable; migration is never implicit.
    return None


def write_secret(path, value):
    """Exclusive local token exchange: DPAPI on Windows, mode 0600 elsewhere."""
    path = Path(path)
    encoded = value.encode('utf-8')
    body = b'DPAPI1\n'+dpapi(encoded) if os.name == 'nt' else b'PRIVATE1\n'+encoded
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        stream.write(body)


def read_secret(path):
    path = Path(path)
    if os.name != 'nt' and path.stat().st_mode & 0o077:
        raise PermissionError('Token file must be private to its owner.')
    body = path.read_bytes()
    if body.startswith(b'DPAPI1\n'):
        return dpapi(body[7:], decrypt=True).decode('utf-8')
    if os.name != 'nt' and body.startswith(b'PRIVATE1\n'):
        return body[9:].decode('utf-8')
    raise ValueError('Protected token format required.')
