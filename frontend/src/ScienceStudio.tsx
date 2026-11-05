import { useEffect, useRef, useState } from "react";
import { api, post } from "./api";
import catalog from "./simulation-catalog.json";
import { calculate, paint, exportSimulation } from "./simulationEngine";
import type { Spec } from "./simulationEngine";
type Saved = { id: string; title: string; description: string; spec: Spec };
const defaultSpec = (kind: string): Spec => ({
  kind,
  params: Object.fromEntries(
    catalog.find((d) => d.id === kind)!.params.map((p) => [p.key, p.value]),
  ),
});
export default function ScienceStudio({
  demo,
  notify,
}: {
  demo: boolean;
  notify: (s: string) => void;
}) {
  const [spec, setSpec] = useState<Spec>(defaultSpec("pendulum"));
  const [text, setText] = useState(
    "单摆，摆长为 1 m，初始角度为 10°，重力加速度为 9.8 m/s²。",
  );
  const [title, setTitle] = useState("单摆的周期与摆长");
  const [useAI, setAI] = useState(false);
  const [consent, setConsent] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [rate, setRate] = useState(1);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState("");
  const [engine, setEngine] = useState("浏览器本地公式仿真");
  const canvas = useRef<HTMLCanvasElement>(null);
  const clock = useRef(0);
  const definition = catalog.find((d) => d.id === spec.kind)!;
  const frame = calculate(spec, time);
  const horizon =
    spec.kind === "projectile"
      ? Math.sqrt((2 * spec.params.height) / spec.params.gravity)
      : spec.kind === "rc"
        ? (5 * spec.params.resistance * spec.params.capacitance) / 1000
        : 20;
  const load = () => {
    if (!demo)
      api<Saved[]>("/simulations")
        .then(setSaved)
        .catch((e) => notify(e.message));
  };
  useEffect(() => {
    load();
  }, [demo]);
  useEffect(() => {
    setPlaying(false);
    setTime(0);
    clock.current = 0;
  }, [spec]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (ctx) paint(ctx, spec, calculate(spec, time));
    clock.current = time;
  }, [time, spec]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      clock.current = Math.min(horizon, clock.current + dt * rate);
      setTime(clock.current);
      if (clock.current >= horizon) setPlaying(false);
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, horizon]);
  function download() {
    const html = exportSimulation(
      spec,
      title,
      definition.assumption + " 公式：" + definition.formula,
    );
    const url = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "TeachAgent-动态模型.html";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function interpret() {
    setBusy(true);
    try {
      if (demo) {
        const d = catalog.find((d) =>
          d.keywords.some((k) => text.toLowerCase().includes(k.toLowerCase())),
        );
        if (!d)
          throw Error(
            "演示支持单摆、平抛、弹簧、行波与 RC 电路，请选择一种模型。",
          );
        setSpec(defaultSpec(d.id));
        setEngine("静态演示：匹配模型，使用默认参数，可手动调整");
      } else {
        const result = await post<{ spec: Spec; engine: string }>(
          "/simulations/interpret",
          { title, description: text, use_ai: useAI, allow_external: consent },
        );
        setSpec(result.spec);
        setEngine(result.engine);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "解析失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="seedance-studio">
      <header className="seedance-hero">
        <div>
          <span className="seedance-eyebrow">SCIENCE / LIVE MODELS</span>
          <h1>原理看得见，参数跟着动。</h1>
          <p>同一物理时钟驱动画面与数值。暂停、拖动、改参数，观察规律。</p>
        </div>
      </header>
      <div className="notice">
        当前提供 5
        类经过公式校验的模型。动画在老师的浏览器本地计算，不消耗视频生成额度；AI
        仅可辅助将描述转换为受限参数，不执行模型生成的代码。
        {demo && " 演示可交互、可导出，但不会保存到账号。"}
      </div>
      <div className="seedance-layout">
        <section className="panel seedance-compose">
          <h2>从课程内容建立模型</h2>
          <label>
            模型名称
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
            />
          </label>
          <label>
            课程内容或原理
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              maxLength={6000}
            />
          </label>
          <label className="seedance-consent">
            <input
              type="checkbox"
              checked={useAI}
              disabled={demo}
              onChange={(e) => setAI(e.target.checked)}
            />
            <span>用“空间设置”里的个人 API / 本地 Ollama 辅助解析</span>
          </label>
          {useAI && (
            <label className="seedance-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>若选择个人在线 API，我同意发送这段课程描述。</span>
            </label>
          )}
          <button
            className="btn primary"
            disabled={busy || !title.trim() || text.length < 5}
            onClick={interpret}
          >
            根据描述生成模型
          </button>
          <p className="subtle">
            {engine}。规则解析可识别“摆长为 2”“初始高度为
            20”等目录参数，未指定的使用默认值；请检查下方参数及单位。
          </p>
        </section>
        <section className="panel seedance-settings">
          <h2>模型与初始条件</h2>
          <label>
            模型类型
            <select
              value={spec.kind}
              onChange={(e) => setSpec(defaultSpec(e.target.value))}
            >
              {catalog.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {definition.params.map((p) => (
            <label key={p.key}>
              {p.label}（{p.unit}）
              <input
                type="number"
                value={spec.params[p.key]}
                min={p.min}
                max={p.max}
                step={p.step}
                onChange={(e) => {
                  const value = e.target.valueAsNumber;
                  if (
                    Number.isFinite(value) &&
                    value >= p.min &&
                    value <= p.max
                  )
                    setSpec({
                      ...spec,
                      params: { ...spec.params, [p.key]: value },
                    });
                }}
              />
            </label>
          ))}
          <p className="subtle">修改参数会回到 t=0。{definition.assumption}</p>
        </section>
      </div>
      <section className="panel seedance-compose" aria-label="同步模型动画">
        <h2>{definition.name} · 动画与参数同步</h2>
        <p className="subtle">{definition.formula}</p>
        <canvas
          ref={canvas}
          width={900}
          height={420}
          style={{ width: "100%", height: "auto", borderRadius: 16 }}
          aria-label="模型运动画面"
        />
        <div className="seedance-actions">
          <button className="btn primary" onClick={() => setPlaying((v) => !v)}>
            {playing ? "暂停动画" : "播放动画"}
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              setPlaying(false);
              setTime(0);
              clock.current = 0;
            }}
          >
            重置时间
          </button>
          <label>
            播放速度
            <select
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </label>
          <strong data-testid="simulation-time">
            t = {frame.t.toFixed(2)} s
          </strong>
        </div>
        <label>
          时间轴
          <input
            type="range"
            min={0}
            max={horizon}
            step={0.01}
            value={time}
            onChange={(e) => {
              setPlaying(false);
              setTime(Number(e.target.value));
            }}
          />
        </label>
        <div className="science-values">
          {frame.metrics.map((m) => (
            <div key={m.label}>
              <span>{m.label}</span>
              <strong>
                {m.value.toFixed(3)} {m.unit}
              </strong>
            </div>
          ))}
        </div>
        <div className="seedance-actions">
          <button className="btn secondary" onClick={download}>
            导出可动模型 HTML
          </button>
          <button
            className="btn primary"
            disabled={busy || !title.trim()}
            onClick={async () => {
              if (demo) {
                notify("演示不保存账号数据，可导出 HTML 在本机播放。");
                return;
              }
              setBusy(true);
              try {
                await post("/simulations", { title, description: text, spec });
                load();
                notify("模型已保存到我的空间。");
              } catch (e) {
                notify(e instanceof Error ? e.message : "保存失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            保存模型
          </button>
        </div>
        <p className="subtle">
          HTML
          文件可离线打开、暂停和拖动时间轴，画面包含同步参数。这是可计算的交互课件，不是
          AI 视频中的装饰性数字。
        </p>
      </section>
      <section className="seedance-collection">
        <h2>我的模型课件</h2>
        <div className="seedance-grid">
          {saved.map((v) => (
            <article className="panel seedance-card" key={v.id}>
              <div className="seedance-card-body">
                <h3>{v.title}</h3>
                <div className="seedance-actions">
                  <button
                    className="btn secondary"
                    onClick={() => {
                      setTitle(v.title);
                      setText(v.description);
                      setSpec(v.spec);
                    }}
                  >
                    载入模型
                  </button>
                  <button className="text-btn" onClick={() => setRemove(v.id)}>
                    删除模型
                  </button>
                  {remove === v.id && (
                    <button
                      className="btn danger"
                      onClick={async () => {
                        try {
                          await api(`/simulations/${v.id}`, {
                            method: "DELETE",
                          });
                          load();
                          setRemove("");
                        } catch (e) {
                          notify(e instanceof Error ? e.message : "删除失败");
                        }
                      }}
                    >
                      确认删除模型
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
