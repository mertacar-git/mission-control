import math

EARTH_RADIUS_M=6371000.0

def distance_m(a,b):
    lat1,lat2=math.radians(a[0]),math.radians(b[0])
    dlat=lat2-lat1; dlon=math.radians(b[1]-a[1])
    return 2*EARTH_RADIUS_M*math.asin(min(1,math.sqrt(math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2)))

def route_deviation_m(point, waypoints):
    if not waypoints: return None
    lat0=math.radians(point[0])
    def xy(w):
        return (EARTH_RADIUS_M*math.radians(w['longitude']-point[1])*math.cos(lat0),EARTH_RADIUS_M*math.radians(w['latitude']-point[0]))
    coordinates=[xy(w) for w in waypoints]
    if len(coordinates)==1: return math.hypot(*coordinates[0])
    best=math.inf
    for a,b in zip(coordinates,coordinates[1:]):
        dx=b[0]-a[0];dy=b[1]-a[1];norm=dx*dx+dy*dy
        t=max(0,min(1,-(a[0]*dx+a[1]*dy)/norm)) if norm else 0
        best=min(best,math.hypot(a[0]+t*dx,a[1]+t*dy))
    return best

def report(recording, max_altitude=80, min_battery=20):
    if not math.isfinite(max_altitude) or not math.isfinite(min_battery) or not 0<=min_battery<=100: raise ValueError('Invalid report thresholds.')
    rows=[e['payload'] for e in recording['events'] if e['type']=='telemetry']
    altitude=[r['relative_altitude_m'] for r in rows if r.get('relative_altitude_m') is not None]
    speeds=[r['ground_speed_ms'] for r in rows if r.get('ground_speed_ms') is not None]
    batteries=[r['battery_pct'] for r in rows if r.get('battery_pct') is not None]
    mission=recording['session'].get('mission') or {}
    waypoints=mission.get('waypoints',[])
    fresh=[r for r in rows if r.get('position_fresh') and r.get('latitude') is not None and r.get('longitude') is not None]
    deviations=[route_deviation_m((r['latitude'],r['longitude']),waypoints) for r in fresh] if waypoints else []
    route_distance=sum(distance_m((a['latitude'],a['longitude']),(b['latitude'],b['longitude'])) for a,b in zip(fresh,fresh[1:]) if b['elapsed_s']-a['elapsed_s']<=3)
    gaps=sum(b['elapsed_s']-a['elapsed_s']>3 for a,b in zip(rows,rows[1:]))
    return dict(schema_version=1,samples=len(rows),duration_s=max(0,rows[-1]['elapsed_s']-rows[0]['elapsed_s']) if rows else 0,
                peak_relative_altitude_m=max(altitude) if altitude else None,peak_ground_speed_ms=max(speeds) if speeds else None,
                battery_used_percentage_points=batteries[0]-batteries[-1] if batteries else None,
                observed_ground_distance_m=route_distance,max_route_deviation_m=max(deviations) if deviations else None,
                recording_gaps=gaps,altitude_alert_samples=sum(v>max_altitude for v in altitude),battery_alert_samples=sum(v<min_battery for v in batteries),
                thresholds=dict(max_altitude_m=max_altitude,min_battery_pct=min_battery),
                notes='Altitude is relative to home; speed is ground speed. Route deviation uses a local tangent-plane approximation to mission segments. Gaps >3 s are excluded from distance integration; stale positions are not treated as new measurements.')
