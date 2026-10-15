import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI,HTTPException,Header,Request,WebSocket,WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response,FileResponse
from pydantic import BaseModel,Field
from .models import Mission,ConnectionRequest,CommandRequest,StrictModel
from .store import Store
from .mavlink import MAVLinkManager
from .analysis import report
from .planning import validate_planning
from .scenarios import ScenarioRunner
from .execution import execution_report
from .emulator import Emulator
from typing import Literal

class ScenarioRequest(BaseModel):
    kind: Literal['heartbeat_loss','low_battery','gps_loss']

class RecordingRequest(BaseModel):
    name: str = Field(default='SITL uçuş kaydı',min_length=1,max_length=100)

class EmulatorRequest(StrictModel):
    profile: Literal['nominal','loss','corruption','reorder','mixed','sensor_gap','restart']='mixed'
    seed: int = Field(default=42,ge=0,le=2147483647,strict=True)
    duration_s: int = Field(default=10,ge=5,le=60,strict=True)

def create_app(database=None,manager_factory=MAVLinkManager):
    root=Path(__file__).resolve().parents[2]
    store=Store(database or root/'.runtime/mission-control.sqlite3')
    manager=manager_factory(store)
    scenarios=ScenarioRunner(manager,store)
    emulator=Emulator(store)
    @asynccontextmanager
    async def lifespan(app):
        yield
        await emulator.stop()
        await scenarios.close()
        await manager.disconnect();store.close()
    app=FastAPI(title='Mission Control',version='1.7.0',lifespan=lifespan)
    app.state.manager=manager;app.state.store=store
    origins=['http://localhost:5173','http://127.0.0.1:5173','http://localhost:8000','http://127.0.0.1:8000']
    app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=['GET','POST','DELETE'],allow_headers=['Content-Type','X-Control-Session'])
    @app.middleware('http')
    async def origin_guard(request:Request,call_next):
        origin=request.headers.get('origin')
        if request.method not in ['GET','HEAD','OPTIONS'] and origin and origin not in origins:
            return Response('Origin not allowed',status_code=403)
        return await call_next(request)
    def control(token):
        if scenarios.active: raise HTTPException(409,'An automatic SITL experiment owns control until cleanup completes.')
        try: manager.require_control(token)
        except PermissionError as exc: raise HTTPException(409,str(exc))
    def translate(exc):
        return HTTPException(409,str(exc))
    @app.get('/api/v1/health')
    def health(): return dict(status='ok',version='1.7.0',transport='owned-sitl-only')
    @app.get('/api/v1/emulator')
    def emulator_status():return emulator.status()
    @app.post('/api/v1/emulator')
    async def start_emulator(body:EmulatorRequest,x_control_session:str=Header(...)):
        if not 1<=len(x_control_session)<=100:raise HTTPException(422,'Invalid session token.')
        try:return emulator.start(x_control_session,body.profile,body.seed,body.duration_s)
        except (RuntimeError,ValueError) as exc:raise translate(exc)
    @app.post('/api/v1/emulator/stop')
    async def stop_emulator(x_control_session:str=Header(...)):
        if emulator.owner!=x_control_session:raise HTTPException(409,'Another session owns the emulator.')
        await emulator.stop();return emulator.status()
    @app.get('/api/v1/emulator/runs')
    def emulator_runs():return [{k:v for k,v in run.items() if k!='packets'} for run in store.emulator_runs()]
    @app.get('/api/v1/emulator/runs/{identifier}')
    def emulator_run(identifier:str):
        try:return store.emulator_run(identifier)
        except KeyError:raise HTTPException(404,'Emulator recording not found.')
    @app.get('/api/v1/status')
    def status(): return dict(**manager.status(),scenario_active=scenarios.active)
    @app.post('/api/v1/connection')
    async def connect(body:ConnectionRequest,x_control_session:str=Header(...)):
        if scenarios.active: raise HTTPException(409,'A SITL experiment is running.')
        try:
            manager.claim(x_control_session)
            return await manager.connect(body.speedup)
        except (RuntimeError,PermissionError,OSError) as exc: raise translate(exc)
    @app.delete('/api/v1/connection')
    async def disconnect(x_control_session:str=Header(...)):
        control(x_control_session);await manager.disconnect();return manager.status()
    @app.post('/api/v1/control/renew')
    def renew(x_control_session:str=Header(...)):
        try: manager.require_control(x_control_session)
        except PermissionError as exc: raise translate(exc)
        return dict(status='renewed')
    @app.get('/api/v1/missions')
    def missions(): return store.missions()
    @app.get('/api/v1/scenarios')
    def scenario_runs(): return store.scenario_runs()
    @app.post('/api/v1/scenarios')
    async def start_scenario(body:ScenarioRequest,x_control_session:str=Header(...)):
        try:
            if scenarios.active: raise RuntimeError('A SITL experiment is already running.')
            manager.claim(x_control_session)
            return scenarios.start(body.kind)
        except (RuntimeError,PermissionError,ValueError) as exc: raise translate(exc)
    @app.post('/api/v1/scenarios/cancel')
    async def cancel_scenario(x_control_session:str=Header(...)):
        try: manager.require_control(x_control_session)
        except PermissionError as exc: raise translate(exc)
        await scenarios.close()
        return dict(status='stopped')
    @app.post('/api/v1/missions')
    def save_mission(mission:Mission): return store.save_mission(mission)
    @app.post('/api/v1/missions/validate')
    def validate_mission(mission:Mission): return validate_planning(mission)
    @app.delete('/api/v1/missions/{identifier}')
    def delete_mission(identifier:str): store.delete_mission(identifier);return dict(status='deleted')
    @app.post('/api/v1/missions/{identifier}/upload')
    async def upload(identifier:str,x_control_session:str=Header(...)):
        control(x_control_session)
        try: return await manager.upload(store.mission(identifier))
        except KeyError: raise HTTPException(404,'Mission not found.')
        except (RuntimeError,ValueError) as exc: raise translate(exc)
    @app.get('/api/v1/vehicle/mission')
    async def download():
        if scenarios.active: raise HTTPException(409,'A SITL experiment owns the mission transport.')
        try: return dict(items=await manager.download())
        except RuntimeError as exc: raise translate(exc)
    @app.post('/api/v1/commands')
    async def command(body:CommandRequest,x_control_session:str=Header(...)):
        control(x_control_session)
        try: return await manager.command(body.action)
        except (RuntimeError,ValueError) as exc: raise translate(exc)
    @app.post('/api/v1/recordings')
    async def recording(body:RecordingRequest,x_control_session:str=Header(...)):
        control(x_control_session)
        try:
            manager.require_connected()
            identifier=store.start_recording(body.name,manager.active_mission.model_dump() if manager.active_mission else None)
            await manager.emit('recording',dict(status='started',id=identifier))
            return dict(id=identifier)
        except (RuntimeError,ValueError) as exc: raise translate(exc)
    @app.post('/api/v1/recordings/stop')
    async def stop_recording(x_control_session:str=Header(...)):
        control(x_control_session)
        await manager.emit('recording',dict(status='stopped',id=store.active))
        return dict(id=store.stop_recording())
    @app.get('/api/v1/recordings')
    def recordings(): return store.sessions()
    def session(identifier):
        try: return store.session(identifier)
        except KeyError: raise HTTPException(404,'Recording not found.')
    @app.get('/api/v1/recordings/{identifier}')
    def get_recording(identifier:str): return session(identifier)
    @app.get('/api/v1/recordings/{identifier}/csv')
    def csv(identifier:str):
        session(identifier)
        return Response(store.csv(identifier),media_type='text/csv',headers={'Content-Disposition':'attachment; filename="flight.csv"'})
    @app.get('/api/v1/recordings/{identifier}/execution')
    def execution(identifier:str,corridor:float=5):
        try:return execution_report(session(identifier),corridor)
        except ValueError as exc:raise HTTPException(422,str(exc))
    @app.get('/api/v1/recordings/{identifier}/report')
    def report_session(identifier:str,max_altitude:float=80,min_battery:float=20):
        try: return report(session(identifier),max_altitude,min_battery)
        except ValueError as exc: raise HTTPException(422,str(exc))
    @app.websocket('/ws')
    async def websocket(ws:WebSocket):
        origin=ws.headers.get('origin')
        if origin and origin not in origins: await ws.close(code=1008);return
        await ws.accept();queue=asyncio.Queue(maxsize=256);manager.subscribers.add(queue)
        try:
            await ws.send_json(dict(type='snapshot',payload=manager.status()))
            while True:
                try: event=await asyncio.wait_for(queue.get(),10)
                except asyncio.TimeoutError: event=dict(type='keepalive',payload={})
                await ws.send_json(event)
        except (WebSocketDisconnect,RuntimeError): pass
        finally: manager.subscribers.discard(queue)
    # Production local mode serves the same built frontend on port 8000.
    dist=root/'frontend/dist'
    @app.get('/{path:path}',include_in_schema=False)
    def frontend(path:str):
        target=(dist/path).resolve()
        if not target.is_relative_to(dist.resolve()): raise HTTPException(404)
        if target.is_file(): return FileResponse(target)
        if dist.joinpath('index.html').is_file(): return FileResponse(dist/'index.html')
        raise HTTPException(404,'Build frontend or run the Vite development server.')
    return app

app=create_app()
