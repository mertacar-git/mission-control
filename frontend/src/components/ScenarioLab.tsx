import { useEffect, useState } from "react";
import { api, request } from "../api";
import { download } from "../analysis";
import type { Recording, Telemetry } from "../types";
import { observationLabels, scenarioStatus as labels } from "../scenarioLabels";

export interface ScenarioRun {
  schema_version: 1;
  id: string;
  kind: string;
  status: string;
  started_utc: string;
  ended_utc: string | null;
  session_id: string | null;
  expected: string;
  error: string | null;
  firmware: string;
  revision: string;
  speedup: number;
  checks: {
    label: string;
    status: string;
    latency_s?: number;
    timeout_s?: number;
    snapshot?: Telemetry;
  }[];
  parameters: Record<string, number>;
}
const scenarios = [
  [
    "heartbeat_loss",
    "Telemetri kesilmesi",
    "Yerde süreç duraklatma; 3 s gecikme, 10 s kesinti, komut reddi ve veri dönüşü. Araç saati de durur; RF kaybını temsil etmez.",
  ],
  [
    "low_battery",
    "Düşük batarya",
    "10 m kalkış; 11,0 V enjeksiyonu. Yapılandırılmış 11,5 V / 2 s eşiği sonrası RTL ve iniş gözlenir.",
  ],
  [
    "gps_loss",
    "GPS kaybı",
    "10 m kalkış; simüle GPS kapatılır. 3D fix kaybı, yapılandırılmış EKF LAND ve disarm ayrı sınanır.",
  ],
] as const;

export function ScenarioLab({
  local,
  replaying,
  onReplay,
}: {
  local: boolean;
  replaying: boolean;
  onReplay: (recording: Recording) => void;
}) {
  const [runs, setRuns] = useState<ScenarioRun[]>([]),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const data = local
          ? await api.scenarios()
          : await fetch(
              import.meta.env.BASE_URL + "verification/scenario-runs.json",
            ).then((r) => {
              if (!r.ok) throw Error("Yayımlanmış deney kanıtı yüklenemedi.");
              return r.json() as Promise<ScenarioRun[]>;
            });
        if (!disposed) {
          const linked = local
            ? await request<{ scenario_id: string | null }[]>(
                "/experiment-runs",
              )
            : [];
          if (!disposed) {
            const ids = new Set(linked.map((r) => r.scenario_id));
            setRuns(data.filter((r) => !ids.has(r.id)));
            setError("");
          }
        }
      } catch (e) {
        if (!disposed) setError(String(e));
      }
    }
    void refresh();
    const timer = local ? setInterval(() => void refresh(), 1500) : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [local]);
  const running = runs.some((r) => r.status === "running");
  async function replay(run: ScenarioRun) {
    if (!run.session_id) return;
    try {
      const recording = local
        ? await api.recording(run.session_id)
        : await fetch(
            import.meta.env.BASE_URL + "verification/" + run.kind + ".json",
          ).then((r) => {
            if (!r.ok) throw Error("Deney kaydı yüklenemedi.");
            return r.json() as Promise<Recording>;
          });
      onReplay(recording);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <p className="muted">
        Önceki sürümlerin kabul kayıtları korunur. Yeni deneyler yukarıdaki
        sürümlü tanımlardan başlatılır.
      </p>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {runs.length === 0 && <p>Henüz deney sonucu yok.</p>}
      {local && running && (
        <button
          className="secondary"
          disabled={pending || replaying}
          onClick={() => {
            setPending(true);
            void api
              .cancelScenario()
              .then(() => api.scenarios())
              .then(setRuns)
              .catch((e) => setError(String(e)))
              .finally(() => setPending(false));
          }}
        >
          Deneyi durdur ve SITL oturumunu kapat
        </button>
      )}
      {runs.map((run) => (
        <section className="panel scenario-result" key={run.id}>
          <div className="panel-head">
            <h2>{scenarios.find((s) => s[0] === run.kind)?.[1] ?? run.kind}</h2>
            <strong className={"result-" + run.status}>
              {labels[run.status] ?? run.status}
            </strong>
          </div>
          <p className="muted">
            {new Date(run.started_utc).toLocaleString("tr-TR")} · {run.firmware}{" "}
            · {run.speedup}× · süreler gerçek duvar saatidir
          </p>
          <p>
            <b>Beklenen:</b>{" "}
            {scenarios.find((s) => s[0] === run.kind)?.[2] ?? run.expected}
          </p>
          {run.error && <p role="alert">{run.error}</p>}
          <div className="scenario-checks">
            {run.checks.map((check, i) => (
              <div key={i}>
                <div>
                  <strong>
                    {observationLabels[check.label] ?? check.label}
                  </strong>
                  {check.snapshot && (
                    <small className="observation-snapshot">
                      {check.snapshot.connection} ·{" "}
                      {check.snapshot.flight_mode ?? "mod bilinmiyor"} ·{" "}
                      {check.snapshot.armed === null
                        ? "arm bilinmiyor"
                        : check.snapshot.armed
                          ? "armed"
                          : "disarmed"}{" "}
                      · GPS {check.snapshot.gps_fix_type ?? "—"} ·{" "}
                      {check.snapshot.battery_voltage_v?.toFixed(2) ?? "—"} V
                    </small>
                  )}
                </div>
                <span>
                  {labels[check.status] ?? check.status}
                  {check.latency_s !== undefined
                    ? ` · ${check.latency_s.toFixed(2)} s gözlem bekleme`
                    : ""}
                  {check.timeout_s ? ` · ${check.timeout_s} s zaman aşımı` : ""}
                </span>
              </div>
            ))}
          </div>
          <details>
            <summary>Doğrulanan parametreler ve firmware</summary>
            <pre>
              {JSON.stringify(
                { parameters: run.parameters, revision: run.revision },
                null,
                2,
              )}
            </pre>
          </details>
          <div className="row-actions">
            <button
              className="secondary small"
              disabled={!run.session_id || run.status === "running"}
              onClick={() => void replay(run)}
            >
              Olayları incele
            </button>
            <button
              className="secondary small"
              onClick={() =>
                download(
                  "scenario-" + run.id + ".json",
                  JSON.stringify(run, null, 2),
                )
              }
            >
              Kabul raporu indir
            </button>
          </div>
        </section>
      ))}
    </>
  );
}
