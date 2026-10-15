import { useCallback, useReducer, type SetStateAction } from 'react';
import type { Mission } from './types';

export interface DraftHistory {
  past: Mission[];
  present: Mission;
  future: Mission[];
}
export type DraftAction =
  | { type: 'edit'; update: SetStateAction<Mission> }
  | { type: 'undo' | 'redo' };
export const HISTORY_LIMIT = 100;
export function createHistory(mission: Mission): DraftHistory {
  return { past: [], present: structuredClone(mission), future: [] };
}
export function draftReducer(
  state: DraftHistory,
  action: DraftAction,
): DraftHistory {
  if (action.type === 'undo') {
    if (!state.past.length) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past.at(-1)!,
      future: [state.present, ...state.future],
    };
  }
  if (action.type === 'redo') {
    if (!state.future.length) return state;
    return {
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  if (action.type !== 'edit') return state;
  const next =
    typeof action.update === 'function'
      ? action.update(structuredClone(state.present))
      : action.update;
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  return {
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: structuredClone(next),
    future: [],
  };
}
export function moveWaypoint(
  mission: Mission,
  from: number,
  to: number,
): Mission {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= mission.waypoints.length ||
    to >= mission.waypoints.length ||
    from === to
  )
    return mission;
  const points = [...mission.waypoints];
  const [point] = points.splice(from, 1);
  points.splice(to, 0, point);
  return { ...mission, waypoints: points };
}
export function validCoordinate(point: {
  latitude: number;
  longitude: number;
}): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}
export function useMissionDraft(initial: () => Mission) {
  const [state, dispatch] = useReducer(draftReducer, undefined, () =>
    createHistory(initial()),
  );
  const setMission = useCallback(
    (update: SetStateAction<Mission>) => dispatch({ type: 'edit', update }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []),
    redo = useCallback(() => dispatch({ type: 'redo' }), []);
  return {
    mission: state.present,
    setMission,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
