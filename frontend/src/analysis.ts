import type {Recording,Report,Telemetry,Waypoint} from './types';
export const distance=(a:Waypoint|{latitude:number;longitude:number},b:Waypoint|{latitude:number;longitude:number})=>{
  const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;
  return 2*6371000*Math.asin(Math.min(1,Math.sqrt(Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2)));
};
export function frames(recording:Recording):Telemetry[]{return recording.events.filter(e=>e.type==='telemetry').map(e=>e.payload as unknown as Telemetry);}
export function eventsAt(recording:Recording,seconds:number){
  const first=frames(recording)[0];
  if(!first)return [];
  // elapsed_s starts at connection, not recording start; align both clocks using a recorded sample.
  const cutoff=Date.parse(first.received_utc)+(seconds-first.elapsed_s)*1000;
  return recording.events.filter(event=>Date.parse(event.received_utc)<=cutoff);
}
export function frameAt(rows:Telemetry[],seconds:number):Telemetry|null {
  if(!rows.length)return null;
  let left=0,right=rows.length-1;
  while(left<right){const mid=Math.ceil((left+right)/2);if(rows[mid].elapsed_s<=seconds)left=mid;else right=mid-1;}
  const row=rows[left];
  if(row.elapsed_s>seconds)return null;
  return seconds-row.elapsed_s>3?{...row,connection:'stale',position_fresh:false,latitude:null,longitude:null,relative_altitude_m:null,ground_speed_ms:null}:row;
}
export function deviation(point:{latitude:number;longitude:number},points:Waypoint[]):number|null {
  if(!points.length)return null;const scale=6371000*Math.PI/180;
  const xy=points.map(w=>[(w.longitude-point.longitude)*scale*Math.cos(point.latitude*Math.PI/180),(w.latitude-point.latitude)*scale]);
  if(xy.length===1)return Math.hypot(...xy[0]);
  let best=Infinity;
  for(let i=1;i<xy.length;i++){const a=xy[i-1],b=xy[i],dx=b[0]-a[0],dy=b[1]-a[1],norm=dx*dx+dy*dy,t=norm?Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/norm)):0;best=Math.min(best,Math.hypot(a[0]+t*dx,a[1]+t*dy));}
  return best;
}
export function analyze(recording:Recording,maxAltitude=80,minBattery=20):Report {
  if(!Number.isFinite(maxAltitude)||!Number.isFinite(minBattery)||minBattery<0||minBattery>100)throw Error('Rapor eşikleri geçersiz.');
  const rows=frames(recording),alts=rows.flatMap(r=>r.relative_altitude_m===null?[]:[r.relative_altitude_m]),speeds=rows.flatMap(r=>r.ground_speed_ms===null?[]:[r.ground_speed_ms]),bats=rows.flatMap(r=>r.battery_pct===null?[]:[r.battery_pct]);
  const fresh=rows.filter(r=>r.position_fresh&&r.latitude!==null&&r.longitude!==null),points=recording.session.mission?.waypoints??[];
  const deviations=fresh.map(r=>deviation({latitude:r.latitude!,longitude:r.longitude!},points)).filter((v):v is number=>v!==null);
  let routeDistance=0;
  for(let i=1;i<fresh.length;i++)if(fresh[i].elapsed_s-fresh[i-1].elapsed_s<=3)routeDistance+=distance({latitude:fresh[i-1].latitude!,longitude:fresh[i-1].longitude!},{latitude:fresh[i].latitude!,longitude:fresh[i].longitude!});
  return {samples:rows.length,duration_s:rows.length?Math.max(0,rows.at(-1)!.elapsed_s-rows[0].elapsed_s):0,peak_relative_altitude_m:alts.length?alts.reduce((a,b)=>Math.max(a,b),-Infinity):null,peak_ground_speed_ms:speeds.length?speeds.reduce((a,b)=>Math.max(a,b),-Infinity):null,battery_used_percentage_points:bats.length?bats[0]-bats.at(-1)!:null,observed_ground_distance_m:routeDistance,max_route_deviation_m:deviations.length?deviations.reduce((a,b)=>Math.max(a,b),-Infinity):null,recording_gaps:rows.slice(1).filter((r,i)=>r.elapsed_s-rows[i].elapsed_s>3).length,altitude_alert_samples:alts.filter(v=>v>maxAltitude).length,battery_alert_samples:bats.filter(v=>v<minBattery).length};
}
export function toCSV(rows:Telemetry[]):string {
  const fields:(keyof Telemetry)[]=['received_utc','elapsed_s','vehicle_time_ms','latitude','longitude','relative_altitude_m','ground_speed_ms','battery_pct','battery_voltage_v','flight_mode','armed','mission_index','position_fresh','connection'];
  const cell=(v:unknown)=>v==null?'':'"'+String(v).replaceAll('"','""')+'"';
  return [fields.join(','),...rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\n');
}
export function download(name:string,data:string,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
