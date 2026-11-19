import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Sparkle,
  FilmStrip,
  DownloadSimple,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { api, post } from "./api";

type Video = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  ratio: string;
  duration: number;
  status: string;
  remote_id: string | null;
  error: string;
  size: number;
  created: number;
};
type Settings = {
  model: string;
  api_key_configured: boolean;
  endpoint: string;
};
const statuses: Record<string, string> = {
  submitting: "正在提交",
  queued: "云端排队",
  running: "正在生成",
  downloading: "保存成片",
  succeeded: "已完成",
  failed: "生成失败",
  download_failed: "下载失败",
  unknown: "需核对提交结果",
  attention: "查询已暂停",
};
const active = new Set(["submitting", "queued", "running", "downloading"]);
const templates = [
  {
    name: "科学 · 水循环",
    prompt:
      "面向小学科学课堂，制作一段水循环示意动画：阳光照射海面，水汽缓慢上升凝结成云，随后降雨回到山间河流。清晰的分层剖面，温和配色，固定镜头，准确展现自然过程，不添加文字。",
  },
  {
    name: "数学 · 几何直观",
    prompt:
      "面向初中数学课堂，以简洁的三维教具展示一个正方体缓慢展开为六个正方形的平面展开图。纯色背景、固定镜头、边线清晰，强调每个面之间的连接关系，不添加文字或人物。",
  },
  {
    name: "语文 · 诗意导入",
    prompt:
      "制作一段古诗课堂导入短片：初春清晨，柳枝随微风轻摆，燕子掠过江面，远处青山笼罩薄雾。水墨画风，镜头缓慢平移，画面安静清新，不添加文字。",
  },
];
const demoVideos: Video[] = [
  {
    id: "seedance-demo",
    title: "水循环 · 科学课堂导入",
    prompt: templates[0].prompt,
    model: "Seedance 示例",
    ratio: "16:9",
    duration: 5,
    status: "example",
    remote_id: null,
    error: "",
    size: 0,
    created: 1793721600,
  },
];
const message = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请稍后重试";

