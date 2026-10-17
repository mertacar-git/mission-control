"""Bounded synthetic equipment publisher. No aircraft, GPS or command channel."""
import argparse
import json
import time
import ssl
from pathlib import Path
from urllib.parse import urlparse, quote
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler
from urllib.error import HTTPError


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, target):
        raise HTTPError(request.full_url, code, 'Redirect refused; credential not forwarded.', headers, fp)


def endpoint(value):
    parsed = urlparse(value)
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
        raise ValueError('Use a center origin without credentials, path, query or fragment.')
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in ('localhost','127.0.0.1','::1')):
        raise ValueError('Non-loopback centers require verified HTTPS.')
    return value.rstrip('/')


def publish(center, token, duration, boot, interval=0.2, tls_context=None):
    center = endpoint(center)
    if tls_context is not None and not center.startswith('https://'):
        raise ValueError('Certificate identity requires HTTPS.')
    opener = build_opener(NoRedirect(), HTTPSHandler(context=tls_context))
    def request(path, body=None):
        req = Request(center+path, data=None if body is None else json.dumps(body).encode(),
                      headers={'Content-Type':'application/json', **({'Authorization':'Bearer '+token} if token else {})})
        with opener.open(req, timeout=5) as response:
            return json.load(response)
    snapshot = request('/api/v1/fleet/snapshot')
    if snapshot['actor'] not in ('station-a','station-b'):
        raise ValueError('Publisher requires a station-scoped credential.')
    serials = [row['device']['serial'] for row in snapshot['devices']]
    if not serials:
        raise ValueError('No equipment enrolled for this station.')
    start = time.monotonic()
    sequence = 0
    while time.monotonic()-start < duration:
        for serial in serials:
            request('/api/v1/fleet/devices/'+quote(serial,safe='')+'/measurements',
                    dict(source='synthetic',boot=boot,sequence=sequence,source_time_ms=int((time.monotonic()-start)*1000),
                         temperature_c=23.5,pressure_pa=101325,humidity_percent=45))
        sequence += 1
        time.sleep(interval)
    return dict(source='synthetic',actor=snapshot['actor'],devices=len(serials),cycles=sequence)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--center',default='http://127.0.0.1:8770')
    parser.add_argument('--token-file',type=Path)
    parser.add_argument('--tls-directory',type=Path)
    parser.add_argument('--identity',choices=('station-a','station-b'))
    parser.add_argument('--seconds',type=int,choices=range(1,61),default=10)
    parser.add_argument('--boot',type=int,default=int(time.time()))
    args=parser.parse_args()
    if not 0 <= args.boot <= 4294967295:
        parser.error('Boot must be uint32.')
    if args.tls_directory:
        if not args.identity or args.token_file:
            parser.error('TLS mode requires --identity and excludes --token-file.')
        context = ssl.create_default_context(cafile=str(args.tls_directory/'ca.crt'))
        context.minimum_version = ssl.TLSVersion.TLSv1_3
        context.load_cert_chain(str(args.tls_directory/f'{args.identity}.crt'), str(args.tls_directory/f'{args.identity}.key'))
        token = None
    else:
        if not args.token_file or args.identity:
            parser.error('Legacy mode requires --token-file; --identity requires TLS mode.')
        context, token = None, args.token_file.read_text().strip()
    print(json.dumps(publish(args.center,token,args.seconds,args.boot,tls_context=context)))
