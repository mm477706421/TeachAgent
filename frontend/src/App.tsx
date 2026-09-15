import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChartBar,
  ChartLineUp,
  ChatsCircle,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  CloudArrowUp,
  Database,
  DownloadSimple,
  FileText,
  FolderOpen,
  GearSix,
  GraduationCap,
  House,
  Leaf,
  List,
  LockKey,
  MagnifyingGlass,
  Microphone,
  Play,
  Plus,
  Question,
  ShieldCheck,
  SignOut,
  Sparkle,
  Trash,
  Users,
  VideoCamera,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, download, post, setCsrf, upload } from "./api";
import type { Analysis, Lesson, Message, System, User } from "./types";
import demoData from "./demo.json";

const DEMO = demoData as Lesson;
type Page =
  | "overview"
  | "lessons"
  | "analysis"
  | "reports"
  | "chat"
  | "settings"
  | "admin";
const NAV: { id: Page; label: string; icon: typeof House }[] = [
  { id: "overview", label: "工作概览", icon: House },
  { id: "lessons", label: "我的课堂", icon: VideoCamera },
  { id: "analysis", label: "教学洞察", icon: ChartBar },
  { id: "reports", label: "分析报告", icon: FileText },
  { id: "chat", label: "教研助手", icon: ChatsCircle },
];
const colors: Record<string, string> = {
  课堂导入: "#bdd9cf",
  知识讲授: "#287a63",
  探究互动: "#c0d97b",
  练习巩固: "#ebc589",
  总结回顾: "#98b6c9",
};
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  });
const err = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={"brand " + (light ? "brand-light" : "")}>
      <span className="brand-icon">
        <GraduationCap size={26} weight="duotone" />
      </span>
      <span>
        Teach<span className="brand-accent">Agent</span>
        <small>课堂洞察 · 教学新生</small>
      </span>
    </div>
  );
}
function Badge({
  children,
  tone = "green",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={"panel " + className}>
      <div className="panel-inner">{children}</div>
    </section>
  );
}
function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <FolderOpen size={44} weight="duotone" />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <header>
        <div>
          <span className="eyebrow">TEACHAGENT WORKSPACE</span>
          <h2>{title}</h2>
        </div>
        <button className="icon-btn" aria-label="关闭弹窗" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Orbit() {
  return (
    <div className="orbit-art" aria-hidden="true">
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="orbit orbit-three" />
      <div className="orb">
        <GraduationCap size={76} weight="light" />
      </div>
      <span className="orbit-node node-one">
        <Microphone size={21} />
      </span>
      <span className="orbit-node node-two">
        <ChartLineUp size={23} />
      </span>
      <span className="orbit-node node-three">
        <Sparkle size={20} />
      </span>
      <div className="orbit-caption">
        <span />
        LOCAL INTELLIGENCE
      </div>
    </div>
  );
}

function Login({
  onLogin,
  onDemo,
}: {
  onLogin: (user: User) => void;
  onDemo: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await post<{ user: User; csrf: string }>(
        "/auth/login",
        Object.fromEntries(f),
      );
      setCsrf(r.csrf);
      onLogin(r.user);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand light />
        <div className="login-story-content">
          <Badge tone="glass">
            <Leaf size={14} /> 为每一次教学成长
          </Badge>
          <h1>
            让每一堂课，
            <br />
            看见更多<span>可能。</span>
          </h1>
          <p>
            从课堂记录到教学洞察，
            <br />
            与你一起，发现好教学的下一步。
          </p>
          <Orbit />
        </div>
        <div className="login-trust">
          <ShieldCheck size={21} />
          <span>本地计算 · 数据留校 · 教师专属空间</span>
        </div>
      </section>
      <main className="login-form-wrap">
        <div className="login-form">
          <span className="eyebrow">YOUR TEACHING COMPANION</span>
          <h2>欢迎回到教研工作台</h2>
          <p>用一堂课的反思，开启下一堂课的改变。</p>
          <form onSubmit={submit}>
            <label>
              教师账号
              <input
                name="username"
                placeholder="请输入学校分配的账号"
                autoComplete="username"
                required
                maxLength={64}
              />
            </label>
            <label>
              登录密码
              <input
                name="password"
                type="password"
                placeholder="请输入密码"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <div className="login-note">
              <LockKey size={15} /> 仅连接学校本地服务
            </div>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="btn primary full" disabled={busy}>
              {busy ? <CircleNotch className="spin" /> : "进入工作台"}
              <span className="button-icon">
                <ArrowRight />
              </span>
            </button>
          </form>
          <div className="login-divider">
            <span>先了解 TeachAgent</span>
          </div>
          <button className="btn secondary full" onClick={onDemo}>
            <Play size={17} weight="fill" />
            体验示例工作台
          </button>
          <p className="fine-print">
            示例使用合成课堂数据，不代表真实教学评价。
            <br />
            账号由学校管理员创建；首次部署请参考功能文档。
          </p>
        </div>
        <footer>
          TeachAgent <span>让教学反思，自然发生。</span>
        </footer>
      </main>
    </div>
  );
}

