import { project } from '../planning';
import { HOME, type Coordinate, type Mission, type Waypoint } from '../types';
export function RouteOverlay({
  mission,
  a,
  b,
  traceA = [],
  traceB = [],
}: {
  mission: Mission;
  a?: Waypoint[];
  b?: Waypoint[];
  traceA?: Coordinate[][];
  traceB?: Coordinate[][];
}) {
  const all = [
    HOME,
    ...(mission.planning?.allowed_area ?? []),
    ...(a ?? []),
    ...(b ?? []),
    ...traceA.flat(),
    ...traceB.flat(),
  ].map(project);
  const minX = Math.min(...all.map((p) => p[0])),
    maxX = Math.max(...all.map((p) => p[0])),
    minY = Math.min(...all.map((p) => p[1])),
    maxY = Math.max(...all.map((p) => p[1]));
  const scale = Math.min(
    440 / Math.max(1, maxX - minX),
    260 / Math.max(1, maxY - minY),
  );
  const point = (p: { latitude: number; longitude: number }) => {
    const [x, y] = project(p);
    return `${30 + (x - minX) * scale},${290 - (y - minY) * scale}`;
  };
  return (
    <figure className="route-overlay">
      <svg
        viewBox="0 0 500 320"
        role="img"
        aria-label="A ve B rotaları ortak metre düzleminde; kuzey yukarı"
      >
        <polygon
          points={(mission.planning?.allowed_area ?? []).map(point).join(' ')}
          fill="#71dfbe0a"
          stroke="#7891aa"
          strokeDasharray="5 4"
        />
        {a && (
          <polyline
            points={[HOME, ...a].map(point).join(' ')}
            fill="none"
            stroke="#71dfbe"
            strokeWidth="2"
          />
        )}
        {b && (
          <polyline
            points={[HOME, ...b].map(point).join(' ')}
            fill="none"
            stroke="#76b6ff"
            strokeWidth="2"
            strokeDasharray="7 3"
          />
        )}
        {traceA.map((segment, i) => (
          <polyline
            key={'a' + i}
            points={segment.map(point).join(' ')}
            fill="none"
            stroke="#efc46d"
            strokeWidth="2"
          />
        ))}
        {traceB.map((segment, i) => (
          <polyline
            key={'b' + i}
            points={segment.map(point).join(' ')}
            fill="none"
            stroke="#eaa5d1"
            strokeWidth="2"
          />
        ))}
        <circle
          cx={point(HOME).split(',')[0]}
          cy={point(HOME).split(',')[1]}
          r="4"
          fill="#efc46d"
        />
        <text x="465" y="25" fill="#b8c8d9">
          N ↑
        </text>
      </svg>
      <figcaption>
        A planı: yeşil · B planı: mavi kesikli · H: sarı
        {traceA.length ? ' · A izi: altın · B izi: pembe' : ''} · ortak yerel
        metre düzlemi
      </figcaption>
    </figure>
  );
}
