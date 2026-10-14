export type ConnectionState='closed'|'connecting'|'connected'|'stale'|'disconnected';
export type Action='arm'|'start'|'hold'|'resume'|'return'|'land';
export interface Waypoint {latitude:number;longitude:number;altitude_m:number}
export interface Mission {schema_version:1;id:string;name:string;takeoff_altitude_m:number;waypoints:Waypoint[]}
export interface Telemetry {
  source:'demo'|'sitl';received_utc:string;elapsed_s:number;vehicle_time_ms:number|null;
  latitude:number|null;longitude:number|null;relative_altitude_m:number|null;ground_speed_ms:number|null;
  battery_pct:number|null;battery_voltage_v:number|null;flight_mode:string|null;armed:boolean|null;
  mission_index:number|null;position_fresh:boolean;navigation_ready?:boolean;heartbeat_age_s:number|null;connection:ConnectionState;
}
export interface FlightEvent {type:string;received_utc:string;payload:Record<string,unknown>;sequence?:number}
export interface SessionInfo {id:string;name:string;started_utc:string;ended_utc:string|null;source:'demo'|'sitl';mission?:Mission|null}
export interface Recording {schema_version:1;session:SessionInfo;events:FlightEvent[]}
export interface Status {state:ConnectionState;telemetry:Telemetry;recording_id:string|null;mission:Mission|null;upload_verified:boolean;events:FlightEvent[];event_sequence:number;simulator_owned:boolean;simulator_revision:string}
export interface Report {
  samples:number;duration_s:number;peak_relative_altitude_m:number|null;peak_ground_speed_ms:number|null;
  battery_used_percentage_points:number|null;observed_ground_distance_m:number;max_route_deviation_m:number|null;
  recording_gaps:number;altitude_alert_samples:number;battery_alert_samples:number;
}
export const HOME={latitude:41.0082,longitude:28.9784};
export function newMission():Mission{return {schema_version:1,id:crypto.randomUUID(),name:'İstanbul · örnek görev',takeoff_altitude_m:20,waypoints:[{latitude:41.0085,longitude:28.9784,altitude_m:20},{latitude:41.0085,longitude:28.9788,altitude_m:20},{latitude:41.0082,longitude:28.9788,altitude_m:20}]};}
export function emptyTelemetry(source:'demo'|'sitl'='demo'):Telemetry{return {source,received_utc:new Date().toISOString(),elapsed_s:0,vehicle_time_ms:null,latitude:null,longitude:null,relative_altitude_m:null,ground_speed_ms:null,battery_pct:null,battery_voltage_v:null,flight_mode:null,armed:null,mission_index:null,position_fresh:false,heartbeat_age_s:null,connection:'closed'};}
export function validateMission(input:unknown):Mission {
  if(typeof input!=='object'||!input)throw Error('Görev JSON nesnesi olmalıdır.');
  const m=input as Mission;
  if(m.schema_version!==1||typeof m.id!=='string'||!m.id.length||m.id.length>80||typeof m.name!=='string'||!m.name.trim()||m.name.length>100)throw Error('Görev kimliği, adı veya sürümü geçersiz.');
  if(!Number.isFinite(m.takeoff_altitude_m)||m.takeoff_altitude_m<5||m.takeoff_altitude_m>120)throw Error('Kalkış irtifası 5–120 m olmalıdır.');
  if(!Array.isArray(m.waypoints)||m.waypoints.length<1||m.waypoints.length>50)throw Error('Görev 1–50 rota noktası içermelidir.');
  for(const w of m.waypoints)if(!w||![w.latitude,w.longitude,w.altitude_m].every(Number.isFinite)||Math.abs(w.latitude)>90||Math.abs(w.longitude)>180||w.altitude_m<5||w.altitude_m>120)throw Error('Koordinatlar veya nokta irtifası geçersiz.');
  return structuredClone(m);
}
