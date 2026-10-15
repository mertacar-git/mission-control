"""Independent planar mission validation. This never configures an autopilot fence."""
import math
from shapely.geometry import Point, Polygon, LineString
from .simulator import HOME

SCALE=6371000*math.pi/180
COS=math.cos(math.radians(HOME[0]))
TOLERANCE_M=.1

def xy(p): return ((p['longitude']-HOME[1])*SCALE*COS,(p['latitude']-HOME[0])*SCALE)

def polygon_error(points):
    if not 3<=len(points)<=60: return 'Area must contain 3–60 vertices.'
    if any(math.hypot(*v)>2000+TOLERANCE_M for v in points): return 'Area exceeds the 2 km planning radius.'
    if any(math.dist(a,b)<1e-6 for i,a in enumerate(points) for b in points[i+1:]): return 'Remove repeated vertices.'
    shape=Polygon(points)
    if not shape.is_valid or shape.area<1: return 'Area must be simple and at least 1 square metre.'
    return None

def validate_planning(mission):
    m=mission.model_dump() if hasattr(mission,'model_dump') else mission
    route=[(0,0),*[xy(w) for w in m['waypoints']]]
    distance=sum(math.dist(a,b) for a,b in zip(route,route[1:]))
    issues=[]
    def issue(code,message,**indices): issues.append(dict(code=code,message=message,**indices))
    p=m.get('planning')
    if p:
        fence=[xy(w) for w in p['allowed_area']];survey=[xy(w) for w in p['survey_area']]
        fe=polygon_error(fence);se=polygon_error(survey) if survey else None
        if fe: issue('polygon',fe,area='allowed_area')
        if se: issue('polygon',se,area='survey_area')
        if not fe:
            region=Polygon(fence).buffer(TOLERANCE_M)
            if not region.covers(Point(0,0)): issue('home_outside','Home is outside the allowed area.')
            if survey and not se and not region.covers(Polygon(survey)): issue('survey_outside','Survey area must be inside the allowed area.',area='survey_area')
            for i,(a,b) in enumerate(zip(route,route[1:])):
                geometry=Point(a) if math.dist(a,b)<1e-8 else LineString([a,b])
                if not region.covers(geometry): issue('segment_outside',f'Route segment {i+1} leaves the allowed area.',segment_index=i)
        if m['takeoff_altitude_m']>p['max_altitude_m']: issue('altitude','Takeoff exceeds the mission altitude limit.')
        for i,w in enumerate(m['waypoints']):
            if w['altitude_m']>p['max_altitude_m']: issue('altitude',f'Waypoint {i+1} exceeds the altitude limit.',waypoint_index=i)
            if math.hypot(*xy(w))>2000+TOLERANCE_M: issue('range',f'Waypoint {i+1} exceeds the 2 km planning radius.',waypoint_index=i)
        if distance>p['max_distance_m']+TOLERANCE_M: issue('distance','Route exceeds the mission distance limit.')
    return dict(valid=not issues,distance_m=distance,issues=issues)

def require_valid(mission):
    result=validate_planning(mission)
    if not result['valid']: raise ValueError(' '.join(i['message'] for i in result['issues']))
    return result

def fence_state(mission,t):
    m=mission.model_dump() if hasattr(mission,'model_dump') else mission
    p=m.get('planning') if m else None
    if not p: return 'unconfigured'
    if t.get('connection')!='connected' or not t.get('position_fresh') or any(t.get(k) is None for k in ['latitude','longitude','relative_altitude_m']): return 'unknown'
    points=[xy(w) for w in p['allowed_area']]
    if polygon_error(points): return 'unknown'
    inside=Polygon(points).buffer(TOLERANCE_M).covers(Point(xy(t)))
    return 'inside' if inside and t['relative_altitude_m']<=p['max_altitude_m']+TOLERANCE_M else 'outside'

def fence_metrics(mission,rows):
    count=0;seconds=0.;previous='unknown'
    for i,row in enumerate(rows):
        state=fence_state(mission,row)
        if state=='outside' and previous!='outside': count+=1
        if i and state=='outside' and previous=='outside':
            dt=row['elapsed_s']-rows[i-1]['elapsed_s']
            if 0<dt<=3: seconds+=dt
        previous=state
    return dict(fence_violation_count=count,fence_observed_violation_s=seconds)
