"""Single-PC civilian sensor prototype: explicit setup, fail-closed launch and owned cleanup."""
import argparse
import getpass
import json
import os
import secrets
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from .station_bridge import BridgeConfig, StationBridge, BridgeError, tls_context
from .key_custody import key_password, read_secret, write_secret

ROOT=Path(__file__).resolve().parents[2]
PORTS=(8767,8771,8772)


def setup(directory, username, password, profile='synthetic', port=None, stream=None):
    from .operator_accounts import Login, NewUser, Accounts
    from .fleet_tls import initialize
    Login(username=username,password=password)
    if profile=='serial' and (not port or not stream):
        raise ValueError('Serial setup requires an explicit port and MCS1 stream ID.')
    config=BridgeConfig(station_id='station-a',device_id='MCS-BENCH-01',stream_id=stream or '00112233445566778899aabbccddeeff')
    directory.mkdir(parents=True,exist_ok=False,mode=0o700)
    initialize(directory/'tls')
    (directory/'operators').mkdir(mode=0o700)
    accounts=Accounts(directory/'operators/accounts.sqlite3')
    try:accounts.create(NewUser(username=username,password=password,role='admin'),'offline-prototype-setup')
    finally:accounts.db.close()
    body=dict(profile=profile,port=port if profile=='serial' else 'TEST:MCS1',**config.model_dump())
    (directory/'prototype.json').write_text(json.dumps(body,indent=2),encoding='utf-8')


def configuration(directory):
    body=json.loads((directory/'prototype.json').read_text())
    if body.get('profile') not in ('synthetic','serial'):
        raise ValueError('Select synthetic or serial profile explicitly.')
    if not isinstance(body.get('port'),str) or not body['port']:
        raise ValueError('Select the serial port explicitly.')
    if body['profile']=='synthetic' and body['port']!='TEST:MCS1':
        raise ValueError('Synthetic profile requires TEST:MCS1.')
    if body['profile']=='serial' and body['port'].startswith('TEST:'):
        raise ValueError('Serial profile requires a real selected port.')
    config=BridgeConfig.model_validate({key:body[key] for key in ('station_id','device_id','stream_id','receiver','center')})
    if config.center!='https://127.0.0.1:8771' or config.receiver!='http://127.0.0.1:8767':
        raise ValueError('Launcher requires its fixed local service addresses.')
    return body,config


def preflight(directory, dist=ROOT/'frontend/dist', ports=PORTS):
    body,config=configuration(directory)
    if body['profile']=='serial':
        from .serial_service import local_ports
        if body['port'] not in [item['port'] for item in local_ports()]:
            raise ValueError('Configured serial port is unavailable; select the new port explicitly.')
    tls=directory/'tls'
    now=datetime.now(timezone.utc)
    ca=x509.load_pem_x509_certificate((tls/'ca.crt').read_bytes())
    if not ca.not_valid_before_utc<=now<ca.not_valid_after_utc:
        raise ValueError('CA certificate is expired or not yet valid; use explicit certificate maintenance.')
    identities=json.loads((tls/'identities.json').read_text())
    revoked=json.loads((tls/'revoked.json').read_text())
    for actor in ('server','center',config.station_id):
        cert=x509.load_pem_x509_certificate((tls/f'{actor}.crt').read_bytes())
        if not cert.not_valid_before_utc<=now<cert.not_valid_after_utc:
            raise ValueError(f'{actor} certificate is expired or not yet valid.')
        cert.verify_directly_issued_by(ca)
        if actor!='server':
            fingerprint=cert.fingerprint(hashes.SHA256()).hex()
            if identities.get(fingerprint)!=actor or fingerprint in revoked:
                raise ValueError(f'{actor} certificate registry identity is missing or revoked.')
        # Also verifies private key access, DPAPI custody and certificate/key match.
        tls_context(tls,actor)
    database=directory/'operators/accounts.sqlite3'
    if not database.is_file():raise ValueError('Existing operator accounts required; run setup separately.')
    with sqlite3.connect(database.resolve().as_uri()+'?mode=ro',uri=True) as db:
        if not db.execute("SELECT 1 FROM users WHERE active=1 AND role='admin'").fetchone():
            raise ValueError('No enabled administrator; use explicit offline account recovery.')
    if not (dist/'index.html').is_file() or not list((dist/'assets').glob('*.js')):
        raise ValueError('Production UI missing; run npm ci and npm run build in frontend.')
    # Reserve all ports together during the check. Never kill a port owner.
    sockets=[]
    try:
        for port in ports:
            listener=socket.socket()
            sockets.append(listener)
            if os.name=='nt':listener.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
            else:listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
            try:listener.bind(('127.0.0.1',port))
            except OSError:raise ValueError(f'Port {port} is occupied; close its owning application yourself.') from None
        probe=directory/f'.access-{secrets.token_hex(6)}'
        with probe.open('x') as output:output.write('access check')
        probe.unlink()
    finally:
        for listener in sockets:listener.close()
    return body,config