function UploadModal({
  demo,
  onClose,
  onDone,
  notify,
}: {
  demo: boolean;
  onClose: () => void;
  onDone: (lesson: Lesson) => void;
  notify: (s: string) => void;
}) {
  const [mode, setMode] = useState<"video" | "text">("video"),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [error, setError] = useState(""),
    [drag, setDrag] = useState(false),
    [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo) {
      notify("当前为只读示例，请登录后上传真实课堂");
      return;
    }
    setError("");
    if (mode === "video" && !file) {
      setError("请先选择课堂视频");
      return;
    }
    setBusy(true);
    try {
      const f = new FormData(e.currentTarget);
      let lesson: Lesson;
      if (mode === "video") {
        f.set("file", file!);
        lesson = await upload(f, setProgress);
      } else {
        lesson = await post<Lesson>("/lessons/text", {
          title: f.get("title"),
          subject: f.get("subject"),
          class_name: f.get("class_name"),
          text,
        });
      }
      onDone(lesson);
    } catch (e) {
      setError(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="添加一堂新课"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-tabs">
        <button
          className={mode === "video" ? "active" : ""}
          disabled={busy}
          onClick={() => setMode("video")}
        >
          <VideoCamera />
          上传课堂视频
        </button>
        <button
          className={mode === "text" ? "active" : ""}
          disabled={busy}
          onClick={() => setMode("text")}
        >
          <FileText />
          导入转写文本
        </button>
      </div>
      <form onSubmit={submit}>
        <label>
          课堂名称
          <input
            name="title"
            placeholder="例如：二次函数的图像与性质"
            required
            maxLength={120}
            disabled={busy}
          />
        </label>
        <div className="form-grid">
          <label>
            学科
            <select name="subject" disabled={busy}>
              {[
                "数学",
                "语文",
                "英语",
                "物理",
                "化学",
                "生物",
                "历史",
                "地理",
                "综合",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            授课班级
            <input
              name="class_name"
              placeholder="例如：九年级 · 三班"
              maxLength={60}
              disabled={busy}
            />
          </label>
        </div>
        {mode === "video" ? (
          <>
            <button
              type="button"
              disabled={busy}
              className={"dropzone " + (drag ? "drag" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                if (!busy) setFile(e.dataTransfer.files[0] || null);
              }}
              onClick={() => input.current?.click()}
            >
              <span className="upload-circle">
                <CloudArrowUp size={34} weight="light" />
              </span>
              <strong>
                {file ? file.name : "点击选择，或将课堂视频拖到这里"}
              </strong>
              <span>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB · 文件已选择`
                  : "MP4、MOV、MKV、AVI、WebM、M4V"}
              </span>
            </button>
            <input
              ref={input}
              type="file"
              hidden
              accept=".mp4,.mov,.mkv,.avi,.webm,.m4v"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </>
        ) : (
          <>
            <label>
              课堂转写（可粘贴 TXT / SRT / VTT）
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                required
                maxLength={200000}
                rows={7}
                placeholder="教师：今天我们一起探究……&#10;学生：我的想法是……"
                disabled={busy}
              />
            </label>
            <label className="text-file">
              从本地文件读取
              <input
                type="file"
                accept=".txt,.srt,.vtt"
                disabled={busy}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 1000000) {
                      setError("文本文件不得超过 1 MB");
                      return;
                    }
                    setText(await f.text());
                  }
                }}
              />
            </label>
          </>
        )}
        <div className="privacy-note">
          <ShieldCheck size={20} />
          <p>
            <strong>课堂数据，始终留在学校</strong>
            <span>
              视频与文本仅保存至本地服务器，转写与分析不调用外部服务。
            </span>
          </p>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <div className="upload-progress">
            <progress max={100} value={progress} />
            <span>
              {mode === "video"
                ? `上传 ${progress}% · 上传完成后将进入本地处理队列`
                : "正在生成文本分析…"}
            </span>
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? <CircleNotch className="spin" /> : <Sparkle />}
            {mode === "video" ? "上传并开始分析" : "开始文本分析"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function LessonTable({
  lessons,
  onSelect,
  limit,
}: {
  lessons: Lesson[];
  onSelect: (l: Lesson) => void;
  limit?: number;
}) {
  return (
    <div className="lesson-table-wrap">
      <table className="lesson-table">
        <thead>
          <tr>
            <th>课堂名称</th>
            <th>授课日期</th>
            <th>时长</th>
            <th>状态</th>
            <th aria-label="打开课堂" />
          </tr>
        </thead>
        <tbody>
          {lessons.slice(0, limit).map((l) => (
            <tr key={l.id} onClick={() => onSelect(l)}>
              <td>
                <div className="lesson-name">
                  <span
                    className={
                      "subject-icon " + (l.subject === "数学" ? "math" : "")
                    }
                  >
                    <BookOpen size={23} weight="duotone" />
                  </span>
                  <div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(l);
                      }}
                    >
                      {l.title}
                    </button>
                    <small>
                      {l.subject} <span>·</span> {l.class_name}{" "}
                      {l.example ? "· 示例" : ""}
                    </small>
                  </div>
                </div>
              </td>
              <td>{date(l.created)}</td>
              <td className="numeric">{l.duration ? time(l.duration) : "—"}</td>
              <td>
                <Badge
                  tone={
                    l.status === "completed"
                      ? "green"
                      : l.status === "failed"
                        ? "red"
                        : "amber"
                  }
                >
                  {l.status === "completed" ? (
                    <CheckCircle weight="fill" size={13} />
                  ) : l.status === "failed" ? (
                    <WarningCircle size={13} />
                  ) : (
                    <CircleNotch className="spin" size={13} />
                  )}
                  {{
                    completed: "分析完成",
                    failed: "处理失败",
                    queued: "等待处理",
                    processing: "本地分析中",
                    uploading: "上传中",
                  }[l.status] || l.status}
                </Badge>
              </td>
              <td>
                <ArrowUpRight size={18} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Rhythm({ analysis }: { analysis: Analysis }) {
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={analysis.rhythm.map((d) => ({ ...d, label: time(d.start) }))}
          margin={{ left: -24, right: 12, top: 12, bottom: 0 }}
        >
          <defs>
            <linearGradient id="question-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4c987f" stopOpacity={0.26} />
              <stop offset="100%" stopColor="#4c987f" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 5"
            vertical={false}
            stroke="#e8eeeb"
          />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#899890" }}
            interval={2}
          />
          <YAxis
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#899890" }}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: "none",
              boxShadow: "0 10px 40px #163e3615",
            }}
          />
          <Area
            type="monotone"
            dataKey="questions"
            name="提问线索"
            stroke="#327f68"
            strokeWidth={2.5}
            fill="url(#question-fill)"
          />
          <Area
            type="monotone"
            dataKey="interactions"
            name="互动邀请"
            stroke="#b5c879"
            strokeWidth={2}
            fill="transparent"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Distribution({ analysis }: { analysis: Analysis }) {
  return (
    <div className="distribution">
      <div
        className="donut"
        style={{
          background: `conic-gradient(${analysis.distribution.map((s, i, a) => `${colors[s.name]} ${a.slice(0, i).reduce((v, x) => v + x.percent, 0)}% ${a.slice(0, i + 1).reduce((v, x) => v + x.percent, 0)}%`).join(",")})`,
        }}
      >
        <div>
          <strong>{analysis.timeline.length}</strong>
          <span>连续教学环节</span>
        </div>
      </div>
      <div className="distribution-legend">
        {analysis.distribution.map((s) => (
          <div key={s.name}>
            <span
              className="legend-dot"
              style={{ background: colors[s.name] }}
            />
            <span>{s.name}</span>
            <strong>{s.percent}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Overview({
  user,
  lessons,
  demo,
  onUpload,
  onSelect,
  onPage,
  onExample,
}: {
  user: User;
  lessons: Lesson[];
  demo: boolean;
  onUpload: () => void;
  onSelect: (l: Lesson) => void;
  onPage: (p: Page) => void;
  onExample: () => void;
}) {
  const complete = lessons.filter((l) => l.status === "completed"),
    latest = complete[0],
    a = latest?.analysis || (latest?.id === DEMO.id ? DEMO.analysis : null);
  const real = lessons.filter((l) => !l.example),
    counted = demo ? lessons : real;
  const stats = [
    {
      label: "已记录课堂",
      value: counted.length,
      unit: "节",
      icon: VideoCamera,
      note: demo ? "合成课堂体验" : "属于你的教学记录",
      tone: "mint",
    },
    {
      label: "累计课堂时长",
      value: Math.round(counted.reduce((n, l) => n + l.duration, 0) / 60),
      unit: "分钟",
      icon: Clock,
      note: "沉淀每一分钟的教学",
      tone: "sand",
    },
    {
      label: "提问线索",
      value: counted.reduce((n, l) => n + (l.metrics?.questions || 0), 0),
      unit: "处",
      icon: ChatsCircle,
      note: "从问题中发现学习契机",
      tone: "blue",
    },
    {
      label: "可查看报告",
      value: counted.filter((l) => l.status === "completed").length,
      unit: "份",
      icon: ChartLineUp,
      note: "让教学经验成为可见资产",
      tone: "lavender",
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TEACHING, WITH A LITTLE MORE INSIGHT</span>
          <h1>
            你好，{user.name}
            <span className="greeting-leaf">
              <Leaf size={27} weight="duotone" />
            </span>
          </h1>
          <p>每一次回看，都是下一堂好课的开始。</p>
        </div>
        <div className="date-note">
          <span className="status-dot" />{" "}
          {new Date().toLocaleDateString("zh-CN", {
            year: "numeric",
            month: "long",
            day: "numeric",
            weekday: "long",
          })}
        </div>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <Badge tone="glass">
            <Sparkle size={14} /> 你的专属教学成长伙伴
          </Badge>
          <h2>
            让课堂被看见，
            <br />
            让成长<span>有迹可循。</span>
          </h2>
          <p>
            上传一堂课，收获一份有依据的教学洞察。
            <br />
            从授课节奏到课堂互动，发现下一次改变的起点。
          </p>
          <button className="btn hero-cta" onClick={onUpload}>
            上传新课堂{" "}
            <span className="button-icon">
              <Plus size={20} />
            </span>
          </button>
          <div className="hero-privacy">
            <ShieldCheck size={15} /> 全程本地处理，教学数据不出校
          </div>
        </div>
        <Orbit />
      </section>
      <div className="stats-grid">
        {stats.map((s) => (
          <Panel key={s.label} className="stat">
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={"stat-icon " + s.tone}>
                <s.icon size={20} weight="duotone" />
              </span>
            </div>
            <div className="stat-value">
              {s.value}
              <span>{s.unit}</span>
            </div>
            <p>{s.note}</p>
          </Panel>
        ))}
      </div>
      <div className="overview-middle">
        <Panel className="recent-panel">
          <div className="section-heading">
            <h2>
              最近的课堂{" "}
              <span className="count-pill">
                {lessons.length.toString().padStart(2, "0")}
              </span>
            </h2>
            <button className="text-btn" onClick={() => onPage("lessons")}>
              全部课堂
              <ArrowRight size={15} />
            </button>
          </div>
          {lessons.length ? (
            <LessonTable lessons={lessons} limit={3} onSelect={onSelect} />
          ) : (
            <Empty
              title="你的第一堂课，从这里开始"
              description="上传课堂视频，或导入本地转写文本。"
              action={
                <button className="btn secondary" onClick={onExample}>
                  添加合成示例，了解分析流程
                </button>
              }
            />
          )}
        </Panel>
        <Panel className="insight-panel">
          <div className="section-heading">
            <h2>
              <Sparkle weight="duotone" /> 教学灵感
            </h2>
            <Badge tone="light">下一步</Badge>
          </div>
          <div className="insight-art">
            <ChatsCircle size={43} weight="duotone" />
            <span>
              <Plus size={13} />
            </span>
          </div>
          <h3>{a?.suggestions[0]?.title || "好问题，是课堂的另一种开始"}</h3>
          <p>
            {a?.suggestions[0]?.action ||
              "为学生多留几秒思考时间，让回答从“是什么”走向“为什么”。记录与回看，会让改变更清晰。"}
          </p>
          <button
            className="text-btn"
            onClick={() => (latest ? onSelect(latest) : onUpload())}
          >
            探索教学建议
            <ArrowUpRight size={17} />
          </button>
        </Panel>
      </div>
      <div className="overview-bottom">
        <Panel>
          <div className="section-heading">
            <div>
              <h2>课堂互动节奏</h2>
              <p>
                {latest
                  ? `${latest.title} · ${latest.example ? "示例课堂" : "最近一课"}`
                  : "记录提问与互动邀请在课堂中的分布"}
              </p>
            </div>
            <div className="chart-legend">
              <span>
                <i />
                提问
              </span>
              <span>
                <i />
                互动
              </span>
            </div>
          </div>
          {a ? (
            <Rhythm analysis={a} />
          ) : (
            <Empty
              title="等待第一份分析"
              description="分析完成后呈现课堂时间轴。"
            />
          )}
        </Panel>
        <Panel>
          <div className="section-heading">
            <div>
              <h2>教学时间分配</h2>
              <p>按有效话语时长统计</p>
            </div>
            <ChartBar size={20} />
          </div>
          {a ? (
            <Distribution analysis={a} />
          ) : (
            <Empty
              title="看见课堂结构"
              description="导入、讲授、互动、练习与总结。"
            />
          )}
        </Panel>
      </div>
      <div className="workspace-footer">
        <span>
          <ShieldCheck size={15} /> 数据留在本地，成长掌握在自己手中。
        </span>
        <span>TeachAgent · 你的教学成长伙伴</span>
      </div>
    </>
  );
}

function ChatPanel({
  lesson,
  demo,
  notify,
}: {
  lesson: Lesson;
  demo: boolean;
  notify: (s: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMessages([]);
    if (!demo)
      api<Message[]>(`/lessons/${lesson.id}/chat`)
        .then(setMessages)
        .catch((e) => notify(err(e)));
  }, [lesson.id, demo]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages, busy]);
  async function send(e?: FormEvent, question?: string) {
    e?.preventDefault();
    const text = (question || value).trim();
    if (!text || busy) return;
    setValue("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      let reply: Message;
      if (demo) {
        const s = lesson.analysis!.suggestions[0];
        reply = {
          role: "assistant",
          content: `【示例回答】${s.evidence}\n\n建议：${s.action}\n\n依据：片段 #${s.segment_id}。登录后可使用本机 Ollama 进行连续追问。`,
          engine: "demo",
        };
      } else
        reply = await post<Message>(`/lessons/${lesson.id}/chat`, {
          message: text,
        });
      setMessages((m) => [...m, reply]);
    } catch (e) {
      setMessages((m) => m.slice(0, -1));
      setValue(text);
      notify(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-panel">
      <div className="chat-intro">
        <span className="assistant-avatar">
          <Sparkle size={24} weight="duotone" />
        </span>
        <div>
          <h3>一起聊聊，这堂课的更多可能</h3>
          <p>基于「{lesson.title}」的转写与分析回答</p>
        </div>
        <Badge>
          <LockKey size={12} />
          本地
        </Badge>
      </div>
      <div className="chat-messages">
        {!messages.length && (
          <div className="chat-starters">
            <p>从一个具体的问题开始</p>
            {[
              "某个环节为何互动偏少，可以怎么改？",
              "怎样把本课的提问改成开放式问题？",
              "我的课堂语言有哪些可以优化的地方？",
            ].map((q) => (
              <button key={q} onClick={() => send(undefined, q)}>
                {q}
                <ArrowUpRight size={16} />
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={"message " + m.role}>
            <span className="message-avatar">
              {m.role === "assistant" ? <Sparkle size={17} /> : "我"}
            </span>
            <div>
              <div className="message-bubble">{m.content}</div>
              {m.engine && (
                <small>
                  {m.engine === "local-rules"
                    ? "本地规则建议 · Ollama 未就绪"
                    : m.engine === "demo"
                      ? "合成示例回答"
                      : `本机模型 · ${m.engine.replace("ollama:", "")}`}
                </small>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="thinking">
            <CircleNotch className="spin" />
            正在本地整理课堂证据…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <input
          aria-label="向教研助手提问"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={2000}
          placeholder="关于这堂课，你想再了解什么？"
          disabled={busy}
        />
        <button
          className="btn primary"
          disabled={busy || !value.trim()}
          aria-label="发送问题"
        >
          <ArrowRight size={21} />
        </button>
      </form>
      <p className="chat-disclaimer">
        建议供教研参考，请结合真实课堂情境判断。规则模式不等同于大模型对话。
      </p>
    </div>
  );
}

function LessonDetail({
  lesson,
  demo,
  onClose,
  onRefresh,
  notify,
  startTab = "overview",
}: {
  lesson: Lesson;
  demo: boolean;
  onClose: () => void;
  onRefresh: () => void;
  notify: (s: string) => void;
  startTab?: string;
}) {
  const [tab, setTab] = useState(startTab),
    [query, setQuery] = useState(""),
    [confirmDelete, setConfirmDelete] = useState(false),
    [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null),
    a = lesson.analysis;
  async function exportReport(format: string) {
    if (demo) {
      const content =
        format === "json"
          ? JSON.stringify(lesson, null, 2)
          : `# 合成示例 · ${lesson.title}\n\n${a?.summary}\n\n${a?.suggestions.map((s) => `## ${s.title}\n${s.evidence}\n${s.action}`).join("\n\n")}`;
      const url = URL.createObjectURL(
        new Blob([content], { type: "text/plain;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `TeachAgent-example.${format === "json" ? "json" : "md"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }
    try {
      await download(
        `/lessons/${lesson.id}/report?format=${format}`,
        `report.${format}`,
      );
    } catch (e) {
      notify(err(e));
    }
  }
  function evidence(id: number) {
    setTab("transcript");
    setQuery("");
    setTimeout(
      () =>
        document
          .getElementById("segment-" + id)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      100,
    );
  }
  return (
    <>
      <button className="back-link" onClick={onClose}>
        <ArrowRight style={{ transform: "rotate(180deg)" }} /> 返回工作台
      </button>
      <div className="page-heading detail-heading">
        <div>
          <div className="inline-badges">
            <Badge>{lesson.subject}</Badge>
            {!!lesson.example && <Badge tone="amber">合成示例</Badge>}
          </div>
          <h1>{lesson.title}</h1>
          <p>
            {lesson.class_name} <span>·</span> {date(lesson.created)}{" "}
            <span>·</span> {time(lesson.duration)}
          </p>
        </div>
        <div className="button-row">
          {a && (
            <button className="btn primary" onClick={() => exportReport("md")}>
              <DownloadSimple />
              下载报告
            </button>
          )}
          <button
            className="icon-btn delete-button"
            aria-label="删除课堂"
            onClick={() =>
              demo ? notify("示例课堂为只读") : setConfirmDelete(true)
            }
          >
            <Trash size={20} />
          </button>
        </div>
      </div>
      {!a ? (
        <Panel>
          <div className="processing-state">
            {lesson.status === "failed" ? (
              <WarningCircle size={48} />
            ) : (
              <CircleNotch size={48} className="spin" />
            )}
            <h2>{lesson.stage}</h2>
            <p>
              {lesson.error || "视频抽帧 → 本地语音转写 → 文本蒸馏 → 教学分析"}
            </p>
            <progress max={100} value={lesson.progress} />
            <span>{lesson.progress}%</span>
            {lesson.status === "failed" && (
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await post(`/lessons/${lesson.id}/retry`);
                    onRefresh();
                  } catch (e) {
                    notify(err(e));
                  }
                }}
              >
                重新处理
              </button>
            )}
          </div>
        </Panel>
      ) : (
        <>
          <div className="detail-tabs">
            {[
              ["overview", "授课方式画像"],
              ["transcript", "转写与环节"],
              ["suggestions", `可优化点 · ${a.suggestions.length}`],
              ["chat", "AI 追问"],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {key === "chat" && <Sparkle size={17} />} {label}
              </button>
            ))}
          </div>
          {tab === "overview" && (
            <>
              <Panel className="summary-panel">
                <span className="assistant-avatar">
                  <Sparkle size={24} />
                </span>
                <div>
                  <h3>这堂课的教学观察</h3>
                  <p>{a.summary}</p>
                  <span className="subtle">
                    基于本地文本规则 · 所有指标均可回看原文
                  </span>
                </div>
              </Panel>
              <div className="detail-metrics">
                {[
                  ["提问线索", a.metrics.questions, "处"],
                  ["互动邀请", a.metrics.interactions, "处"],
                  ["话语语速", a.metrics.speech_rate, "字/分"],
                  ["有效话语", a.metrics.segments, "段"],
                ].map(([label, value, unit]) => (
                  <Panel key={label}>
                    <span className="subtle">{label}</span>
                    <div className="stat-value">
                      {value}
                      <span>{unit}</span>
                    </div>
                  </Panel>
                ))}
              </div>
              <div className="overview-bottom">
                <Panel>
                  <div className="section-heading">
                    <h2>提问与互动节奏</h2>
                    <Badge tone="light">文本线索</Badge>
                  </div>
                  <Rhythm analysis={a} />
                </Panel>
                <Panel>
                  <div className="section-heading">
                    <h2>教学时间分配</h2>
                  </div>
                  <Distribution analysis={a} />
                </Panel>
              </div>
              <Panel className="timeline-panel">
                <div className="section-heading">
                  <h2>课堂环节时间轴</h2>
                  <span className="subtle">点击环节定位证据</span>
                </div>
                <div className="timeline-bar">
                  {a.timeline.map((t, i) => (
                    <button
                      key={i}
                      style={{
                        flex: Math.max(t.end - t.start, 1),
                        background: colors[t.name],
                      }}
                      title={`${t.name} ${time(t.start)}—${time(t.end)}`}
                      aria-label={`${t.name} ${time(t.start)}`}
                      onClick={() => evidence(t.segment_ids[0])}
                    />
                  ))}
                </div>
                <div className="timeline-labels">
                  <span>00:00</span>
                  <span>{time(a.duration)}</span>
                </div>
              </Panel>
              <Panel className="method-panel">
                <h3>
                  <ShieldCheck size={20} /> 分析方法与边界
                </h3>
                {a.limitations.map((l) => (
                  <p key={l}>{l}</p>
                ))}
                <div className="button-row">
                  <button
                    className="btn secondary"
                    onClick={() => exportReport("json")}
                  >
                    <Database />
                    导出结构化数据
                  </button>
                  <button
                    className="btn secondary"
                    onClick={() =>
                      demo
                        ? notify("登录后支持 HTML 打印报告")
                        : exportReport("html")
                    }
                  >
                    <FileText />
                    下载可打印报告
                  </button>
                </div>
              </Panel>
            </>
          )}
          {tab === "transcript" && (
            <div
              className={
                "transcript-layout " + (!lesson.has_video ? "no-video" : "")
              }
            >
              {lesson.has_video && (
                <Panel className="video-panel">
                  <video
                    ref={video}
                    src={`/api/lessons/${lesson.id}/media`}
                    controls
                    preload="metadata"
                  />
                  <h3>本地课堂视频</h3>
                  <p>点击转写时间，可回到对应课堂片段。</p>
                  <div className="frame-grid">
                    {lesson.frames?.map((f) => (
                      <a
                        href={`/api/lessons/${lesson.id}/frames/${f}`}
                        target="_blank"
                        rel="noreferrer"
                        key={f}
                      >
                        <img
                          loading="lazy"
                          src={`/api/lessons/${lesson.id}/frames/${f}`}
                          alt={`课堂抽帧 ${f}`}
                        />
                      </a>
                    ))}
                  </div>
                </Panel>
              )}
              <Panel>
                <div className="section-heading">
                  <h2>
                    转写原文{" "}
                    <span className="count-pill">{a.segments.length}</span>
                  </h2>
                  <div className="search-field">
                    <MagnifyingGlass />
                    <input
                      aria-label="搜索转写"
                      placeholder="搜索课堂内容"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="transcript-list">
                  {a.segments
                    .filter((s) => s.text.includes(query))
                    .map((s) => (
                      <article id={"segment-" + s.id} key={s.id}>
                        <button
                          className="timestamp"
                          onClick={() => {
                            if (video.current) {
                              video.current.currentTime = s.start;
                              video.current.play().catch(() => {});
                            } else
                              notify(
                                s.timing === "estimated"
                                  ? "此时间为纯文本估算，未关联视频"
                                  : "此课堂未关联视频",
                              );
                          }}
                        >
                          <Play size={10} weight="fill" />
                          {time(s.start)}
                        </button>
                        <div>
                          <div className="segment-meta">
                            <span>
                              #{s.id} ·{" "}
                              {s.speaker === "teacher"
                                ? "教师"
                                : s.speaker === "student"
                                  ? "学生"
                                  : "未标注说话人"}
                            </span>
                            <Badge tone="light">{s.stage}</Badge>
                            {s.question && (
                              <span className="question-tag">提问</span>
                            )}
                          </div>
                          <p>{s.text}</p>
                          {s.timing === "estimated" && (
                            <small className="subtle">时间为估算</small>
                          )}
                        </div>
                      </article>
                    ))}
                </div>
              </Panel>
            </div>
          )}
          {tab === "suggestions" && (
            <div className="suggestions-list">
              {a.suggestions.map((s, i) => (
                <Panel key={s.title}>
                  <div className="suggestion-number">0{i + 1}</div>
                  <div>
                    <Badge tone={i === 0 ? "amber" : "green"}>
                      {s.priority}
                    </Badge>
                    <h2>{s.title}</h2>
                    <div className="evidence-box">
                      <span>课堂证据</span>
                      <p>{s.evidence}</p>
                      <button
                        className="text-btn"
                        onClick={() => evidence(s.segment_id)}
                      >
                        查看片段 #{s.segment_id}
                        <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <h4>下一堂课，可以这样做</h4>
                    <p>{s.action}</p>
                  </div>
                </Panel>
              ))}
            </div>
          )}
          {tab === "chat" && (
            <Panel>
              <ChatPanel lesson={lesson} demo={demo} notify={notify} />
            </Panel>
          )}
        </>
      )}
      {confirmDelete && (
        <Modal title="删除这堂课？" onClose={() => setConfirmDelete(false)}>
          <p className="modal-description">
            将删除「{lesson.title}
            」的视频、转写、分析与对话。此操作无法撤销，请先下载需要保留的报告。
          </p>
          <div className="modal-actions">
            <button
              className="btn secondary"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              保留课堂
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/lessons/${lesson.id}`, { method: "DELETE" });
                  onClose();
                  onRefresh();
                  notify("课堂已删除");
                } catch (e) {
                  notify(err(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function Settings({
  user,
  demo,
  notify,
  onLogout,
}: {
  user: User;
  demo: boolean;
  notify: (s: string) => void;
  onLogout: () => void;
}) {
  const [system, setSystem] = useState<System | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!demo)
      api<System>("/system")
        .then(setSystem)
        .catch((e) => notify(err(e)));
  }, [demo]);
  async function password(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (demo) {
      notify("请登录后修改密码");
      return;
    }
    setBusy(true);
    try {
      await post(
        "/auth/password",
        Object.fromEntries(new FormData(e.currentTarget)),
      );
      notify("密码已更新，请重新登录");
      onLogout();
    } catch (e) {
      notify(err(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PRIVATE BY DESIGN</span>
          <h1>我的空间与本地环境</h1>
          <p>了解数据在哪里，以及课堂如何被处理。</p>
        </div>
      </div>
      <div className="settings-grid">
        <Panel>
          <div className="section-heading">
            <h2>
              <ShieldCheck /> 本地运行状态
            </h2>
            <Badge>数据不出校</Badge>
          </div>
          {demo ? (
            <div className="notice">
              当前为示例模式。登录后显示服务器的真实模型与存储状态。
            </div>
          ) : system ? (
            <div className="system-rows">
              {[
                [
                  "Whisper 本地模型",
                  system.asr_ready ? "已就绪" : "待安装模型",
                ],
                [
                  "媒体工具",
                  system.ffmpeg_ready
                    ? "FFmpeg + " + system.probe_backend + " 已就绪"
                    : "FFmpeg 待安装",
                ],
                ["计算设备", system.asr_device.toUpperCase()],
                ["视频大小上限", `${system.max_upload_mb} MB`],
                ["可用磁盘", `${system.disk_free_gb} GB`],
                ["本机对话模型", system.chat_model],
              ].map(([k, v]) => (
                <div key={k}>
                  <span>{k}</span>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p>正在读取环境状态…</p>
          )}
          <div className="privacy-note">
            <LockKey size={22} />
            <p>
              <strong>本地模型不会自动下载</strong>
              <span>
                由管理员提前准备模型。Ollama 不可用时，助手明确使用规则建议。
              </span>
            </p>
          </div>
        </Panel>
        <Panel>
          <h2>账号与密码</h2>
          <p className="subtle">
            {user.name} · {user.username} ·{" "}
            {user.role === "admin" ? "管理员" : "教师"}
          </p>
          <form className="password-form" onSubmit={password}>
            <label>
              原密码
              <input
                name="old_password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <label>
              新密码
              <input
                name="new_password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                placeholder="至少 10 位字符"
              />
            </label>
            <button className="btn primary" disabled={busy}>
              更新密码
            </button>
          </form>
        </Panel>
      </div>
      <Panel className="method-panel">
        <h3>一期能力范围</h3>
        <p>
          本地视频抽帧、语音转写、文本清洗、教学环节识别、教学画像、证据建议与本地追问。每位教师拥有独立数据空间。
        </p>
        <p>
          动作识别、板书识别、声纹分离与多模态教学评价属于扩展功能。当前画像不输出缺乏依据的教师评分或师生发言比例。
        </p>
      </Panel>
    </>
  );
}

function Admin({ notify }: { notify: (s: string) => void }) {
  const [users, setUsers] = useState<(User & { lessons: number })[]>([]),
    [logs, setLogs] = useState<
      {
        id: number;
        action: string;
        actor_name: string;
        target: string;
        created: number;
      }[]
    >([]),
    [create, setCreate] = useState(false),
    [busy, setBusy] = useState(false);
  function refresh() {
    Promise.all([
      api<typeof users>("/admin/users"),
      api<typeof logs>("/admin/audit"),
    ])
      .then(([u, a]) => {
        setUsers(u);
        setLogs(a);
      })
      .catch((e) => notify(err(e)));
  }
  useEffect(refresh, []);
  const actions: Record<string, string> = {
    login: "账号登录",
    create_user: "创建账号",
    upload: "上传课堂",
    import_text: "导入文本",
    import_example: "添加示例",
    backup_user: "导出账号备份",
    export_report: "下载报告",
    delete_lesson: "删除课堂",
    password_changed: "修改密码",
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SCHOOL ADMINISTRATION</span>
          <h1>学校数据管理</h1>
          <p>统一管理教师账号，按账号导出学校教学资产。</p>
        </div>
        <button className="btn primary" onClick={() => setCreate(true)}>
          <Plus />
          新建教师账号
        </button>
      </div>
      <Panel>
        <div className="section-heading">
          <h2>
            教师账号 <span className="count-pill">{users.length}</span>
          </h2>
          <Badge>
            <ShieldCheck size={14} />
            账号数据隔离
          </Badge>
        </div>
        <div className="lesson-table-wrap">
          <table className="lesson-table">
            <thead>
              <tr>
                <th>姓名 / 账号</th>
                <th>角色</th>
                <th>课堂数</th>
                <th>数据管理</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <small className="block subtle">{u.username}</small>
                  </td>
                  <td>{u.role === "admin" ? "管理员" : "教师"}</td>
                  <td>{u.lessons}</td>
                  <td>
                    <button
                      className="btn secondary small"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await download(
                            `/admin/users/${u.id}/backup`,
                            "backup.zip",
                          );
                          notify("账号备份已下载");
                          refresh();
                        } catch (e) {
                          notify(err(e));
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <DownloadSimple />
                      导出备份
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="audit-panel">
        <div className="section-heading">
          <h2>最近操作记录</h2>
          <span className="subtle">最近 200 条</span>
        </div>
        <div className="audit-list">
          {logs.map((l) => (
            <div key={l.id}>
              <span className="audit-icon">
                <Check size={14} />
              </span>
              <strong>{l.actor_name || "本地管理员"}</strong>
              <span>{actions[l.action] || l.action}</span>
              <time>{new Date(l.created * 1000).toLocaleString("zh-CN")}</time>
            </div>
          ))}
        </div>
      </Panel>
      {create && (
        <Modal title="新建教师账号" onClose={() => setCreate(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await post("/admin/users", {
                  ...Object.fromEntries(new FormData(e.currentTarget)),
                  role: "teacher",
                });
                setCreate(false);
                refresh();
                notify("教师账号已创建");
              } catch (e) {
                notify(err(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              教师姓名
              <input
                name="name"
                required
                maxLength={64}
                placeholder="例如：陈老师"
              />
            </label>
            <label>
              登录账号
              <input
                name="username"
                required
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9_.\-]+"
                placeholder="字母、数字或 _.-"
                autoComplete="off"
              />
            </label>
            <label>
              初始密码
              <input
                name="password"
                required
                minLength={10}
                maxLength={128}
                type="password"
                autoComplete="new-password"
                placeholder="至少 10 位字符"
              />
            </label>
            <div className="modal-actions">
              <button className="btn primary" disabled={busy}>
                创建账号
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true),
    [demo, setDemo] = useState(false),
    [page, setPage] = useState<Page>("overview"),
    [lessons, setLessons] = useState<Lesson[]>([]),
    [selected, setSelected] = useState<Lesson | null>(null),
    [detailTab, setDetailTab] = useState("overview"),
    [uploadOpen, setUploadOpen] = useState(false),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [toast, setToast] = useState(""),
    [sidebar, setSidebar] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function notify(message: string) {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(""), 5000);
  }
  function logout() {
    setUser(null);
    setDemo(false);
    setSelected(null);
    setLessons([]);
    setCsrf("");
    setPage("overview");
  }
  useEffect(() => {
    api<{ user: User; csrf: string }>("/auth/me")
      .then((r) => {
        setCsrf(r.csrf);
        setUser(r.user);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    const expire = () => {
      setUser(null);
      setSelected(null);
      setLessons([]);
      setCsrf("");
    };
    window.addEventListener("session-expired", expire);
    return () => {
      window.removeEventListener("session-expired", expire);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  async function refresh() {
    if (demo || !user) return;
    try {
      const list = await api<Lesson[]>("/lessons");
      const complete = list.find((l) => l.status === "completed");
      if (complete) {
        const d = await api<Lesson>(`/lessons/${complete.id}`);
        list[list.findIndex((l) => l.id === d.id)] = d;
      }
      setLessons(list);
      if (selected) {
        const d = await api<Lesson>(`/lessons/${selected.id}`).catch(
          () => null,
        );
        setSelected(d);
      }
    } catch (e) {
      notify(err(e));
    }
  }
  useEffect(() => {
    if (user && !demo) refresh();
  }, [user, demo]);
  useEffect(() => {
    if (
      !user ||
      demo ||
      !lessons.some((l) =>
        ["processing", "queued", "uploading"].includes(l.status),
      )
    )
      return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
  }, [lessons, user, demo, selected?.id]);
  function enterDemo() {
    setDemo(true);
    setUser({ id: "demo", username: "demo", name: "林老师", role: "teacher" });
    setLessons([DEMO]);
    setPage("overview");
  }
  function navigate(p: Page) {
    setPage(p);
    setSelected(null);
    setSearch("");
    setSidebar(false);
    setFilter("all");
  }
  async function select(l: Lesson, tab = "overview") {
    setDetailTab(tab);
    try {
      setSelected(demo ? l : await api<Lesson>(`/lessons/${l.id}`));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      notify(err(e));
    }
  }
  async function addExample() {
    try {
      const l = await post<Lesson>("/lessons/example");
      await refresh();
      select(l);
      notify("已添加合成示例课堂");
    } catch (e) {
      notify(err(e));
    }
  }
  const filtered = lessons.filter(
    (l) =>
      (l.title + l.subject + l.class_name).includes(search) &&
      (filter === "all" || l.status === filter),
  );
  const available = filtered.filter((l) => l.status === "completed");
  if (checking)
    return (
      <div className="boot">
        <Brand />
        <CircleNotch className="spin" size={28} />
        <p>正在连接本地工作台</p>
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          onLogin={(u) => {
            setDemo(false);
            setUser(u);
          }}
          onDemo={enterDemo}
        />
        {toast && (
          <div role="status" className="toast">
            {toast}
          </div>
        )}
      </>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <Brand />
        <div className="workspace-label">
          <span className="school-avatar">
            <GraduationCap size={20} />
          </span>
          <div>
            教师教研空间
            <small>{demo ? "产品体验 · 合成示例" : "学校私有工作台"}</small>
          </div>
          <LockKey size={13} />
        </div>
        <span className="nav-group-label">工作空间</span>
        <nav>
          {NAV.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => navigate(n.id)}
            >
              <n.icon
                size={21}
                weight={page === n.id ? "duotone" : "regular"}
              />
              <span>{n.label}</span>
              {n.id === "chat" ? (
                <span className="ai-tag">AI</span>
              ) : page === n.id ? (
                <span className="nav-active-dot" />
              ) : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <ShieldCheck size={26} weight="duotone" />
            </span>
            <strong>安心教研，本地守护</strong>
            <p>
              你的课堂数据
              <br />
              只留在学校的服务器
            </p>
            <span className="local-status">
              <span />
              私有化部署
            </span>
          </div>
          <button
            className={"settings-link " + (page === "settings" ? "active" : "")}
            onClick={() => navigate("settings")}
          >
            <GearSix size={20} />
            空间设置
          </button>
          {user.role === "admin" && (
            <button
              className={"settings-link " + (page === "admin" ? "active" : "")}
              onClick={() => navigate("admin")}
            >
              <Users size={20} />
              学校管理
            </button>
          )}
          <div className="user-block">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <strong>{user.name}</strong>
              <small>
                {demo
                  ? "示例体验账号"
                  : user.role === "admin"
                    ? "学校管理员"
                    : "教师账号"}
              </small>
            </div>
            <button
              className="icon-btn"
              aria-label="退出登录"
              onClick={async () => {
                try {
                  if (!demo) await post("/auth/logout");
                  logout();
                } catch (e) {
                  notify(err(e));
                }
              }}
            >
              <SignOut size={20} />
            </button>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          aria-label="关闭导航"
          className="sidebar-backdrop"
          onClick={() => setSidebar(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-btn mobile-menu"
              aria-label="打开导航"
              onClick={() => setSidebar(true)}
            >
              <List size={23} />
            </button>
            <span>工作空间</span>
            <span>/</span>
            <strong>
              {page === "settings"
                ? "空间设置"
                : page === "admin"
                  ? "学校管理"
                  : NAV.find((n) => n.id === page)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <div className="top-search">
              <MagnifyingGlass size={17} />
              <input
                aria-label="搜索课堂"
                placeholder="搜索我的课堂…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                  setPage("lessons");
                }}
              />
              <span>搜索</span>
            </div>
            <span className="local-indicator">
              <span /> 本地工作模式
            </span>
            <button
              className="icon-btn help-button"
              aria-label="查看帮助与环境"
              onClick={() => navigate("settings")}
            >
              <Question size={21} />
            </button>
            <span className="avatar small">{user.name.slice(0, 1)}</span>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <Sparkle size={15} />
            <span>正在体验合成课堂示例 · 数据与建议仅用于展示</span>
            <button onClick={logout}>
              登录真实工作台
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <main className="workspace-main" id="main-content">
          {selected ? (
            <LessonDetail
              key={selected.id}
              lesson={selected}
              demo={demo}
              onClose={() => setSelected(null)}
              onRefresh={refresh}
              notify={notify}
              startTab={detailTab}
            />
          ) : page === "overview" ? (
            <Overview
              user={user}
              lessons={lessons}
              demo={demo}
              onUpload={() => setUploadOpen(true)}
              onSelect={select}
              onPage={navigate}
              onExample={addExample}
            />
          ) : page === "settings" ? (
            <Settings
              user={user}
              demo={demo}
              notify={notify}
              onLogout={logout}
            />
          ) : page === "admin" && user.role === "admin" ? (
            <Admin notify={notify} />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {page === "lessons"
                      ? "YOUR CLASSROOM LIBRARY"
                      : page === "analysis"
                        ? "FROM EVIDENCE TO INSIGHT"
                        : page === "reports"
                          ? "REFLECTIONS WORTH KEEPING"
                          : "A CONVERSATION FOR BETTER TEACHING"}
                  </span>
                  <h1>{NAV.find((n) => n.id === page)?.label}</h1>
                  <p>
                    {page === "lessons"
                      ? "收藏每一次认真教学，回看每一个成长瞬间。"
                      : page === "analysis"
                        ? "以课堂原文为依据，把教学经验变成可行动的发现。"
                        : page === "reports"
                          ? "下载授课方式画像与优化建议，沉淀校本教研资产。"
                          : "选择一堂已分析的课堂，开启有依据的教研对话。"}
                  </p>
                </div>
                <button
                  className="btn primary"
                  onClick={() => setUploadOpen(true)}
                >
                  <Plus size={19} />
                  上传新课堂
                </button>
              </div>
              {page === "lessons" ? (
                <Panel>
                  <div className="section-heading">
                    <div className="filter-tabs">
                      {[
                        ["all", "全部课堂"],
                        ["completed", "分析完成"],
                        ["processing", "分析中"],
                        ["failed", "需处理"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={filter === value ? "active" : ""}
                          onClick={() => setFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="subtle">共 {filtered.length} 节</span>
                  </div>
                  {filtered.length ? (
                    <LessonTable lessons={filtered} onSelect={select} />
                  ) : (
                    <Empty
                      title={search ? "没有找到匹配课堂" : "这里等待着你的课堂"}
                      description="上传视频或转写文本，开始第一次教学分析。"
                      action={
                        <button
                          className="btn secondary"
                          onClick={() => setUploadOpen(true)}
                        >
                          <Plus />
                          添加课堂
                        </button>
                      }
                    />
                  )}
                </Panel>
              ) : available.length ? (
                <div className="report-grid">
                  {available.map((l) => (
                    <Panel key={l.id}>
                      <div className="report-card-top">
                        <span className="report-icon">
                          {page === "chat" ? (
                            <ChatsCircle size={29} weight="duotone" />
                          ) : (
                            <FileText size={29} weight="duotone" />
                          )}
                        </span>
                        <Badge tone={l.example ? "amber" : "green"}>
                          {l.example ? "合成示例" : "已完成"}
                        </Badge>
                      </div>
                      <span className="subtle">
                        {l.subject} · {l.class_name}
                      </span>
                      <h2>{l.title}</h2>
                      <p>
                        {l.metrics?.segments || 0} 个话语片段 ·{" "}
                        {l.metrics?.questions || 0} 处提问线索
                      </p>
                      <div className="report-card-bottom">
                        <span>
                          {date(l.created)} · {time(l.duration)}
                        </span>
                        <button
                          className="text-btn"
                          onClick={() =>
                            select(l, page === "chat" ? "chat" : "overview")
                          }
                        >
                          {page === "chat"
                            ? "开始对话"
                            : page === "reports"
                              ? "查看与下载"
                              : "查看教学画像"}
                          <ArrowUpRight size={17} />
                        </button>
                      </div>
                    </Panel>
                  ))}
                </div>
              ) : (
                <Panel>
                  <Empty
                    title="还没有可用的分析"
                    description="课堂处理完成后，报告、教学画像与追问将出现在这里。"
                    action={
                      <button
                        className="btn secondary"
                        onClick={() => setUploadOpen(true)}
                      >
                        添加第一堂课
                      </button>
                    }
                  />
                </Panel>
              )}
            </>
          )}
        </main>
      </div>
      {uploadOpen && (
        <UploadModal
          demo={demo}
          onClose={() => setUploadOpen(false)}
          onDone={(l) => {
            setUploadOpen(false);
            refresh();
            select(l);
            notify("课堂已保存到本地空间");
          }}
          notify={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={20} />
          {toast}
          <button onClick={() => setToast("")} aria-label="关闭提示">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
