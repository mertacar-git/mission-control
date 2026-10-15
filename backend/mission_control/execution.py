"""Task-index attribution; no nearest-neighbor assignment between adjacent survey lines."""
import math
from .planning import xy
from .simulator import HOME
from datetime import datetime

def execution_report(recording,corridor=5):
    if not math.isfinite(corridor) or not .1<=corridor<=100: raise ValueError('Corridor half width must be 0.1–100 m.')
    m=recording['session'].get('mission');source=recording['session']['source']
    output=dict(schema_version=1,source=source,mission_id=m['id'] if m else None,corridor_half_width_m=corridor,provenance_valid=False,legs=[],observed_survey_fraction=None)
    if not m:return output
    generation=m.get('generation')
    valid=bool(generation and generation['waypoints']==m['waypoints'] and generation['takeoff_altitude_m']==m['takeoff_altitude_m'])
    output['provenance_valid']=valid
    points=[(0,0)]+[xy(w) for w in m['waypoints']]
    rows=[e['payload'] for e in recording['events'] if e['type']=='telemetry'];legs=output['legs']
    intervals=[[] for _ in m['waypoints']];speeds=[[] for _ in m['waypoints']]
    for i in range(len(m['waypoints'])):
        legs.append(dict(index=i,kind=('survey' if i in generation['survey_leg_indices'] else 'connector') if valid else 'unclassified',planned_m=math.dist(points[i],points[i+1]),samples=0,observed_s=None,max_deviation_m=None,mean_speed_ms=None,observed_corridor_m=0 if valid else None,turn_peak_deviation_m=None,turn_speed_change_ms=None))
    def assigned(r):
        if r['connection']!='connected' or not r['position_fresh'] or r['latitude'] is None or r['longitude'] is None or r['flight_mode']!='AUTO' or r['armed'] is not True or r['mission_index'] is None:return None
        index=r['mission_index']-(2 if r['source']=='sitl' else 1)
        return index if isinstance(index,int) and 0<=index<len(legs) else None
    def projection(r,index):
        p=xy(r);a,b=points[index:index+2];dx,dy=b[0]-a[0],b[1]-a[1];norm=dx*dx+dy*dy
        t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/norm)) if norm else 0
        return t,math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
    for i,r in enumerate(rows):
        index=assigned(r)
        if index is None:continue
        leg=legs[index];t,d=projection(r,index);leg['samples']+=1;leg['max_deviation_m']=max(leg['max_deviation_m'] or 0,d)
        if r['ground_speed_ms'] is not None:speeds[index].append(r['ground_speed_ms'])
        if not i:continue
        previous=rows[i-1];dt=r['elapsed_s']-previous['elapsed_s']
        if assigned(previous)!=index or not 0<dt<=3:continue
        leg['observed_s']=(leg['observed_s'] or 0)+dt
        before,deviation=projection(previous,index)
        if valid and d<=corridor and deviation<=corridor:intervals[index].append((min(before,t),max(before,t)))
    def timestamp(s):return datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
    if rows:
        for event in recording['events']:
            if event['type']!='mission_progress':continue
            reached=event['payload'].get('reached_index',-100)-(2 if source=='sitl' else 1)
            if not isinstance(reached,int) or not 0<=reached<len(legs)-1:continue
            at=rows[0]['elapsed_s']+timestamp(event['received_utc'])-timestamp(rows[0]['received_utc'])
            window=[r for r in rows if abs(r['elapsed_s']-at)<=2 and assigned(r) in [reached,reached+1]]
            if window:legs[reached]['turn_peak_deviation_m']=max(projection(r,assigned(r))[1] for r in window)
            before=[r for r in window if r['elapsed_s']<=at and r['ground_speed_ms'] is not None];after=[r for r in window if r['elapsed_s']>at and r['ground_speed_ms'] is not None]
            if before and after and after[0]['elapsed_s']-before[-1]['elapsed_s']<=3:legs[reached]['turn_speed_change_ms']=after[0]['ground_speed_ms']-before[-1]['ground_speed_ms']
    for i,leg in enumerate(legs):
        if speeds[i]:leg['mean_speed_ms']=sum(speeds[i])/len(speeds[i])
        if valid:
            end=-math.inf;total=0
            for a,b in sorted(intervals[i]):total+=max(0,b-max(a,end));end=max(end,b)
            leg['observed_corridor_m']=total*leg['planned_m']
    survey=[l for l in legs if l['kind']=='survey'];total=sum(l['planned_m'] for l in survey)
    if total and any(l['samples'] for l in survey):output['observed_survey_fraction']=sum(l['observed_corridor_m'] for l in survey)/total
    return output
