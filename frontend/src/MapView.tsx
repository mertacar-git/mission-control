import { validCoordinate } from './missionDraft';
import { validatePlanning } from './planning';
import { useEffect, useState, useRef } from 'react';
import {
  MapContainer,
  TileLayer,
  Polyline,
  Polygon,
  Marker,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import { Crosshair } from 'lucide-react';
import {
  HOME,
  type Mission,
  type Telemetry,
  type EditLayer,
  type Coordinate,
  type Waypoint,
} from './types';
function Events({
  add,
  enabled,
}: {
  add: (latitude: number, longitude: number) => void;
  enabled: boolean;
}) {
  useMapEvents({
    click: (event) => {
      if (enabled) add(event.latlng.lat, event.latlng.lng);
    },
  });
  return null;
}
function Fit({ mission }: { mission: Mission }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = [
      [HOME.latitude, HOME.longitude],
      ...mission.waypoints
        .filter(validCoordinate)
        .map((w) => [w.latitude, w.longitude] as [number, number]),
      ...[
        ...(mission.planning?.allowed_area ?? []),
        ...(mission.planning?.survey_area ?? []),
      ]
        .filter(validCoordinate)
        .map((p) => [p.latitude, p.longitude] as [number, number]),
    ];
    map.fitBounds(L.latLngBounds(points), {
      padding: [45, 45],
      maxZoom: 20,
      animate: false,
    });
  }, [
    map,
    mission.waypoints,
    mission.planning?.allowed_area,
    mission.planning?.survey_area,
  ]);
  return null;
}
function MapTools({ mission }: { mission: Mission }) {
  const map = useMap();
  const tools = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tools.current) L.DomEvent.disableClickPropagation(tools.current);
  }, []);
  useEffect(() => {
    const scale = L.control
      .scale({ imperial: false, position: 'bottomleft', maxWidth: 120 })
      .addTo(map);
    return () => {
      scale.remove();
    };
  }, [map]);
  return (
    <div className="map-tools" ref={tools}>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          map.fitBounds(
            L.latLngBounds([
              [HOME.latitude, HOME.longitude],
              ...mission.waypoints
                .filter(validCoordinate)
                .map(
                  (point) =>
                    [point.latitude, point.longitude] as [number, number],
                ),
              ...[
                ...(mission.planning?.allowed_area ?? []),
                ...(mission.planning?.survey_area ?? []),
              ]
                .filter(validCoordinate)
                .map((p) => [p.latitude, p.longitude] as [number, number]),
            ]),
            { padding: [45, 45], maxZoom: 20, animate: false },
          );
        }}
      >
        <Crosshair size={15} />
        Rotaya odaklan
      </button>
    </div>
  );
}
function SelectedFocus({
  point,
}: {
  point: { latitude: number; longitude: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (point && validCoordinate(point))
      map.setView(
        [point.latitude, point.longitude],
        Math.max(18, map.getZoom()),
        { animate: false },
      );
  }, [map, point]);
  return null;
}
export function MapView({
  layer = 'waypoints',
  onAreaMove,
  previewRoute,
  onLayerChange,
  selectedIndex,
  focusPoint,
  onSelect,
  mission,
  telemetry,
  trace,
  editing,
  onAdd,
  onMove,
}: {
  layer?: EditLayer;
  onAreaMove?: (
    area: 'allowed_area' | 'survey_area',
    index: number,
    point: Coordinate,
  ) => void;
  previewRoute?: Waypoint[] | null;
  onLayerChange?: (layer: EditLayer) => void;
  selectedIndex: number | null;
  focusPoint: { latitude: number; longitude: number } | null;
  onSelect: (index: number) => void;
  mission: Mission;
  telemetry: Telemetry;
  trace: Telemetry[];
  editing: boolean;
  onAdd: (latitude: number, longitude: number) => void;
  onMove: (index: number, latitude: number, longitude: number) => void;
}) {
  const [tiles, setTiles] = useState(true),
    [tileErrors, setTileErrors] = useState(0);
  const validPoints = mission.waypoints.flatMap((point, index) =>
    validCoordinate(point) ? [{ point, index }] : [],
  );
  const route = mission.waypoints
    .filter(validCoordinate)
    .map((w) => [w.latitude, w.longitude] as [number, number]);
  const validation = validatePlanning(mission);
  // Null samples split observed traces; a lost connection is never bridged by a line.
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  let previousTime: number | null = null;
  for (const row of trace) {
    if (
      row.latitude === null ||
      row.longitude === null ||
      !row.position_fresh ||
      (previousTime !== null && row.elapsed_s - previousTime > 3)
    ) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (row.latitude !== null && row.longitude !== null && row.position_fresh)
      current.push([row.latitude, row.longitude]);
    previousTime = row.elapsed_s;
  }
  if (current.length) segments.push(current);
  return (
    <section className="map-panel panel">
      <div className="panel-head">
        <div>
          <span className="eyebrow">GÖREV ALANI</span>
          <h2>Planlanan rota / gözlenen iz</h2>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={tiles && tileErrors < 6}
            onChange={(e) => {
              setTiles(e.target.checked);
              setTileErrors(0);
            }}
          />
          Harita döşemeleri
        </label>
      </div>
      {editing && onLayerChange && (
        <div className="map-layer-bar" role="group" aria-label="Harita katmanı">
          {(['waypoints', 'allowed_area', 'survey_area'] as EditLayer[]).map(
            (key) => (
              <button
                className={key === layer ? 'primary small' : 'secondary small'}
                aria-pressed={key === layer}
                key={key}
                onClick={() => onLayerChange(key)}
              >
                {
                  {
                    waypoints: 'Rota noktaları',
                    allowed_area: 'İzin verilen alan',
                    survey_area: 'Tarama alanı',
                  }[key]
                }
              </button>
            ),
          )}
          <span>A: izin verilen sınır · S: tarama alanı</span>
        </div>
      )}
      <MapContainer
        zoomAnimation={false}
        markerZoomAnimation={false}
        fadeAnimation={false}
        center={[HOME.latitude, HOME.longitude]}
        zoom={16}
        className="map"
        scrollWheelZoom={false}
        maxZoom={21}
      >
        {tiles && tileErrors < 6 && (
          <TileLayer
            maxNativeZoom={19}
            maxZoom={21}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{ tileerror: () => setTileErrors((v) => v + 1) }}
          />
        )}
        <Fit mission={mission} />
        <SelectedFocus point={focusPoint} />
        <MapTools mission={mission} />
        <Events add={onAdd} enabled={editing} />
        {mission.planning &&
          (['allowed_area', 'survey_area'] as const).map((area) => {
            const ps = mission.planning![area].filter(validCoordinate),
              color = area === 'allowed_area' ? '#71dfbe' : '#e8bf70';
            const positions = ps.map(
              (p) => [p.latitude, p.longitude] as [number, number],
            );
            return (
              <div key={area}>
                {ps.length >= 3 ? (
                  <Polygon
                    positions={positions}
                    interactive={false}
                    pathOptions={{
                      color,
                      weight: 2,
                      fillOpacity: 0.08,
                      dashArray: area === 'survey_area' ? '5 5' : undefined,
                    }}
                  />
                ) : (
                  <Polyline
                    positions={positions}
                    interactive={false}
                    pathOptions={{ color, weight: 2 }}
                  />
                )}
                {editing &&
                  layer === area &&
                  mission.planning![area].flatMap((point, index) =>
                    validCoordinate(point)
                      ? [
                          <Marker
                            key={index}
                            position={[point.latitude, point.longitude]}
                            draggable
                            bubblingMouseEvents={false}
                            icon={L.divIcon({
                              className: 'area-pin ' + area,
                              html:
                                (area === 'allowed_area' ? 'A' : 'S') +
                                (index + 1),
                              iconSize: [28, 28],
                              iconAnchor: [14, 14],
                            })}
                            eventHandlers={{
                              dragend: (event) => {
                                const pos = event.target.getLatLng();
                                onAreaMove?.(area, index, {
                                  latitude: pos.lat,
                                  longitude: pos.lng,
                                });
                              },
                            }}
                          >
                            <Popup>
                              {area === 'allowed_area'
                                ? 'İzin verilen alan'
                                : 'Tarama alanı'}{' '}
                              · köşe {index + 1}
                            </Popup>
                          </Marker>,
                        ]
                      : [],
                  )}
              </div>
            );
          })}
        <Marker
          position={[HOME.latitude, HOME.longitude]}
          icon={L.divIcon({
            className: 'home-pin',
            html: 'H',
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          })}
        >
          <Popup>Simülatör başlangıç noktası · eve göre irtifa referansı</Popup>
        </Marker>
        {validPoints.length === mission.waypoints.length && (
          <Polyline
            positions={[[HOME.latitude, HOME.longitude], ...route]}
            pathOptions={{ color: '#3f6fd3', weight: 3, dashArray: '6 7' }}
          />
        )}
        {validation.issues
          .filter((i) => i.segment_index !== undefined)
          .map((issue) => {
            const i = issue.segment_index!,
              points = [HOME, ...mission.waypoints];
            return points[i] &&
              points[i + 1] &&
              validCoordinate(points[i]) &&
              validCoordinate(points[i + 1]) ? (
              <Polyline
                key={i}
                positions={[points[i], points[i + 1]].map(
                  (p) => [p.latitude, p.longitude] as [number, number],
                )}
                pathOptions={{ color: '#f17c7c', weight: 5 }}
              />
            ) : null;
          })}
        {previewRoute && (
          <Polyline
            positions={[HOME, ...previewRoute].map(
              (p) => [p.latitude, p.longitude] as [number, number],
            )}
            interactive={false}
            pathOptions={{ color: '#f0c56b', weight: 4, dashArray: '3 7' }}
          />
        )}
        {segments.map((segment, i) => (
          <Polyline
            key={i}
            positions={segment}
            pathOptions={{ color: '#71dfbe', weight: 3 }}
          />
        ))}
        {validPoints.map(({ point, index }) => (
          <Marker
            key={index}
            position={[point.latitude, point.longitude]}
            draggable={editing && layer === 'waypoints'}
            bubblingMouseEvents={false}
            icon={L.divIcon({
              className:
                'waypoint-pin' + (selectedIndex === index ? ' selected' : ''),
              html: String(index + 1),
              iconSize: [28, 28],
              iconAnchor: [14, 14],
            })}
            eventHandlers={{
              click: () => {
                if (editing && layer === 'waypoints') onSelect(index);
              },
              dragend: (event) => {
                const position = event.target.getLatLng();
                onMove(index, position.lat, position.lng);
              },
            }}
          >
            <Popup>
              Nokta {index + 1} · {point.altitude_m} m (eve göre)
            </Popup>
          </Marker>
        ))}
        {telemetry.position_fresh &&
          telemetry.latitude !== null &&
          telemetry.longitude !== null && (
            <Marker
              position={[telemetry.latitude, telemetry.longitude]}
              icon={L.divIcon({
                className: 'vehicle-pin',
                html: '▲',
                iconSize: [32, 32],
                iconAnchor: [16, 16],
              })}
            >
              <Popup>
                {telemetry.source === 'demo' ? 'Demo aracı' : 'SITL aracı'} ·{' '}
                {telemetry.relative_altitude_m?.toFixed(1)} m
              </Popup>
            </Marker>
          )}
      </MapContainer>
      <div className="map-caption">
        <span>
          <i className="legend planned" />
          Planlanan rota
        </span>
        <span>
          <i className="legend observed" />
          Gözlenen iz
        </span>
        {mission.planning && (
          <>
            <span>
              <i className="legend allowed" />
              İzin verilen alan
            </span>
            <span>
              <i className="legend survey" />
              Tarama alanı
            </span>
          </>
        )}
        <span>
          {editing
            ? layer === 'waypoints'
              ? 'Yeni rota noktası için tıklayın.'
              : `${layer === 'allowed_area' ? 'İzin verilen alan' : 'Tarama alanı'} köşesi için tıklayın.`
            : 'Görev düzenleme kilitli.'}
        </span>
      </div>
      {validPoints.length !== mission.waypoints.length && (
        <p className="inline-note" role="status">
          Geçersiz koordinatlar haritada gösterilmez; yüklemeden önce editörde
          düzeltin.
        </p>
      )}
      {tileErrors >= 6 && (
        <p className="inline-note">
          Döşemeler yüklenemedi; koordinat düzenleyicisi ve vektör rota görünümü
          çalışmaya devam ediyor.
        </p>
      )}
    </section>
  );
}
