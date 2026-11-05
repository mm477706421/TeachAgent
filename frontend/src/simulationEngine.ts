export type Spec = { kind: string; params: Record<string, number> };
export type Snapshot = {
  t: number;
  x: number;
  y: number;
  metrics: { label: string; value: number; unit: string }[];
};
export function calculate(spec: Spec, time: number): Snapshot {
  const p = spec.params;
  const pi = Math.PI;
  let t = time,
    x = 0,
    y = 0;
  let metrics: Snapshot["metrics"] = [];
  if (spec.kind === "pendulum") {
    const w = Math.sqrt(p.gravity / p.length),
      a = (p.angle * pi) / 180,
      theta = a * Math.cos(w * t),
      omega = -a * w * Math.sin(w * t);
    x = p.length * Math.sin(theta);
    y = p.length * Math.cos(theta);
    metrics = [
      { label: "摆角", value: (theta * 180) / pi, unit: "°" },
      { label: "角速度", value: omega, unit: "rad/s" },
      { label: "周期", value: (2 * pi) / w, unit: "s" },
    ];
  }
  if (spec.kind === "projectile") {
    t = Math.min(t, Math.sqrt((2 * p.height) / p.gravity));
    x = p.speed * t;
    y = Math.max(0, p.height - 0.5 * p.gravity * t * t);
    metrics = [
      { label: "水平位移", value: x, unit: "m" },
      { label: "距地高度", value: y, unit: "m" },
      { label: "竖直速度", value: -p.gravity * t, unit: "m/s" },
      {
        label: "速率（触地前）",
        value: Math.hypot(p.speed, p.gravity * t),
        unit: "m/s",
      },
    ];
  }
  if (spec.kind === "spring") {
    const w = Math.sqrt(p.stiffness / p.mass);
    x = p.amplitude * Math.cos(w * t);
    const v = -p.amplitude * w * Math.sin(w * t);
    metrics = [
      { label: "位移", value: x, unit: "m" },
      { label: "速度", value: v, unit: "m/s" },
      { label: "加速度", value: -w * w * x, unit: "m/s²" },
      {
        label: "机械能",
        value: 0.5 * p.stiffness * p.amplitude * p.amplitude,
        unit: "J",
      },
    ];
  }
  if (spec.kind === "wave") {
    x = 1;
    y = p.amplitude * Math.sin(2 * pi * (x / p.wavelength - p.frequency * t));
    metrics = [
      { label: "标记点位移", value: y, unit: "m" },
      { label: "波速", value: p.wavelength * p.frequency, unit: "m/s" },
      { label: "周期", value: 1 / p.frequency, unit: "s" },
    ];
  }
  if (spec.kind === "rc") {
    const r = p.resistance * 1000,
      c = p.capacitance / 1e6,
      tau = r * c;
    const u = p.voltage * (1 - Math.exp(-t / tau)),
      i = (p.voltage / r) * Math.exp(-t / tau);
    x = u / p.voltage;
    y = i * 1000;
    metrics = [
      { label: "电容电压", value: u, unit: "V" },
      { label: "电流", value: i * 1000, unit: "mA" },
      { label: "电荷量", value: c * u * 1000, unit: "mC" },
      { label: "时间常数", value: tau, unit: "s" },
    ];
  }
  return { t, x, y, metrics };
}
export function paint(ctx: CanvasRenderingContext2D, spec: Spec, s: Snapshot) {
  const p = spec.params;
  ctx.clearRect(0, 0, 900, 420);
  ctx.fillStyle = "#f5f8f0";
  ctx.fillRect(0, 0, 900, 420);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#54755f";
  ctx.fillStyle = "#244d3e";
  ctx.font = "18px sans-serif";
  ctx.fillText("t = " + s.t.toFixed(2) + " s", 30, 35);
  const line = (x: number, y: number, xx: number, yy: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(xx, yy);
    ctx.stroke();
  };
  const dot = (x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = "#287a63";
    ctx.fill();
  };
  if (spec.kind === "pendulum") {
    const scale = 260 / p.length;
    line(200, 65, 400, 65);
    line(300, 65, 300 + s.x * scale, 65 + s.y * scale);
    dot(300 + s.x * scale, 65 + s.y * scale);
    ctx.fillText("理想单摆 · 小角度近似", 30, 390);
  }
  if (spec.kind === "projectile") {
    const range = p.speed * Math.sqrt((2 * p.height) / p.gravity),
      sx = 480 / range,
      sy = 280 / p.height;
    line(40, 350, 550, 350);
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    for (let i = 0; i <= 100; i++) {
      const t = (i / 100) * Math.sqrt((2 * p.height) / p.gravity);
      const x = 40 + p.speed * t * sx,
        y = 350 - (p.height - 0.5 * p.gravity * t * t) * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    dot(40 + s.x * sx, 350 - s.y * sy);
    ctx.fillText("平抛轨迹 · 落地停止", 30, 390);
  }
  if (spec.kind === "spring") {
    const end = 300 + (s.x / p.amplitude) * 150;
    line(40, 90, 40, 320);
    ctx.beginPath();
    ctx.moveTo(40, 210);
    for (let i = 1; i <= 18; i++)
      ctx.lineTo(
        40 + ((end - 40) * i) / 18,
        210 + (i === 18 ? 0 : i % 2 ? 20 : -20),
      );
    ctx.stroke();
    ctx.fillRect(end, 180, 45, 60);
    line(40, 245, 560, 245);
    ctx.fillText("弹簧振子 · 相对平衡位置", 30, 390);
  }
  if (spec.kind === "wave") {
    line(30, 210, 560, 210);
    ctx.beginPath();
    for (let i = 0; i <= 500; i++) {
      const x = i / 100,
        y =
          p.amplitude *
          Math.sin(2 * Math.PI * (x / p.wavelength - p.frequency * s.t));
      if (i === 0) ctx.moveTo(30 + i, 210 - y * 120);
      else ctx.lineTo(30 + i, 210 - y * 120);
    }
    ctx.stroke();
    dot(130, 210 - s.y * 120);
    ctx.fillText("标记点 x = 1m · 波向右传播", 30, 390);
  }
  if (spec.kind === "rc") {
    line(100, 100, 480, 100);
    line(480, 100, 480, 190);
    line(480, 230, 480, 320);
    line(480, 320, 100, 320);
    line(100, 100, 100, 180);
    line(100, 240, 100, 320);
    line(70, 180, 130, 180);
    line(85, 240, 115, 240);
    line(440, 190, 520, 190);
    line(440, 230, 520, 230);
    ctx.clearRect(240, 80, 100, 40);
    ctx.strokeRect(240, 80, 100, 40);
    ctx.fillStyle = "#b8d67c";
    ctx.fillRect(445, 195, 70, 30 * s.x);
    ctx.fillStyle = "#244d3e";
    ctx.fillText("R", 280, 65);
    ctx.fillText("C", 535, 220);
    ctx.fillText("U", 45, 220);
    if (s.y > 0.001) dot(120 + ((s.t * p.voltage * 15) % 330), 100);
    ctx.fillText("RC 充电 · 亮色代表电容充电比例", 30, 390);
  }
  ctx.fillStyle = "#fff";
  ctx.fillRect(600, 0, 300, 420);
  ctx.fillStyle = "#244d3e";
  ctx.font = "16px sans-serif";
  ctx.fillText("同步参数", 625, 40);
  s.metrics.forEach((m, i) => {
    ctx.fillStyle = "#66775f";
    ctx.font = "15px sans-serif";
    ctx.fillText(m.label, 625, 85 + i * 78);
    ctx.fillStyle = "#244d3e";
    ctx.font = "24px monospace";
    ctx.fillText(m.value.toFixed(3) + " " + m.unit, 625, 118 + i * 78);
  });
}

export function exportSimulation(
  spec: Spec,
  title: string,
  assumption: string,
) {
  const encoded = JSON.stringify({ spec, title, assumption }).replace(
    /</g,
    "\\u003c",
  );
  return String.raw`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TeachAgent 动态模型</title><style>body{font:16px system-ui;margin:24px auto;max-width:1000px;padding:16px;color:#244d3e;background:#f6f8f1}canvas{width:100%;border:1px solid #cddac9;border-radius:16px}button,input{margin:12px;padding:8px}pre{white-space:pre-wrap}</style><h1 id="title"></h1><p id="note"></p><canvas width="900" height="420" id="scene"></canvas><div><button id="play">播放 / 暂停</button><button id="reset">重置</button><label>时间 <input id="time" type="range" min="0" max="20" step="0.01" value="0"></label></div><pre id="values"></pre><script>const data=${encoded};const compute=${calculate.toString()};const draw=${paint.toString()};const canvas=document.getElementById('scene'),ctx=canvas.getContext('2d'),slider=document.getElementById('time');document.getElementById('title').textContent=data.title;document.getElementById('note').textContent=data.assumption;let t=0,playing=false,last=performance.now();if(data.spec.kind==='projectile')slider.max=Math.sqrt(2*data.spec.params.height/data.spec.params.gravity);if(data.spec.kind==='rc')slider.max=5*data.spec.params.resistance*data.spec.params.capacitance/1000;function render(){const s=compute(data.spec,t);draw(ctx,data.spec,s);slider.value=t;document.getElementById('values').textContent=s.metrics.map(m=>m.label+': '+m.value.toFixed(3)+' '+m.unit).join('\n')}slider.oninput=()=>{playing=false;t=Number(slider.value);render()};document.getElementById('play').onclick=()=>playing=!playing;document.getElementById('reset').onclick=()=>{t=0;playing=false;render()};function frame(now){if(playing){t=Math.min(Number(slider.max),t+Math.min((now-last)/1000,.1));if(t>=Number(slider.max))playing=false;render()}last=now;requestAnimationFrame(frame)}render();requestAnimationFrame(frame);</script>`;
}