class OwnedProcesses:
    def __init__(self):self.children=[];self.logs=[]
    def start(self,command,log):
        output=log.open('xb');self.logs.append(output)
        flags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0
        process=subprocess.Popen(command,cwd=ROOT/'backend',stdout=output,stderr=subprocess.STDOUT,creationflags=flags)
        self.children.append(process)
        return process
    def close(self):
        for process in reversed(self.children):
            if process.poll() is None:process.terminate()
        for process in reversed(self.children):
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
        for output in self.logs:output.close()


def wait_ready(process, check, timeout=15):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if process.poll() is not None:raise RuntimeError('Owned service exited during startup; inspect its local log.')
        try:
            if check():return
        except (httpx.TransportError,OSError):pass
        time.sleep(.1)
    raise RuntimeError('Owned service startup timed out; inspect its local log.')


def bridge_worker(directory,config,token_file,stop):
    def publish(value):
        target=directory/'bridge-status.json';temporary=target.with_suffix('.tmp')
        temporary.write_text(json.dumps(value),encoding='utf-8');temporary.replace(target)
    bridge=None
    try:
        with httpx.Client(base_url=config.receiver,headers={'Authorization':'Bearer '+read_secret(token_file)},trust_env=False,follow_redirects=False,timeout=2) as receiver,httpx.Client(base_url=config.center,verify=tls_context(directory/'tls',config.station_id),trust_env=False,follow_redirects=False,timeout=3) as center:
            bridge=StationBridge(config,receiver,center)
            publish(dict(state='waiting',code='enroll_configured_device',forwarded=0))
            # Waiting for initial enrollment is not an automatic retry of a failed request.
            while not stop.is_set():
                snapshot=bridge.request(center,'GET','/api/v1/fleet/snapshot')
                if any(row['device']['serial']==config.device_id for row in snapshot['devices']):break
                stop.wait(1)
            if stop.is_set():return
            bridge.initialize()
            while not stop.is_set():
                bridge.step();publish(bridge.status());stop.wait(.2)
    except Exception as error:
        publish(dict(state='error',code=error.args[0] if isinstance(error,BridgeError) else 'bridge_start_failed',forwarded=bridge.forwarded if bridge else 0))