export default function SeedanceStudio({
  demo,
  notify,
}: {
  demo: boolean;
  notify: (text: string) => void;
}) {
  const [settings, setSettings] = useState<Settings>({
    model: "",
    api_key_configured: false,
    endpoint:
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
  });
  const [key, setKey] = useState("");
  const [storySubject, setStorySubject] = useState("历史");
  const [course, setCourse] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [consent, setConsent] = useState(false);
  const [items, setItems] = useState<Video[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Video | null>(null);
  const [editing, setEditing] = useState<Video | null>(null);
  const [removing, setRemoving] = useState<Video | null>(null);
  const requestId = useRef("");

  useEffect(() => {
    if (demo) return;
    let live = true;
    api<Settings>("/seedance/settings")
      .then((value) => {
        if (live) setSettings(value);
      })
      .catch((e) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [demo]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const load = async () => {
      try {
        const examples = demoVideos.filter((v) =>
          (v.title + v.prompt).includes(query.trim()),
        );
        const result = demo
          ? { items: examples, total: examples.length }
          : await api<{ items: Video[]; total: number }>(
              `/seedance/videos?q=${encodeURIComponent(query)}&offset=${offset}`,
            );
        if (live) {
          setItems(result.items);
          setTotal(result.total);
          setError("");
          setLoading(false);
        }
      } catch (e) {
        if (live) {
          setError(message(e));
          setLoading(false);
        }
      }
    };
    const debounce = window.setTimeout(load, 200);
    const timer = demo ? undefined : window.setInterval(load, 8000);
    return () => {
      live = false;
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [demo, query, offset, refresh]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<Settings>("/seedance/settings", {
        method: "PUT",
        body: JSON.stringify({
          model: settings.model,
          ...(key ? { api_key: key } : {}),
          clear_api_key: clearKey,
        }),
      });
      setSettings(result);
      setKey("");
      setClearKey(false);
      notify("Seedance 设置已保存，密钥不会回显。");
    } catch (e) {
      notify(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (demo) {
      notify("演示不提交生成任务，请在学校工作台配置 Seedance。");
      return;
    }
    setBusy(true);
    if (!requestId.current)
      requestId.current = crypto.randomUUID
        ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
            (
              Number(c) ^
              (crypto.getRandomValues(new Uint8Array(1))[0] &
                (15 >> (Number(c) / 4)))
            ).toString(16),
          );
    try {
      const result = await post<Video>("/seedance/videos", {
        request_id: requestId.current,
        title,
        prompt,
        ratio,
        duration,
        allow_external: consent,
      });
      requestId.current = "";
      setConsent(false);
      setOffset(0);
      setQuery("");
      setRefresh((n) => n + 1);
      notify(
        result.error || "任务已提交，可离开页面；服务器会继续查询并保存成片。",
      );
    } catch (e) {
      notify(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      await api(path, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setEditing(null);
      setRemoving(null);
      setPreview(null);
      setRefresh((n) => n + 1);
      notify("已更新视频。");
    } catch (e) {
      notify(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="seedance-studio">
      <header className="seedance-hero">
        <div>
          <span className="seedance-eyebrow">SEEDANCE / TEACHING STUDIO</span>
          <h1>让教学灵感，成为画面。</h1>
          <p>从一个知识点出发，创作课堂导入、概念演示与情境短片。</p>
          <span className="seedance-pill">
            <FilmStrip size={16} /> 文本生成视频 · 私人作品空间
          </span>
        </div>
        <div className="seedance-mark" aria-hidden="true">
          <Sparkle size={70} weight="duotone" />
          <span>灵感 → 分镜 → 成片</span>
        </div>
      </header>
      <div className="notice">
        使用老师自己的 Seedance API
        额度生成教学视频。只发送本页填写的描述，不自动发送课堂记录。文科生成故事片段；需要参数同步的理科演示请使用“理科动态模型”。
        {demo && " 当前为静态演示，不收集 API Key，不生成或下载真实视频。"}
      </div>
      <div className="seedance-layout">
        <section className="panel seedance-compose" aria-label="教学视频生成">
          <h2>描述你的教学画面</h2>
          <details className="story-builder">
            <summary>从历史 / 语文 / 政治课程编排故事</summary>
            <label>
              故事学科
              <select
                value={storySubject}
                onChange={(e) => setStorySubject(e.target.value)}
              >
                <option>历史</option>
                <option>语文</option>
                <option>政治</option>
              </select>
            </label>
            <label>
              课程内容与故事依据
              <textarea
                rows={4}
                value={course}
                onChange={(e) => setCourse(e.target.value)}
                maxLength={2500}
                placeholder="粘贴教材节选、史实或要解释的概念，不填写学生个人信息"
              />
            </label>
            <button
              type="button"
              className="btn secondary"
              disabled={course.trim().length < 5 || busy}
              onClick={() => {
                setTitle(`${storySubject}课堂故事`);
                setPrompt(
                  `制作一段${duration}秒的${storySubject}课堂故事片段。只依据下列课程材料，不补编史实、引文或人物言论。采用开场情境—关键行动—课堂提问的三拍结构，选择一个小情节，画面自然、人物连贯；文字旁白请留给教师后期审核。${storySubject === "政治" ? "用虚构日常情境解释教材概念，不针对现实人群开展说服。" : ""}\n课程依据：${course.trim()}\n镜头建议：前段建立场景，中段表现事件，末段停留在可讨论的画面。`,
                );
                notify("已编排故事提示词，请核对事实与画面后提交生成。");
              }}
            >
              编排故事提示词
            </button>
          </details>
          <p className="subtle">
            先选一个灵感，再写清知识点、画面内容与镜头变化。
          </p>
          <div className="seedance-templates">
            {templates.map((t) => (
              <button
                type="button"
                key={t.name}
                disabled={busy}
                onClick={() => {
                  setTitle(t.name);
                  setPrompt(t.prompt);
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
          <form onSubmit={generate}>
            <fieldset disabled={busy}>
              <label>
                作品名称
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="例如：水循环 · 科学课堂导入"
                />
              </label>
              <label>
                画面描述
                <textarea
                  rows={6}
                  aria-label="画面描述"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  required
                  minLength={10}
                  maxLength={4000}
                  placeholder="描述教学目标、场景、风格和镜头。请勿填写学生姓名等个人信息。"
                />
              </label>
              <div className="seedance-options">
                <label>
                  画面比例
                  <select
                    value={ratio}
                    onChange={(e) => setRatio(e.target.value)}
                  >
                    <option value="16:9">16:9 · 教室大屏</option>
                    <option value="9:16">9:16 · 竖屏</option>
                    <option value="1:1">1:1 · 方形</option>
                  </select>
                </label>
                <label>
                  视频时长
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                  >
                    <option value={5}>5 秒</option>
                    <option value={10}>10 秒</option>
                  </select>
                </label>
              </div>
              <p className="subtle">
                模型须支持所选参数；费用以方舟控制台为准。默认开启生成水印，成片使用前请核对教学内容的准确性。
              </p>
              {!demo && (
                <label className="seedance-consent">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    required
                  />
                  <span>
                    我同意将提示词发送至 Seedance，并确认本次生成可能产生费用。
                  </span>
                </label>
              )}
              <button
                className="btn primary"
                disabled={
                  busy ||
                  (!demo && (!settings.api_key_configured || !settings.model))
                }
              >
                <Sparkle size={18} />
                {busy ? "处理中…" : demo ? "体验生成入口" : "生成教学视频"}
              </button>
            </fieldset>
          </form>
        </section>
        <aside className="panel seedance-settings">
          <h2>连接 Seedance</h2>
          <p className="subtle">火山方舟 · 北京地域</p>
          {demo ? (
            <div className="seedance-demo-note">
              <FilmStrip size={32} />
              <h3>在学校工作台连接模型</h3>
              <p>
                使用自己的方舟 API Key 和已开通的 Seedance 模型
                ID。此演示不会接收密钥。
              </p>
            </div>
          ) : (
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <label>
                  Seedance 模型 ID
                  <input
                    value={settings.model}
                    onChange={(e) =>
                      setSettings({ ...settings, model: e.target.value })
                    }
                    maxLength={160}
                    pattern="[a-zA-Z0-9._-]*"
                    placeholder="模型 ID 或 ep- 开头的推理接入点"
                  />
                </label>
                <label>
                  Seedance API Key
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    disabled={clearKey}
                    placeholder={
                      settings.api_key_configured
                        ? "已配置，留空保留原密钥"
                        : "填写方舟 API Key"
                    }
                  />
                </label>
                <p className="subtle">
                  {settings.api_key_configured
                    ? "密钥已加密保存"
                    : "尚未配置密钥"}{" "}
                  · 每个账号独立设置
                </p>
                <label className="seedance-consent">
                  <input
                    type="checkbox"
                    checked={clearKey}
                    onChange={(e) => setClearKey(e.target.checked)}
                  />
                  <span>清除已保存的密钥（不影响已提交任务）</span>
                </label>
                <button className="btn secondary" disabled={busy}>
                  保存 Seedance 设置
                </button>
              </fieldset>
            </form>
          )}
          <p className="seedance-endpoint">
            官方接口
            <br />
            {settings.endpoint}
          </p>
          <a
            href="https://www.volcengine.com/docs/82379/1520757"
            target="_blank"
            rel="noreferrer"
          >
            查看方舟视频生成 API 文档 ↗
          </a>
        </aside>
      </div>
      <section className="seedance-collection" aria-label="我的生成视频">
        <div className="seedance-collection-head">
          <div>
            <h2>我的生成视频</h2>
            <p className="subtle">{total} 个作品 · 生成任务在后台持续处理</p>
          </div>
          <div className="seedance-search">
            <input
              aria-label="搜索生成视频"
              placeholder="搜索名称或画面描述"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOffset(0);
              }}
            />
            <button
              className="btn secondary"
              aria-label="刷新生成视频"
              onClick={() => setRefresh((n) => n + 1)}
            >
              <ArrowsClockwise size={18} />
            </button>
          </div>
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {preview && (
          <section className="panel library-preview" aria-label="生成视频预览">
            <h3>{preview.title}</h3>
            <video
              controls
              preload="metadata"
              src={`/api/seedance/videos/${preview.id}/media`}
            />
            <button className="btn secondary" onClick={() => setPreview(null)}>
              关闭预览
            </button>
          </section>
        )}
        {editing && (
          <form
            className="panel seedance-edit"
            onSubmit={(e) => {
              e.preventDefault();
              void action(`/seedance/videos/${editing.id}`, "PATCH", {
                title: editing.title,
              });
            }}
          >
            <label>
              新作品名称
              <input
                required
                maxLength={120}
                value={editing.title}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
              />
            </label>
            <button className="btn primary" disabled={busy}>
              保存名称
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setEditing(null)}
            >
              取消重命名
            </button>
          </form>
        )}
        {removing && (
          <div className="panel seedance-edit" role="alert">
            <p>
              删除“{removing.title}
              ”的本地成片与记录？此操作不会退款或删除供应商留存的任务。
            </p>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                action(`/seedance/videos/${removing.id}`, "DELETE")
              }
            >
              确认删除作品
            </button>
            <button className="btn secondary" onClick={() => setRemoving(null)}>
              保留作品
            </button>
          </div>
        )}
        {loading ? (
          <p role="status">正在加载作品…</p>
        ) : !items.length ? (
          <div className="panel library-empty">
            <FilmStrip size={36} />
            <h3>{query ? "没有匹配的作品" : "第一段教学短片，从这里开始"}</h3>
            <p>选择上方灵感模板，保存模型设置后即可生成。</p>
          </div>
        ) : (
          <div className="seedance-grid">
            {items.map((v) => (
              <article className="panel seedance-card" key={v.id}>
                <div className="seedance-card-top">
                  <FilmStrip size={32} />
                  <span
                    className={`seedance-state ${v.status === "succeeded" ? "done" : ""}`}
                  >
                    {statuses[v.status] || "合成示例 · 非真实成片"}
                  </span>
                </div>
                <div className="seedance-card-body">
                  <h3>{v.title}</h3>
                  <p className="seedance-prompt">{v.prompt}</p>
                  <div className="library-meta">
                    <span>
                      {v.duration} 秒 / {v.ratio}
                    </span>
                    <span>
                      {new Date(v.created * 1000).toLocaleDateString("zh-CN")}
                    </span>
                    {v.size > 0 && (
                      <span>{(v.size / 1024 / 1024).toFixed(1)} MB</span>
                    )}
                  </div>
                  <details>
                    <summary>生成信息</summary>
                    <p>模型：{v.model}</p>
                    <p>云端任务：{v.remote_id || "尚无任务编号"}</p>
                  </details>
                  {v.error && <p className="error-text">{v.error}</p>}
                  <div className="seedance-actions">
                    {v.status === "succeeded" && (
                      <>
                        <button
                          className="btn secondary"
                          onClick={() => setPreview(v)}
                        >
                          预览成片
                        </button>
                        <a
                          className="btn primary"
                          href={`/api/seedance/videos/${v.id}/media?download=true`}
                        >
                          <DownloadSimple size={16} />
                          下载视频
                        </a>
                      </>
                    )}
                    {["download_failed", "attention"].includes(v.status) && (
                      <button
                        className="btn secondary"
                        disabled={busy}
                        onClick={() =>
                          action(
                            `/seedance/videos/${v.id}/retry-download`,
                            "POST",
                          )
                        }
                      >
                        {v.status === "attention"
                          ? "重新查询原任务"
                          : "重试下载"}
                      </button>
                    )}
                    {demo ? (
                      <button
                        className="btn secondary"
                        onClick={() =>
                          notify(
                            "合成示例没有真实视频，请在学校工作台生成后下载。",
                          )
                        }
                      >
                        了解下载
                      </button>
                    ) : (
                      <>
                        <button
                          className="text-btn"
                          disabled={busy}
                          onClick={() => setEditing(v)}
                        >
                          重命名
                        </button>
                        <button
                          className="text-btn"
                          disabled={busy || active.has(v.status)}
                          onClick={() => setRemoving(v)}
                        >
                          删除作品
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
        {total > 12 && (
          <div className="library-pagination">
            <button
              className="btn secondary"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 12))}
            >
              上一页
            </button>
            <span>
              {Math.floor(offset / 12) + 1} / {Math.ceil(total / 12)}
            </span>
            <button
              className="btn secondary"
              disabled={offset + 12 >= total}
              onClick={() => setOffset(offset + 12)}
            >
              下一页
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
