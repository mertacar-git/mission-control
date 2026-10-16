"""Action-specific preflight checks. Unknown measurements never become readiness."""
import hashlib
import json
import time
import struct
from .models import StrictModel, utc_now
from .planning import validate_planning
from typing import Literal

class ReadinessCheck(StrictModel):
    id: str
    state: Literal['ready','blocked','unknown']
    reason: str

class Preflight(StrictModel):
    action: Literal['arm','start','resume']
    evaluated_utc: str
    mission_fingerprint: str | None
    ready: bool
    checks: list[ReadinessCheck]

def mission_fingerprint(mission):
    if mission is None:return None
    body=mission.model_dump() if hasattr(mission,'model_dump') else mission
    # Operational content, independent of editable name/id and generation labels.
    content={k:body.get(k) for k in ('takeoff_altitude_m','waypoints','planning')}
    def canonical(value):
        if isinstance(value,(int,float)) and not isinstance(value,bool):return {'f64':struct.pack('>d',float(value) if value else 0.0).hex()}
        if isinstance(value,list):return [canonical(v) for v in value]
        if isinstance(value,dict):return {k:canonical(v) for k,v in sorted(value.items())}
        return value
    return 'mcfp1:'+hashlib.sha256(json.dumps(canonical(content),sort_keys=True,separators=(',',':')).encode()).hexdigest()

def evaluate(manager,action,token=None,ignore_busy=False):
    t=manager.snapshot();mission=manager.active_mission
    checks=[]
    def check(identifier,value,reason):
        checks.append(ReadinessCheck(id=identifier,state='unknown' if value is None else 'ready' if value else 'blocked',reason=reason))
    owner=True if token is None else manager.controller==token and time.monotonic()-manager.controller_seen<15
    check('controller',owner,'Kontrol oturumu geçerli' if owner else 'Kontrolü sahiplenin; başka geçerli sahip olabilir')
    check('simulator',manager.simulator.running,'Uygulamanın başlattığı SITL çalışmalı')
    check('connection',manager.state=='connected','Telemetri bağlantısı güncel olmalı')
    check('position',t['position_fresh'],'Konum ölçümü 3 saniyeden yeni ve EKF hazır olmalı')
    check('gps',None if t['gps_fix_type'] is None else t['gps_fix_type']>=3,'GPS fix türü en az 3 olmalı')
    check('ekf',t['navigation_ready'],'EKF mutlak yatay konum tahmini hazır olmalı')
    check('battery',None if t['battery_pct'] is None else t['battery_pct']>=20,'5 saniyeden yeni batarya ölçümü en az %20 olmalı')
    check('operation',ignore_busy or not manager.operation.locked(),'Başka görev aktarımı veya komut beklememeli')
    if action in ('start','resume'):
        check('armed',t['armed'],'Motorların armed olduğu güncel telemetride gözlenmeli')
        check('upload',manager.upload_verified,'Yüklenen görev geri okunarak doğrulanmış olmalı')
        validity=validate_planning(mission) if mission else None
        check('mission',None if validity is None else validity['valid'],'Yüklenmiş görev geometrisi ve sınırları geçerli olmalı')
    else:
        check('disarmed',None if t['armed'] is None else not t['armed'],'Arm için araç disarmed olmalı')
    return Preflight(action=action,evaluated_utc=utc_now(),mission_fingerprint=mission_fingerprint(mission),
                     ready=all(c.state=='ready' for c in checks),checks=checks)
