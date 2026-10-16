"""Single-reader MAVLink dispatcher. No browser-supplied endpoints or raw commands."""
import asyncio
import math
import os
import time
from uuid import uuid4
os.environ.setdefault('MAVLINK20','1')
from pymavlink import mavutil
from .models import ConnectionState,Telemetry,Event,utc_now
from .simulator import Simulator,HOME
from .planning import require_valid, fence_state
from .preflight import evaluate
from .lifecycle import MissionLifecycle

M=mavutil.mavlink

def heartbeat_state(age, running=True):
    if not running: return ConnectionState.DISCONNECTED
    if age is None: return ConnectionState.CONNECTING
    if age>=10: return ConnectionState.DISCONNECTED
    if age>=3: return ConnectionState.STALE
    return ConnectionState.CONNECTED

def mission_items(mission):
    items=[dict(command=M.MAV_CMD_NAV_WAYPOINT,x=round(HOME[0]*1e7),y=round(HOME[1]*1e7),z=0.0)]
    items.append(dict(command=M.MAV_CMD_NAV_TAKEOFF,x=0,y=0,z=mission.takeoff_altitude_m))
    items.extend(dict(command=M.MAV_CMD_NAV_WAYPOINT,x=round(p.latitude*1e7),y=round(p.longitude*1e7),z=p.altitude_m) for p in mission.waypoints)
    last=mission.waypoints[-1]
    items.append(dict(command=M.MAV_CMD_NAV_LAND,x=round(last.latitude*1e7),y=round(last.longitude*1e7),z=0.0))
    return items