def launch(directory,dist=ROOT/'frontend/dist',open_browser=True,seconds=None):
    body,config=preflight(directory,dist)
    lock=directory/'launcher.lock'
    descriptor=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    os.close(descriptor)
    owned=OwnedProcesses();stop=threading.Event();worker=None;token_file=None
    try:
        run=directory/('run-'+secrets.token_hex(8));run.mkdir(mode=0o700)
        token_file=run/'serial.token';write_secret(token_file,secrets.token_urlsafe(32))
        command=[sys.executable,'-m','mission_control.prototype','--directory',str(directory)]
        registry=owned.start(command+['service','registry'],run/'registry.log')
        with httpx.Client(base_url=config.center,verify=tls_context(directory/'tls','center'),trust_env=False,timeout=1) as client:
            wait_ready(registry,lambda:client.get('/api/v1/fleet/snapshot').status_code==200)
        serial_command=[sys.executable,'-m','mission_control.serial_service','--directory',str(directory/'serial'),'--token-file',str(token_file)]
        if body['profile']=='synthetic':serial_command.append('--synthetic')
        receiver=owned.start(serial_command,run/'serial.log')
        with httpx.Client(base_url=config.receiver,headers={'Authorization':'Bearer '+read_secret(token_file)},trust_env=False,timeout=1) as client:
            wait_ready(receiver,lambda:client.get('/api/v1/serial/status').status_code==200)
        center=owned.start(command+['service','center','--token-file',str(token_file),'--dist',str(dist)],run/'center.log')
        with httpx.Client(base_url='https://127.0.0.1:8772',verify=tls_context(directory/'tls','center'),trust_env=False,timeout=1) as client:
            wait_ready(center,lambda:client.get('/').status_code==200)
        worker=threading.Thread(target=bridge_worker,args=(directory,config,token_file,stop),daemon=True);worker.start()
        print(f"READY {body['profile'].upper()} https://127.0.0.1:8772 · enroll {config.device_id} to {config.station_id}",flush=True)
        print('Trust the local CA explicitly using the documented procedure; do not bypass browser certificate warnings. Ctrl+C stops only these owned services.',flush=True)
        if open_browser:webbrowser.open('https://127.0.0.1:8772')
        deadline=None if seconds is None else time.monotonic()+seconds
        while deadline is None or time.monotonic()<deadline:
            if any(process.poll() is not None for process in owned.children):raise RuntimeError('Owned service stopped; inspect this run logs.')
            time.sleep(.2)
    finally:
        stop.set()
        if worker:worker.join(6)
        owned.close()
        if token_file:token_file.unlink(missing_ok=True)
        lock.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=ROOT/'.runtime/prototype')
    commands=parser.add_subparsers(dest='command',required=True)
    first=commands.add_parser('setup');first.add_argument('--username',default='admin');first.add_argument('--profile',choices=['synthetic','serial'],default='synthetic');first.add_argument('--port');first.add_argument('--stream')
    commands.add_parser('check')
    start=commands.add_parser('start');start.add_argument('--no-browser',action='store_true');start.add_argument('--seconds',type=int);start.add_argument('--dist',type=Path,default=ROOT/'frontend/dist')
    service=commands.add_parser('service');service.add_argument('kind',choices=['registry','center']);service.add_argument('--token-file',type=Path);service.add_argument('--dist',type=Path,default=ROOT/'frontend/dist')
    args=parser.parse_args();directory=args.directory.resolve()
    def interrupted(signum, frame):raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM,interrupted)
    try:
        if args.command=='setup':
            password=getpass.getpass('Administrator password (15–128 characters): ')
            if password!=getpass.getpass('Confirm password: '):raise ValueError('Passwords did not match.')
            setup(directory,args.username,password,args.profile,args.port,args.stream)
            print('Setup created. Accounts and certificates will not be recreated on start.')
        elif args.command=='check':
            body,_=preflight(directory);print('Preflight passed: '+body['profile'].upper())
        elif args.command=='start':launch(directory,dist=args.dist,open_browser=not args.no_browser,seconds=args.seconds)
        elif args.kind=='registry':
            from .fleet_tls import server
            server(directory/'tls').run()
        else:
            from .operator_accounts import operator_server
            operator_server(directory/'operators/accounts.sqlite3',directory/'tls',static_directory=args.dist,serial_token_file=args.token_file,prototype_file=directory/'prototype.json').run()
    except KeyboardInterrupt:pass
    except Exception as error:
        # Never print arbitrary exception text which could contain tokens or key material.
        if isinstance(error,(ValueError,FileExistsError,FileNotFoundError,PermissionError,RuntimeError)) and type(error).__module__=='builtins':
            print('Prototype stopped: '+str(error),file=sys.stderr)
        else:print('Prototype stopped: configuration, certificate or service check failed; inspect local files and logs.',file=sys.stderr)
        raise SystemExit(1)


if __name__=='__main__':main()
