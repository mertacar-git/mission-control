import { useEffect, useRef, useState } from "react";
import { api, request } from "../api";
import { download } from "../analysis";
import type { Mission, Recording } from "../types";

interface Definition {
  schema_version: 1;
  id: string;
  parent_id: string | null;
  version: number;
  name: string;
  source: "sitl";
  kind: string;
  mission: Mission;
  mission_fingerprint: string;
  speedup: number;
  seed: null;
  timeout_s: number;
  expected: string;
  created_utc: string;
}
interface Run {
  id: string;
  definition: Definition;
  status: string;
  created_utc: string;
  started_utc: string | null;
  ended_utc: string | null;
  recording_ids: string[];
  checks: { label: string; status: string }[];
  error: string | null;
  software_revision: string | null;
  firmware_revision: string;
}
const labels: Record<string, string> = {
  queued: "Sırada",
  running: "Çalışıyor",
  passed: "Geçti",
  failed: "Kaldı",
  cancelled: "İptal edildi",
  interrupted: "Kesintiye uğradı",
};
const kinds = [
  ["normal", "Normal görev"],
  ["heartbeat_loss", "Telemetri kesintisi"],
  ["low_battery", "Düşük batarya"],
  ["gps_loss", "GPS kaybı"],
];

export function ExperimentLab({
  local,
  replaying,
  mission,
  transportBusy = false,
  onReplay,
}: {
  local: boolean;
  replaying: boolean;
  mission: Mission;
  transportBusy?: boolean;
  onReplay: (recording: Recording) => void;
}) {
  const [definitions, setDefinitions] = useState<Definition[]>([]),
    [runs, setRuns] = useState<Run[]>([]);
  const [name, setName] = useState("Görev deneyi"),
    [kind, setKind] = useState("normal"),
    [speed, setSpeed] = useState(4),
    [timeout, setTimeoutValue] = useState(300);
  const [parent, setParent] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    setLoading(true);
    setAvailable(false);
    setDefinitions([]);
    setRuns([]);
    setSelected([]);
    setError("");
    if (!local) {
      setDefinitions([]);
      setRuns([]);
      let disposed = false;
      void fetch(
        import.meta.env.BASE_URL +
          "verification/experiments/experiment-runs.json",
        { cache: "no-store" },
      )
        .then((r) => {
          if (!r.ok) throw Error("Deney kanıtları yüklenemedi.");
          return r.json() as Promise<Run[]>;
        })
        .then((r) => {
          if (!disposed) {
            setRuns(r);
            setLoading(false);
          }
        })
        .catch((e) => {
          if (!disposed) {
            setError(String(e));
            setLoading(false);
          }
        });
      return () => {
        disposed = true;
      };
    }
    let disposed = false;
    async function refresh() {
      try {
        const [d, r] = await Promise.all([
          request<Definition[]>("/experiments"),
          request<Run[]>("/experiment-runs"),
        ]);
        if (!disposed) {
          setAvailable(true);
          setError("");
          setDefinitions(d);
          setRuns(r);
          setLoading(false);
        }
      } catch (e) {
        if (!disposed) {
          setAvailable(false);
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [local, retry]);
  async function perform(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      setDefinitions(await request("/experiments"));
      setRuns(await request("/experiment-runs"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const active = runs.some(
    (r) => r.status === "running" || r.status === "queued",
  );
  const compare = runs.filter((r) => selected.includes(r.id));
  return (
    <section className="panel experiment-lab">
      <span className="eyebrow">SÜRÜMLÜ DENEYLER · GERÇEK SITL</span>
      <h2>Tanımı sabitle, koşuları karşılaştır</h2>
      <p>
        Her koşu yeni kayıt ve kimlik üretir. Görev, hız ve beklenti tanımda
        sabitlenir. SITL rastgelelik tohumu doğrulanmadığı için bilinmiyor
        olarak saklanır.
      </p>
      {!local ? (
        <>
          {loading && <p role="status">Yayımlanmış deneyler yükleniyor…</p>}
          <p className="notice">
            Yeni deneyler yerel SITL modunda çalışır. Yayımlanmış önceki senaryo
            kanıtları aşağıdadır.
          </p>
          {error && <p role="alert">{error}</p>}
          {runs.map((r) => (
            <div className="scenario-result" key={r.id}>
              <h3>
                {kinds.find((k) => k[0] === r.definition.kind)?.[1]} ·{" "}
                {labels[r.status]}
              </h3>
              <p>
                {new Date(r.created_utc).toLocaleString("tr-TR")} ·{" "}
                {r.definition.speedup}× ·{" "}
                {r.checks.filter((c) => c.status === "passed").length}/
                {r.checks.length} gözlem · koşu {r.id.slice(0, 8)}
              </p>
              <div className="row-actions">
                {r.recording_ids.map((id) => (
                  <button
                    key={id}
                    className="secondary small"
                    onClick={() =>
                      void fetch(
                        import.meta.env.BASE_URL +
                          "verification/experiments/" +
                          id +
                          ".json",
                      )
                        .then((x) => {
                          if (!x.ok) throw Error("Kayıt yüklenemedi.");
                          return x.json() as Promise<Recording>;
                        })
                        .then(onReplay)
                        .catch((e) => setError(String(e)))
                    }
                  >
                    Yayımlanmış koşu kaydını aç
                  </button>
                ))}
                <button
                  className="secondary small"
                  onClick={() =>
                    download(
                      "experiment-" + r.id + ".json",
                      JSON.stringify(r, null, 2),
                    )
                  }
                >
                  Koşu JSON
                </button>
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          {loading && <p role="status">Backend bağlantısı doğrulanıyor…</p>}
          {!loading && !available && (
            <p className="notice">
              Backend'e ulaşılamıyor. Gösterilen sonuçlar son alınan görüntüdür;
              yeni işlem gönderilemez.
            </p>
          )}
          {!loading && !available && (
            <button
              className="secondary small"
              onClick={() => setRetry((n) => n + 1)}
            >
              Bağlantıyı yeniden dene
            </button>
          )}
          {transportBusy && (
            <p className="notice">
              Yeni koşu için mevcut SITL bağlantısını ve uçuş kaydını kapatın.
              Devam eden deneyin bitmesini bekleyin.
            </p>
          )}
          {(!Number.isInteger(timeout) || timeout < 90 || timeout > 600) && (
            <p role="alert">
              Zaman aşımı 90–600 saniye arasında bir tam sayı olmalı.
            </p>
          )}
          <div className="thresholds">
            <label>
              Deney adı
              <input
                value={name}
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Senaryo
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Simülasyon hızı
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                <option value={1}>1×</option>
                <option value={4}>4×</option>
              </select>
            </label>
            <label>
              Zaman aşımı (s)
              <input
                type="number"
                min={90}
                max={600}
                value={timeout}
                onChange={(e) => setTimeoutValue(Number(e.target.value))}
              />
            </label>
            <label>
              Önceki tanım
              <select
                value={parent}
                onChange={(e) => setParent(e.target.value)}
              >
                <option value="">Bağımsız tanım</option>
                {definitions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} · v{d.version}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">
            {kind === "normal"
              ? "Mevcut taslağın tam görüntüsü saklanacak; sonraki taslak değişiklikleri deneyi değiştirmez."
              : "Hata deneyleri sabit 10 m / 555 m görev görüntüsü kullanır; taslağı değiştirmez."}
          </p>
          <button
            className="primary small"
            disabled={
              busy ||
              !available ||
              replaying ||
              !name.trim() ||
              !Number.isInteger(timeout) ||
              timeout < 90 ||
              timeout > 600
            }
            onClick={() =>
              void perform(() =>
                request("/experiments", "POST", {
                  name,
                  kind,
                  speedup: speed,
                  timeout_s: timeout,
                  parent_id: parent || null,
                  mission: kind === "normal" ? mission : null,
                }),
              )
            }
          >
            Değişmez tanım oluştur
          </button>
          {error && (
            <p role="alert" className="notice">
              {error}
            </p>
          )}
          {definitions.map((d) => (
            <details key={d.id} className="scenario-result">
              <summary>
                {d.name} · v{d.version} ·{" "}
                {kinds.find((k) => k[0] === d.kind)?.[1]} · {d.speedup}×
              </summary>
              <p>
                {d.mission.waypoints.length} nokta · {d.timeout_s} s · parmak
                izi {d.mission_fingerprint.slice(0, 22)}…
              </p>
              <p>{d.expected}</p>
              <pre>{JSON.stringify(d.mission, null, 2)}</pre>
              <button
                className="secondary small"
                disabled={
                  busy || !available || transportBusy || active || replaying
                }
                onClick={() =>
                  void perform(() =>
                    request("/experiment-runs", "POST", {
                      definition_id: d.id,
                    }),
                  )
                }
              >
                Yeni koşu başlat
              </button>
            </details>
          ))}
          <h3>Koşu arşivi</h3>
          {loading && <p role="status">Deney arşivi yükleniyor…</p>}
          {!loading && !runs.length && (
            <p>Henüz koşu yok. Tanımı oluşturup yeni koşu başlatın.</p>
          )}
          {runs.map((run) => (
            <div className="scenario-result" key={run.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(run.id)}
                  disabled={!selected.includes(run.id) && selected.length >= 5}
                  onChange={() =>
                    setSelected((old) =>
                      old.includes(run.id)
                        ? old.filter((x) => x !== run.id)
                        : [...old, run.id],
                    )
                  }
                />{" "}
                Karşılaştırmaya ekle
              </label>
              <h3>
                {run.definition.name} · {labels[run.status] ?? run.status}
              </h3>
              <p className="muted">
                {new Date(run.created_utc).toLocaleString("tr-TR")} · {run.id} ·{" "}
                {run.checks.filter((c) => c.status === "passed").length}/
                {run.checks.length} gözlem
              </p>
              {run.error && <p role="alert">{run.error}</p>}
              <div className="row-actions">
                {["queued", "running"].includes(run.status) && (
                  <button
                    className="secondary small"
                    disabled={busy || !available}
                    onClick={() =>
                      void perform(() =>
                        request(`/experiment-runs/${run.id}/cancel`, "POST"),
                      )
                    }
                  >
                    Bu koşuyu iptal et
                  </button>
                )}
                {run.recording_ids.map((id) => (
                  <button
                    key={id}
                    className="secondary small"
                    disabled={
                      busy || !available || active || replaying || transportBusy
                    }
                    onClick={() =>
                      void perform(async () =>
                        onReplay(await api.recording(id)),
                      )
                    }
                  >
                    Uçuş kaydını incele
                  </button>
                ))}
                <button
                  className="secondary small"
                  onClick={() =>
                    download(
                      `experiment-${run.id}.json`,
                      JSON.stringify(run, null, 2),
                    )
                  }
                >
                  Koşu JSON
                </button>
              </div>
              <details>
                <summary>Gözlemler ve sürümler</summary>
                <pre>{JSON.stringify(run, null, 2)}</pre>
              </details>
            </div>
          ))}
          {compare.length >= 2 && (
            <>
              <h3>Seçili koşullar</h3>
              <button
                className="secondary small"
                disabled={
                  busy || !available || active || replaying || transportBusy
                }
                onClick={() =>
                  void perform(async () => {
                    const records = await Promise.all(
                      [...new Set(compare.flatMap((r) => r.recording_ids))].map(
                        (id) => api.recording(id),
                      ),
                    );
                    records.forEach(onReplay);
                  })
                }
              >
                Seçili uçuşları analize al
              </button>
              <p>
                Farklı görev, hız veya senaryolar eşdeğer deney sayılmaz. Başarı
                sıralaması yapılmaz. Uçuş metrikleri için kayıtları Analiz
                ekranında açın.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Koşu</th>
                      <th>Sonuç</th>
                      <th>Tanım</th>
                      <th>Görev</th>
                      <th>Hız</th>
                      <th>Gözlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compare.map((r) => (
                      <tr key={r.id}>
                        <td>{r.id.slice(0, 8)}</td>
                        <td>{labels[r.status]}</td>
                        <td>
                          {r.definition.kind} / v{r.definition.version}
                        </td>
                        <td>{r.definition.mission_fingerprint.slice(7, 19)}</td>
                        <td>{r.definition.speedup}×</td>
                        <td>
                          {r.checks.filter((c) => c.status === "passed").length}
                          /{r.checks.length}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
