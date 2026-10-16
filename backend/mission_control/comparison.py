"""Multi-flight reports, preserving unknown endpoints and recording conditions."""
from .analysis import report
from .preflight import mission_fingerprint
from .lifecycle import MissionLifecycle
from .execution import execution_report
from .models import StrictModel
from typing import Literal

class FlightSummary(StrictModel):
    id:str
    name:str
    source:Literal['sitl','demo']
    mission_fingerprint:str|None
    completion:Literal['completed','unknown']
    observed_flight_s:float|None
    speedup:float|None
    firmware:str|None
    experiment:dict|str|None
    metrics:dict[str,float|int|None]

class FlightComparison(StrictModel):
    schema_version:Literal[1]=1
    items:list[FlightSummary]
    warnings:list[str]
    assumptions:str

def flight_summary(recording):
    session=recording['session'];mission=session.get('mission')
    life=MissionLifecycle(len(mission['waypoints']) if mission else 0)
    previous=None;started=None;intervals=[];incomplete=False
    for event in recording['events']:
        if event['type']=='mission_progress':life.reached(event['payload']['reached_index'])
        if event['type']!='telemetry':continue
        row=event['payload']
        if session['source']=='sitl':life.observe(row,mission is not None)
        fresh=row.get('connection')=='connected' and row.get('armed') is not None
        consecutive=previous is not None and fresh and previous.get('connection')=='connected' and 0<row['elapsed_s']-previous['elapsed_s']<=3
        if not consecutive:
            if started is not None or row.get('armed') is True:incomplete=True
            started=None
        if consecutive and previous.get('armed') is False and row['armed'] is True:started=row['elapsed_s']
        if consecutive and previous.get('armed') is True and row['armed'] is False:
            if started is not None:intervals.append(row['elapsed_s']-started)
            started=None
        previous=row
    environment=next((e['payload'] for e in recording['events'] if e['type']=='environment'),{})
    metrics=report(recording)
    deviations=[leg['max_deviation_m'] for leg in execution_report(recording)['legs'] if leg['max_deviation_m'] is not None]
    metrics['max_route_deviation_m']=max(deviations) if deviations else None
    batteries=[e['payload']['battery_pct'] for e in recording['events'] if e['type']=='telemetry' and e['payload'].get('battery_pct') is not None]
    if len(batteries)<2:metrics['battery_used_percentage_points']=None
    boundary_observed=bool(mission and mission.get('planning') and mission['planning'].get('allowed_area') and any(e['type']=='telemetry' and e['payload'].get('position_fresh') for e in recording['events']))
    if not boundary_observed:metrics['fence_violation_count']=metrics['fence_observed_violation_s']=None
    return dict(id=session['id'],name=session['name'],source=session['source'],
        mission_fingerprint=mission_fingerprint(mission),
        completion='completed' if life.completed else 'unknown',
        observed_flight_s=intervals[0] if len(intervals)==1 and started is None and not incomplete else None,
        speedup=environment.get('speedup'),firmware=environment.get('firmware'),
        experiment=environment.get('experiment'),
        metrics={k:metrics[k] for k in ('max_route_deviation_m','recording_gaps','fence_violation_count',
            'fence_observed_violation_s','battery_used_percentage_points','peak_relative_altitude_m','peak_ground_speed_ms')})

def compare_recordings(recordings):
    if not 2<=len(recordings)<=5:raise ValueError('Select 2–5 recordings.')
    if len({r['session']['id'] for r in recordings})!=len(recordings):raise ValueError('Recording IDs must be unique.')
    items=[flight_summary(r) for r in recordings];warnings=[]
    if any(i['mission_fingerprint'] is None for i in items):warnings.append('Görev bilgisi eksik; aynı görev olduğu doğrulanamaz.')
    if len({i['mission_fingerprint'] for i in items})>1:warnings.append('Rota veya planlama içeriği farklı; aynı görevin tekrarı değildir.')
    if len({i['source'] for i in items})>1:warnings.append('Veri kaynakları farklı.')
    if any(i['speedup'] is None or i['firmware'] is None for i in items):warnings.append('En az bir kaydın simülasyon koşulları bilinmiyor.')
    if len({i['speedup'] for i in items if i['speedup'] is not None})>1:warnings.append('Simülasyon hızları farklı; süreler doğrudan eşdeğer değildir.')
    if len({i['firmware'] for i in items if i['firmware'] is not None})>1:warnings.append('Firmware sürümleri farklı.')
    if len({str(i['experiment']) for i in items})>1:warnings.append('Deney ayarları farklı veya eksik.')
    return dict(schema_version=1,items=items,warnings=warnings,
        assumptions='Süre yalnızca kayıtta gözlenen kesintisiz arm/disarm aralığıdır. Eksik uçlar veya veri boşluğu süre üretmez. Otomatik kazanan seçilmez.')
