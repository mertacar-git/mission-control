import { describe, it, expect } from 'vitest';
import fixtures from '../../tests/fixtures/planning.json';
import actualSurvey from '../../docs/verification/survey-session.json';
import actualNarrow from '../../docs/verification/narrow-boundary-session.json';
import narrowReport from '../../docs/verification/narrow-boundary-report.json';
import { parseRecording } from './recording';
import { analyze } from './analysis';
import {
  newMission,
  validateMission,
  emptyTelemetry,
  missionFingerprint,
  type Mission,
} from './types';
import {
  generateSurvey,
  defaultPlanning,
  unproject,
  project,
  validatePlanning,
  segmentInside,
  polygonError,
  fenceState,
  fenceMetrics,
} from './planning';
import { examplePlanning } from './planning';
import { draftReducer, createHistory } from './missionDraft';
const coordinates = (ps: number[][]) =>
  ps.map((p) => unproject(p as [number, number]));
describe('shared mission geometry contract', () => {
  for (const f of fixtures)
    it(f.name, () => {
      const m: Mission = {
        ...newMission(),
        planning: {
          ...defaultPlanning(),
          allowed_area: coordinates(f.allowed),
          survey_area: coordinates(f.survey),
          max_distance_m: f.max_distance_m ?? 2000,
          max_altitude_m: f.max_altitude_m ?? 80,
        },
        waypoints: coordinates(f.route).map((p) => ({ ...p, altitude_m: 20 })),
      };
      const result = validatePlanning(m);
      expect(result.valid).toBe(f.valid);
      if (f.code) expect(result.issues.map((i) => i.code)).toContain(f.code);
    });
});
describe('concave survey routing', () => {
  for (const heading of [0, 30, 90, 135])
    it(`keeps all L-shape segments inside at ${heading} degrees`, () => {
      const m = {
        ...newMission(),
        planning: { ...examplePlanning(), heading_deg: heading },
      };
      const a = generateSurvey(m),
        b = generateSurvey(m);
      expect(a).toEqual(b);
      expect(a.waypoints.length).toBeLessThanOrEqual(50);
      expect(a.area_m2).toBeCloseTo(1275, 3);
      const ps = [unproject([0, 0]), ...a.waypoints];
      ps.slice(1).forEach((v, i) =>
        expect(
          segmentInside(
            project(ps[i]),
            project(v),
            (i ? m.planning.survey_area : m.planning.allowed_area).map(project),
          ),
        ).toBe(true),
      );
      expect(
        validatePlanning({
          ...m,
          takeoff_altitude_m: 20,
          waypoints: a.waypoints,
        }).valid,
      ).toBe(true);
    });
  it('handles multiple disjoint scanline intervals in a U shape', () => {
    const p = examplePlanning();
    p.survey_area = coordinates([
      [5, 5],
      [60, 5],
      [60, 60],
      [45, 60],
      [45, 20],
      [20, 20],
      [20, 60],
      [5, 60],
    ]);
    p.heading_deg = 90;
    p.spacing_m = 15;
    const result = generateSurvey({ ...newMission(), planning: p });
    expect(result.segment_count).toBeGreaterThan(result.line_count);
    const ps = result.waypoints.map(project);
    ps.slice(1).forEach((v, i) =>
      expect(segmentInside(ps[i], v, p.survey_area.map(project))).toBe(true),
    );
  });
  it('handles a narrow rotated area without losing all scanlines', () => {
    const p = examplePlanning();
    p.survey_area = coordinates([
      [5, 5],
      [7, 5],
      [7, 50],
      [5, 50],
    ]);
    const result = generateSurvey({ ...newMission(), planning: p });
    expect(result.line_count).toBe(1);
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
  });
  it('rejects more than 50 points without truncating', () => {
    const p = examplePlanning();
    p.allowed_area = coordinates([
      [-20, -20],
      [400, -20],
      [400, 400],
      [-20, 400],
    ]);
    p.survey_area = coordinates([
      [5, 5],
      [350, 5],
      [350, 350],
      [5, 350],
    ]);
    p.spacing_m = 5;
    expect(() => generateSurvey({ ...newMission(), planning: p })).toThrow(
      /50/,
    );
  });
  it('rejects invalid areas and settings before generating', () => {
    const m = { ...newMission(), planning: examplePlanning() };
    m.planning.survey_area[1] = m.planning.survey_area[0];
    expect(() => generateSurvey(m)).toThrow();
    expect(
      polygonError([
        [0, 0],
        [1, 0],
        [0, 0],
      ]),
    ).not.toBeNull();
  });
});
describe('planning compatibility and observed fence state', () => {
  it('imports actual schema 2 SITL recordings and reproduces backend boundary metrics', () => {
    for (const input of [actualSurvey, actualNarrow]) {
      const recording = parseRecording(input);
      expect(recording.session.mission?.schema_version).toBe(2);
      expect(recording.events.some((e) => e.type === 'fence')).toBe(true);
    }
    const report = analyze(parseRecording(actualNarrow));
    expect(report.fence_violation_count).toBe(
      narrowReport.fence_violation_count,
    );
    expect(report.fence_observed_violation_s).toBeCloseTo(
      narrowReport.fence_observed_violation_s,
      6,
    );
  });
  it('compares backend-shaped missions independently of object property order', () => {
    const draft = { ...newMission(), planning: examplePlanning() };
    const backend = {
      planning: {
        max_altitude_m: 80,
        max_distance_m: 2000,
        altitude_m: 20,
        heading_deg: 0,
        spacing_m: 20,
        survey_area: draft.planning.survey_area,
        allowed_area: draft.planning.allowed_area,
      },
      waypoints: draft.waypoints,
      name: draft.name,
      id: draft.id,
      takeoff_altitude_m: draft.takeoff_altitude_m,
      schema_version: 2 as const,
    };
    expect(missionFingerprint(draft)).toBe(missionFingerprint(backend));
    expect(
      missionFingerprint({
        ...backend,
        planning: { ...backend.planning, max_distance_m: 1000 },
      }),
    ).not.toBe(missionFingerprint(draft));
  });
  it('normalizes version 1 without adding mission limits', () => {
    const old = { ...newMission(), schema_version: 1, planning: undefined };
    const m = validateMission(old);
    expect(m.schema_version).toBe(2);
    expect(m.planning).toBeNull();
    expect(validatePlanning(m).valid).toBe(true);
    expect(() =>
      validateMission({ ...old, planning: examplePlanning() }),
    ).toThrow();
  });
  it('retains planning and generated-route edits as isolated undo snapshots', () => {
    const original = newMission();
    let h = createHistory(original);
    const m = { ...original, planning: examplePlanning() };
    h = draftReducer(h, { type: 'edit', update: m });
    const preview = generateSurvey(m);
    h = draftReducer(h, {
      type: 'edit',
      update: (x) => ({ ...x, waypoints: preview.waypoints }),
    });
    h = draftReducer(h, { type: 'undo' });
    expect(h.present.waypoints).toEqual(original.waypoints);
    expect(h.present.planning).toEqual(m.planning);
    h = draftReducer(h, { type: 'undo' });
    expect(h.present).toEqual(original);
  });
  it('never treats lost measurements as inside and does not bridge unknown intervals', () => {
    const m = { ...newMission(), planning: examplePlanning() };
    const fresh = {
      ...emptyTelemetry(),
      connection: 'connected' as const,
      position_fresh: true,
      ...unproject([100, 100]),
      relative_altitude_m: 20,
    };
    expect(fenceState(m, fresh)).toBe('outside');
    expect(fenceState(m, { ...fresh, relative_altitude_m: null })).toBe(
      'unknown',
    );
    expect(fenceState(m, { ...fresh, ...unproject([10, 10]) })).toBe('inside');
    const rows = [
      { ...fresh, elapsed_s: 0 },
      { ...fresh, elapsed_s: 1 },
      { ...fresh, elapsed_s: 2, position_fresh: false },
      { ...fresh, elapsed_s: 20 },
      { ...fresh, elapsed_s: 21 },
    ];
    expect(fenceMetrics(m, rows)).toEqual({
      fence_violation_count: 2,
      fence_observed_violation_s: 2,
    });
  });
});
