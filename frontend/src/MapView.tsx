import {useEffect,useState} from 'react';
import {MapContainer,TileLayer,Polyline,Marker,Popup,useMap,useMapEvents} from 'react-leaflet';
import L from 'leaflet';
import {HOME,type Mission,type Telemetry} from './types';
function Events({add,enabled}:{add:(latitude:number,longitude:number)=>void;enabled:boolean}){useMapEvents({click:event=>{if(enabled)add(event.latlng.lat,event.latlng.lng);}});return null;}
function Fit({mission}:{mission:Mission}){const map=useMap();useEffect(()=>{const points:[number,number][]=[[HOME.latitude,HOME.longitude],...mission.waypoints.map(w=>[w.latitude,w.longitude] as [number,number])];map.fitBounds(L.latLngBounds(points),{padding:[45,45],maxZoom:19});},[map,mission.waypoints]);return null;}
export function MapView({mission,telemetry,trace,editing,onAdd,onMove}:{mission:Mission;telemetry:Telemetry;trace:Telemetry[];editing:boolean;onAdd:(latitude:number,longitude:number)=>void;onMove:(index:number,latitude:number,longitude:number)=>void}){
  const [tiles,setTiles]=useState(true),[tileErrors,setTileErrors]=useState(0);
  const route=mission.waypoints.map(w=>[w.latitude,w.longitude] as [number,number]);
  // Null samples split observed traces; a lost connection is never bridged by a line.
  const segments:[number,number][][]=[];let current:[number,number][]=[];let previousTime:number|null=null;
  for(const row of trace){if(row.latitude===null||row.longitude===null||!row.position_fresh||(previousTime!==null&&row.elapsed_s-previousTime>3)){if(current.length)segments.push(current);current=[];}if(row.latitude!==null&&row.longitude!==null&&row.position_fresh)current.push([row.latitude,row.longitude]);previousTime=row.elapsed_s;}if(current.length)segments.push(current);
  return <section className="map-panel panel"><div className="panel-head"><div><span className="eyebrow">GÖREV ALANI</span><h2>Planlanan rota / gözlenen iz</h2></div><label className="switch"><input type="checkbox" checked={tiles&&tileErrors<6} onChange={e=>{setTiles(e.target.checked);setTileErrors(0);}}/>Harita döşemeleri</label></div>
    <MapContainer center={[HOME.latitude,HOME.longitude]} zoom={16} className="map" scrollWheelZoom={false}>
      {tiles&&tileErrors<6&&<TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" eventHandlers={{tileerror:()=>setTileErrors(v=>v+1)}}/>}
      <Fit mission={mission}/><Events add={onAdd} enabled={editing}/>
      <Marker position={[HOME.latitude,HOME.longitude]} icon={L.divIcon({className:'home-pin',html:'H',iconSize:[26,26],iconAnchor:[13,13]})}><Popup>Simülatör başlangıç noktası · eve göre irtifa referansı</Popup></Marker>
      <Polyline positions={[[HOME.latitude,HOME.longitude],...route]} pathOptions={{color:'#84a8cd',weight:2,dashArray:'6 7'}}/>
      {segments.map((segment,i)=><Polyline key={i} positions={segment} pathOptions={{color:'#71dfbe',weight:3}}/>)}
      {mission.waypoints.map((point,index)=><Marker key={index} position={[point.latitude,point.longitude]} draggable={editing} icon={L.divIcon({className:'waypoint-pin',html:String(index+1),iconSize:[28,28],iconAnchor:[14,14]})} eventHandlers={{dragend:event=>{const position=event.target.getLatLng();onMove(index,position.lat,position.lng);}}}><Popup>Nokta {index+1} · {point.altitude_m} m (eve göre)</Popup></Marker>)}
      {telemetry.position_fresh&&telemetry.latitude!==null&&telemetry.longitude!==null&&<Marker position={[telemetry.latitude,telemetry.longitude]} icon={L.divIcon({className:'vehicle-pin',html:'▲',iconSize:[32,32],iconAnchor:[16,16]})}><Popup>{telemetry.source==='demo'?'Demo aracı':'SITL aracı'} · {telemetry.relative_altitude_m?.toFixed(1)} m</Popup></Marker>}
    </MapContainer><div className="map-caption"><span><i className="legend planned"/>Planlanan rota</span><span><i className="legend observed"/>Gözlenen iz</span><span>{editing?'Yeni nokta için haritaya tıklayın.':'Görev düzenleme kilitli.'}</span></div>
    {tileErrors>=6&&<p className="inline-note">Döşemeler yüklenemedi; koordinat düzenleyicisi ve vektör rota görünümü çalışmaya devam ediyor.</p>}
  </section>;
}
