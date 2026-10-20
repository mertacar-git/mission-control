"""Fixed loopback serial gateway using human sessions, never browser receiver tokens."""
import hashlib
import json
import re
from fastapi import Request
from starlette.responses import Response
from .operator_accounts import OperatorError

ROUTES = {
    'GET': r'(ports|status|recordings|recordings/[0-9a-f-]{36}|experiments|experiment-runs)',
    'POST': r'(control/claim|control/renew|connection|experiments|experiment-runs/[0-9a-f-]{36}(/cancel)?)',
    'DELETE': r'connection',
}


def install_serial_gateway(app, prototype_file=None):
    @app.get('/api/v1/operators/prototype')
    def prototype(request: Request):
        app.state.accounts.authenticate(request.headers.get('authorization'))
        if prototype_file is None:
            return {'configured': False}
        try:
            value=json.loads(prototype_file.read_text())
            status_file=prototype_file.parent/'bridge-status.json'
            status=json.loads(status_file.read_text()) if status_file.is_file() else {'state':'unknown','code':None,'forwarded':0}
            return {'configured':True, **{key:value[key] for key in ('profile','station_id','device_id','stream_id','port')},
                    'bridge':{key:status.get(key) for key in ('state','code','forwarded')}}
        except (OSError,ValueError,KeyError):
            raise OperatorError(503,'Prototype configuration unavailable.','prototype_unavailable')

    @app.api_route('/api/v1/operators/serial/{path:path}', methods=['GET','POST','DELETE'])
    async def serial(path: str, request: Request):
        actor=app.state.accounts.authenticate(request.headers.get('authorization'))
        if request.url.query or not re.fullmatch(ROUTES[request.method],path):
            raise OperatorError(404,'Serial route unavailable.','request_rejected')
        client=getattr(app.state,'serial_client',None)
        if client is None:
            raise OperatorError(503,'Serial gateway not configured.','serial_unavailable')
        owner=request.headers.get('x-control-session','')
        if owner and len(owner)>100:
            raise OperatorError(422,'Invalid control session.','request_rejected')
        body=bytearray()
        async for chunk in request.stream():
            if len(body)+len(chunk)>8192:
                raise OperatorError(413,'Serial request too large.','request_rejected')
            body.extend(chunk)
        headers={'Content-Type':'application/json'}
        if owner:
            headers['X-Control-Session']=hashlib.sha256((actor['username']+'\0'+owner).encode()).hexdigest()
        import httpx
        try:
            response=await client.request(request.method,'/api/v1/serial/'+path,content=bytes(body),headers=headers)
        except httpx.TransportError:
            raise OperatorError(503,'Serial receiver unavailable.','serial_unavailable') from None
        if response.status_code==401:
            raise OperatorError(503,'Serial receiver token was rejected.','serial_identity_rejected')
        return Response(response.content,status_code=response.status_code,media_type=response.headers.get('content-type','application/json'))