class MAVLinkManager:
    def __init__(self,store,simulator=None):
        self.store=store
        self.simulator=simulator or Simulator()
        self.link=None; self.reader=None; self.pending=[]; self.subscribers=set()
        self.operation=asyncio.Lock(); self.connect_lock=asyncio.Lock()
        self.telemetry=Telemetry(); self.state=ConnectionState.CLOSED
        self.last_heartbeat=None; self.started=0.0; self.field_times={}
        self.active_mission=None; self.upload_verified=False
        self.events=[]; self.sequence=0; self.controller=None; self.controller_seen=0.0
        self.observations={}
        self.last_fence_state=None
        self.lifecycle=MissionLifecycle();self.command_requests={}
        self.speedup=None;self.recording_context_id=None

    def claim(self,token):
        if not token or len(token)>100: raise PermissionError('Missing control session.')
        now=time.monotonic()
        if self.controller and self.controller!=token and now-self.controller_seen<15:
            raise PermissionError('Another browser owns the control session.')
        self.controller=token; self.controller_seen=now

    def require_control(self,token):
        if self.controller!=token or time.monotonic()-self.controller_seen>=15:
            raise PermissionError('Control session expired or belongs to another browser.')
        self.controller_seen=time.monotonic()

    def require_connected(self):
        if self.state!=ConnectionState.CONNECTED or not self.simulator.running or not self.link:
            raise RuntimeError('Simulator telemetry is not connected and current.')

    async def emit(self,kind,payload):
        if self.store.active and self.recording_context_id!=self.store.active:
            self.recording_context_id=self.store.active
            await self.emit('environment',dict(speedup=self.speedup,firmware='Copter-4.6.3',experiment=None))
        self.sequence+=1
        event=Event(type=kind,payload=payload).model_dump(); event['sequence']=self.sequence
        self.store.append(event)
        if kind!='telemetry': self.events=(self.events+[event])[-100:]
        for queue in tuple(self.subscribers):
            if queue.full():
                try: queue.get_nowait()
                except asyncio.QueueEmpty: pass
            queue.put_nowait(event)

    def status(self):
        return dict(state=self.state,telemetry=self.snapshot(),recording_id=self.store.active,
                    mission_lifecycle=self.lifecycle.snapshot(),
                    last_command=next((event['payload'] for event in reversed(self.events) if event['type']=='command'),None),
                    mission=self.active_mission.model_dump() if self.active_mission else None,
                    upload_verified=self.upload_verified,simulator_revision='Copter-4.6.3',simulator_owned=self.simulator.running,
                    event_sequence=self.sequence,events=self.events,home=dict(latitude=HOME[0],longitude=HOME[1],msl_altitude_m=HOME[2]))

    def snapshot(self):
        result=self.telemetry.model_copy()
        now=time.monotonic()
        result.received_utc=utc_now();result.elapsed_s=max(0,now-self.started) if self.started else 0
        result.connection=self.state
        result.heartbeat_age_s=now-self.last_heartbeat if self.last_heartbeat is not None else None
        result.position_fresh=now-self.field_times.get('position',-math.inf)<3 and self.state==ConnectionState.CONNECTED and result.navigation_ready
        if not result.position_fresh:
            result.latitude=result.longitude=result.relative_altitude_m=None
        if now-self.field_times.get('speed',-math.inf)>=3: result.ground_speed_ms=None
        if now-self.field_times.get('battery',-math.inf)>=5: result.battery_pct=result.battery_voltage_v=None
        if now-self.field_times.get('gps',-math.inf)>=3: result.gps_fix_type=None
        if now-self.field_times.get('ekf',-math.inf)>=3: result.navigation_ready=False;result.position_fresh=False;result.latitude=result.longitude=result.relative_altitude_m=None
        if self.state!=ConnectionState.CONNECTED:
            result.flight_mode=result.armed=None;result.navigation_ready=False
            result.ground_speed_ms=result.battery_pct=result.battery_voltage_v=None
            result.gps_fix_type=None
        return result.model_dump()

    async def connect(self,speedup=1):
        async with self.connect_lock:
            if self.reader and not self.reader.done(): raise RuntimeError('Disconnect before starting a new simulator.')
            self.telemetry=Telemetry();self.last_heartbeat=None;self.field_times={};self.active_mission=None;self.upload_verified=False
            self.lifecycle=MissionLifecycle()
            self.observations={}
            self.started=time.monotonic();self.state=ConnectionState.CONNECTING
            # Bind first; the dispatcher receives only this app-owned process's loopback stream.
            self.link=mavutil.mavlink_connection('udpin:127.0.0.1:14550',source_system=255,source_component=190,dialect='ardupilotmega')
            try:
                await self.simulator.start(speedup)
                self.speedup=speedup
                self.reader=asyncio.create_task(self._read(),name='single-mavlink-reader')
                await self.emit('connection',dict(state=self.state))
            except Exception:
                self.link.close();self.link=None;self.state=ConnectionState.CLOSED;await self.simulator.stop();raise
        return self.status()

    async def disconnect(self):
        async with self.connect_lock:
            if self.reader:
                self.reader.cancel()
                try: await self.reader
                except asyncio.CancelledError: pass
                self.reader=None
            for _,future in self.pending:
                if not future.done(): future.set_exception(RuntimeError('Simulator disconnected.'))
            self.pending=[]
            if self.link: self.link.close();self.link=None
            await self.simulator.stop()
            self.state=ConnectionState.CLOSED;await self.emit('connection',dict(state=self.state))
            self.store.stop_recording();self.controller=None;self.upload_verified=False

    async def _read(self):
        last_publish=last_send=last_request=0.0
        try:
            while True:
                now=time.monotonic()
                for _ in range(300):
                    message=self.link.recv_match(blocking=False)
                    if message is None: break
                    if message.get_type()=='BAD_DATA' or message.get_srcSystem()!=1 or message.get_srcComponent()!=1: continue
                    self._consume(message,now)
                    if message.get_type()=='HEARTBEAT': await self.observe_commands()
                    for predicate,future in tuple(self.pending):
                        if not future.done() and predicate(message): future.set_result(message)
                    if message.get_type()=='STATUSTEXT':
                        await self.emit('vehicle_message',dict(severity=message.severity,text=str(message.text)))
                    if message.get_type()=='MISSION_ITEM_REACHED':
                        self.lifecycle.reached(message.seq)
                        await self.emit('mission_progress',dict(reached_index=message.seq))
                age=now-self.last_heartbeat if self.last_heartbeat is not None else None
                next_state=heartbeat_state(age,self.simulator.running)
                if next_state!=self.state:
                    self.state=next_state;await self.emit('connection',dict(state=self.state))
                await self.observe_commands()
                if self.last_heartbeat is not None and now-last_send>=.2:
                    self.link.mav.heartbeat_send(M.MAV_TYPE_GCS,M.MAV_AUTOPILOT_INVALID,0,0,M.MAV_STATE_ACTIVE)
                    last_send=now
                if self.state==ConnectionState.CONNECTED and now-last_request>=5:
                    self.link.mav.request_data_stream_send(1,1,M.MAV_DATA_STREAM_ALL,5,1);last_request=now
                if now-last_publish>=.5:
                    snapshot=self.snapshot()
                    previous=self.lifecycle.snapshot()
                    current=self.lifecycle.observe(snapshot,self.upload_verified)
                    if current!=previous:await self.emit('mission_lifecycle',current)
                    state=fence_state(self.active_mission,snapshot)
                    if state!=self.last_fence_state:
                        self.last_fence_state=state
                        await self.emit('fence',dict(state=state,mission_id=self.active_mission.id if self.active_mission else None))
                    await self.emit('telemetry',snapshot);last_publish=now
                await asyncio.sleep(.02)
        except asyncio.CancelledError: raise
        except Exception as exc:
            self.state=ConnectionState.DISCONNECTED
            await self.emit('connection',dict(state=self.state,error=str(exc)))

    def _consume(self,message,now):
        kind=message.get_type()
        if kind=='HEARTBEAT':
            if message.autopilot!=M.MAV_AUTOPILOT_ARDUPILOTMEGA: return
            self.last_heartbeat=now
            self.telemetry.armed=bool(message.base_mode&M.MAV_MODE_FLAG_SAFETY_ARMED)
            self.telemetry.flight_mode=mavutil.mode_string_v10(message)
        elif kind=='GLOBAL_POSITION_INT':
            self.telemetry.latitude=message.lat/1e7;self.telemetry.longitude=message.lon/1e7
            self.telemetry.relative_altitude_m=message.relative_alt/1000
            self.telemetry.vehicle_time_ms=message.time_boot_ms;self.field_times['position']=now
            self.telemetry.ground_speed_ms=math.hypot(message.vx,message.vy)/100;self.field_times['speed']=now
        elif kind=='SYS_STATUS':
            self.telemetry.battery_pct=float(message.battery_remaining) if message.battery_remaining>=0 else None
            self.telemetry.battery_voltage_v=message.voltage_battery/1000 if message.voltage_battery!=65535 else None
            self.field_times['battery']=now
        elif kind=='MISSION_CURRENT': self.telemetry.mission_index=message.seq
        elif kind=='GPS_RAW_INT':
            self.telemetry.gps_fix_type=message.fix_type;self.field_times['gps']=now
        elif kind=='EKF_STATUS_REPORT':
            self.telemetry.navigation_ready=bool(message.flags&M.EKF_POS_HORIZ_ABS)
            self.field_times['ekf']=now

    async def response(self,predicate,send,timeout=8):
        future=asyncio.get_running_loop().create_future();entry=(predicate,future);self.pending.append(entry)
        try:
            send()
            return await asyncio.wait_for(future,timeout)
        finally:
            if entry in self.pending: self.pending.remove(entry)

    async def command_long(self,command,params,timeout=8):
        ack=await self.response(lambda m:m.get_type()=='COMMAND_ACK' and m.command==command,
            lambda:self.link.mav.command_long_send(1,1,command,0,*params),timeout)
        if ack.result not in [M.MAV_RESULT_ACCEPTED,M.MAV_RESULT_IN_PROGRESS]:
            raise RuntimeError(f'Autopilot rejected command: {M.enums["MAV_RESULT"][ack.result].name}.')
        return ack.result

    async def set_mode(self,mode):
        mapping=self.link.mode_mapping() or {}
        if mode not in mapping: raise RuntimeError(f'Unsupported flight mode {mode}.')
        return await self.command_long(M.MAV_CMD_DO_SET_MODE,[M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,mapping[mode],0,0,0,0,0])

    async def command(self,action,request_id=None):
        if request_id is None:return await self._command(action)
        previous=self.command_requests.get(request_id)
        if previous:
            if previous['action']!=action:raise ValueError('Request ID was already used for a different action.')
            if previous.get('error'):raise RuntimeError(previous['error'])
            if 'result' not in previous:raise RuntimeError('This request is already pending; it was not resent.')
            return previous['result']
        if len(self.command_requests)>=128:
            finished=next((key for key,value in self.command_requests.items() if 'result' in value or 'error' in value),None)
            if finished is None:raise RuntimeError('Command request capacity reached.')
            self.command_requests.pop(finished)
        entry={'action':action};self.command_requests[request_id]=entry
        try:
            entry['result']=await self._command(action)
            return entry['result']
        except BaseException as exc:
            entry['error']=str(exc) or 'Command interrupted; not automatically resent.'
            raise

    async def _command(self,action):
        self.require_connected()
        if self.operation.locked(): raise RuntimeError('Another mission/command operation is pending.')
        async with self.operation:
            if action in ('arm','start','resume'):
                assessment=evaluate(self,action,ignore_busy=True)
                await self.emit('preflight',assessment.model_dump())
                if action in ('start','resume') and self.active_mission:
                    require_valid(self.active_mission)
                if not assessment.ready:
                    raise RuntimeError('Preflight: '+'; '.join(c.id+': '+c.reason for c in assessment.checks if c.state!='ready'))
            identifier=str(uuid4());await self.emit('command',dict(id=identifier,action=action,status='requested'))
            try:
                if action=='arm':
                    if not self.snapshot()['position_fresh'] or not self.telemetry.navigation_ready: raise RuntimeError('Wait for a fresh position and a ready EKF position estimate.')
                    await self.command_long(M.MAV_CMD_COMPONENT_ARM_DISARM,[1,0,0,0,0,0,0])
                elif action=='start':
                    if not self.upload_verified or not self.telemetry.armed: raise RuntimeError('Arm and upload a verified mission before starting.')
                    require_valid(self.active_mission)
                    await self.set_mode('AUTO')
                    await self.command_long(M.MAV_CMD_MISSION_START,[0,0,0,0,0,0,0])
                elif action=='hold': await self.set_mode('BRAKE')
                elif action=='resume':
                    if not self.upload_verified or not self.telemetry.armed: raise RuntimeError('There is no active armed mission to resume.')
                    require_valid(self.active_mission)
                    await self.set_mode('AUTO')
                elif action=='return': await self.set_mode('RTL')
                elif action=='land': await self.set_mode('LAND')
                else: raise ValueError('Unsupported action.')
                result=dict(id=identifier,action=action,status='acknowledged',observed=False)
                await self.emit('command',result)
                self.observations[identifier]=dict(action=action,deadline=time.monotonic()+15)
                await self.observe_commands()
                return result
            except asyncio.TimeoutError:
                await self.emit('command',dict(id=identifier,action=action,status='timed_out'));raise RuntimeError('Command acknowledgment timed out; it was not automatically retried.')
            except Exception as exc:
                await self.emit('command',dict(id=identifier,action=action,status='failed',error=str(exc)));raise

    async def observe_commands(self):
        modes={'start':'AUTO','hold':'BRAKE','resume':'AUTO','return':'RTL','land':'LAND'}
        for identifier,observation in tuple(self.observations.items()):
            action=observation['action']
            matched=self.state==ConnectionState.CONNECTED and (self.telemetry.armed is True if action=='arm' else self.telemetry.flight_mode==modes[action])
            if matched:
                await self.emit('command',dict(id=identifier,action=action,status='observed',observed_mode=self.telemetry.flight_mode,armed=self.telemetry.armed))
                self.observations.pop(identifier,None)
            elif time.monotonic()>observation['deadline']:
                await self.emit('command',dict(id=identifier,action=action,status='not_observed',error='Acknowledged command was not observed in telemetry within 15 seconds.'))
                self.observations.pop(identifier,None)

    def send_item(self,seq,item):
        self.link.mav.mission_item_int_send(1,1,seq,M.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,item['command'],0,1,0,0,0,0,item['x'],item['y'],item['z'],M.MAV_MISSION_TYPE_MISSION)

    async def upload(self,mission):
        self.require_connected()
        require_valid(mission)
        if self.telemetry.armed: raise RuntimeError('Mission changes require a disarmed simulator.')
        if self.operation.locked(): raise RuntimeError('Another mission/command operation is pending.')
        async with self.operation:
            self.upload_verified=False
            items=mission_items(mission);requested=set();last_send=lambda:self.link.mav.mission_count_send(1,1,len(items),M.MAV_MISSION_TYPE_MISSION)
            await self.emit('mission_transfer',dict(status='uploading',total=len(items)))
            retries=0
            while True:
                try:
                    message=await self.response(lambda m:m.get_type() in ['MISSION_REQUEST_INT','MISSION_REQUEST','MISSION_ACK'],last_send,3)
                except asyncio.TimeoutError:
                    retries+=1
                    if retries>3: raise RuntimeError('Mission upload timed out.')
                    continue
                retries=0
                if message.get_type()=='MISSION_ACK':
                    if message.type!=M.MAV_MISSION_ACCEPTED or len(requested)!=len(items): raise RuntimeError('Mission upload was rejected or incomplete.')
                    break
                if not 0<=message.seq<len(items): raise RuntimeError('Autopilot requested an invalid mission index.')
                requested.add(message.seq);index=message.seq
                last_send=lambda index=index:self.send_item(index,items[index])
                await self.emit('mission_transfer',dict(status='uploading',received=len(requested),total=len(items)))
            downloaded=await self._download()
            if len(downloaded)!=len(items): raise RuntimeError('Readback mission length differs.')
            for original,readback in zip(items[1:],downloaded[1:]):
                if original['command']!=readback['command'] or abs(original['z']-readback['z'])>.1:
                    raise RuntimeError('Readback command/altitude differs.')
                if original['x'] and (abs(original['x']-readback['x'])>2 or abs(original['y']-readback['y'])>2): raise RuntimeError('Readback coordinates differ.')
            self.active_mission=mission;self.upload_verified=True
            self.lifecycle=MissionLifecycle(len(mission.waypoints))
            await self.emit('mission_transfer',dict(status='verified',total=len(items)))
            return dict(status='verified',mission=mission.model_dump(),items=downloaded)

    async def _download(self):
        count=None
        for _ in range(4):
            try:
                message=await self.response(lambda m:m.get_type()=='MISSION_COUNT',lambda:self.link.mav.mission_request_list_send(1,1,M.MAV_MISSION_TYPE_MISSION),3)
                count=message.count;break
            except asyncio.TimeoutError: pass
        if count is None or count>53: raise RuntimeError('Mission download failed or exceeds the supported item count.')
        items=[]
        for index in range(count):
            item=None
            for _ in range(4):
                try:
                    item=await self.response(lambda m:m.get_type()=='MISSION_ITEM_INT' and m.seq==index,
                        lambda:self.link.mav.mission_request_int_send(1,1,index,M.MAV_MISSION_TYPE_MISSION),3);break
                except asyncio.TimeoutError: pass
            if item is None: raise RuntimeError(f'Mission item {index} download timed out.')
            items.append(dict(command=item.command,x=item.x,y=item.y,z=item.z,frame=item.frame))
        self.link.mav.mission_ack_send(1,1,M.MAV_MISSION_ACCEPTED,M.MAV_MISSION_TYPE_MISSION)
        return items

    async def download(self):
        self.require_connected()
        if self.operation.locked(): raise RuntimeError('Another operation is pending.')
        async with self.operation: return await self._download()

    async def set_parameter(self,name,value):
        """Internal integration-test helper; no arbitrary parameter API is exposed."""
        self.require_connected()
        ack=await self.response(lambda m:m.get_type()=='PARAM_VALUE' and str(m.param_id).rstrip('\x00')==name,
            lambda:self.link.mav.param_set_send(1,1,name.encode(),float(value),M.MAV_PARAM_TYPE_REAL32),8)
        if abs(ack.param_value-value)>.01: raise RuntimeError(f'Parameter {name} readback differs.')
        return ack.param_value
