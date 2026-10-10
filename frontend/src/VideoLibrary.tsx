import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  DownloadSimple,
  VideoCamera,
  UploadSimple,
  Play,
  Trash,
  X,
} from "@phosphor-icons/react";
import { api, upload } from "./api";
import type { User } from "./types";

interface Resource {
  id: string;
  user_id: string;
  owner_name: string;
  title: string;
  subject: string;
  description: string;
  filename: string;
  duration: number;
  size: number;
  created: number;
}
const examples: Resource[] = [
  {
    id: "demo-math",
    user_id: "example",
    owner_name: "示例教师",
    title: "让学生说出解题思路",
    subject: "数学",
    description:
      "合成资源卡片：观察问题设计、等待时间和学生解释的机会，不包含真实视频。",
    filename: "示例.mp4",
    duration: 720,
    size: 83886080,
    created: 1790553600,
  },
  {
    id: "demo-chinese",
    user_id: "example",
    owner_name: "示例教师",
    title: "从阅读走向课堂讨论",
    subject: "语文",
    description:
      "合成资源卡片：用讨论任务连接文本证据与学生观点，不包含真实视频。",
    filename: "示例.mp4",
    duration: 960,
    size: 104857600,
    created: 1790553600,
  },
];
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "操作失败，请重试";
const duration = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;

export default function VideoLibrary({
  user,
  demo,
  notify,
}: {
  user: User;
  demo: boolean;
  notify: (message: string) => void;
}) {
  const [items, setItems] = useState<Resource[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<Resource | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setItems([]);
    const timer = setTimeout(async () => {
      try {
        const data = demo
          ? {
              items: examples.filter(
                (item) =>
                  !mine &&
                  `${item.title} ${item.subject} ${item.owner_name}`.includes(
                    query.trim(),
                  ),
              ),
              total: 0,
            }
          : await api<{ items: Resource[]; total: number }>(
              `/library?q=${encodeURIComponent(query)}&mine=${mine}&offset=${offset}`,
            );
        if (active) {
          setItems(data.items);
          setTotal(demo ? data.items.length : data.total);
          if (!demo && data.total > 0 && offset >= data.total)
            setOffset(Math.floor((data.total - 1) / 12) * 12);
        }
      } catch (e) {
        if (active) setError(errorText(e));
      } finally {
        if (active) setLoading(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, mine, offset, refresh, demo]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo) return;
    setError("");
    setBusy(true);
    setProgress(0);
    try {
      await upload(
        new FormData(event.currentTarget),
        setProgress,
        "/library/upload",
      );
      setShowUpload(false);
      setQuery("");
      setMine(false);
      setOffset(0);
      setRefresh((n) => n + 1);
      notify("视频已共享，本校已登录教师可以浏览和下载");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Resource) {
    setBusy(true);
    setError("");
    try {
      await api(`/library/${item.id}`, { method: "DELETE" });
      if (preview?.id === item.id) setPreview(null);
      setDeleteId(null);
      setRefresh((n) => n + 1);
      notify("共享视频已删除；已经下载的副本不会被撤回");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="video-library">
      <div className="page-heading">
        <div>
          <span className="eyebrow">LEARN FROM EACH OTHER</span>
          <h1>共享视频库</h1>
          <p>把值得借鉴的教学片段，留给下一位老师。</p>
        </div>
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => {
            if (demo) notify("示例仅展示资源库，请登录学校工作台上传视频");
            else setShowUpload(!showUpload);
          }}
        >
          <UploadSimple />
          {showUpload ? "收起上传" : "上传共享视频"}
        </button>
      </div>
      <div className="notice">
        这里的视频供本校已登录教师浏览和下载。私人课堂不会自动公开；共享上传不触发转写、AI
        分析或音频外发。{demo && " 当前仅展示合成资源卡片，不包含可下载视频。"}
      </div>
      {showUpload && !demo && (
        <section className="panel library-upload" aria-label="上传共享视频">
          <h2>分享一段值得借鉴的课堂</h2>
          <form onSubmit={submit}>
            <fieldset disabled={busy}>
              <div className="library-form-grid">
                <label>
                  视频名称
                  <input
                    name="title"
                    required
                    maxLength={120}
                    placeholder="例如：三角形内角和 · 小组探究片段"
                  />
                </label>
                <label>
                  学科
                  <input
                    name="subject"
                    required
                    maxLength={40}
                    placeholder="例如：数学"
                  />
                </label>
              </div>
              <label>
                借鉴要点
                <textarea
                  name="description"
                  rows={3}
                  maxLength={2000}
                  placeholder="这段视频值得关注什么？适合哪些教学情境？"
                />
              </label>
              <label>
                选择共享视频
                <input
                  name="file"
                  type="file"
                  required
                  accept=".mp4,.mov,.mkv,.avi,.webm,.m4v"
                />
              </label>
              <p className="subtle">
                支持 MP4、MOV、MKV、AVI、WebM、M4V，最长 6
                小时；大小上限使用学校服务器配置（默认 2 GB）。建议使用 H.264 /
                AAC 编码的 MP4，便于浏览器预览。
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="allow_school_share"
                  value="true"
                  required
                />
                <span>
                  我确认有权共享此视频，同意本校所有已登录教师浏览和下载。
                </span>
              </label>
            </fieldset>
            {busy && (
              <div className="upload-progress">
                <progress max={100} value={progress} />
                <span>
                  {progress < 100
                    ? `上传 ${progress}%`
                    : "上传完成，正在验证视频…"}
                </span>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => setShowUpload(false)}
              >
                取消上传
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? "正在保存…" : "确认共享上传"}
              </button>
            </div>
          </form>
        </section>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
          <button className="text-btn" onClick={() => setRefresh((n) => n + 1)}>
            刷新列表
          </button>
        </p>
      )}
      {preview && (
        <section className="panel library-preview" aria-label="视频预览">
          <div className="section-heading">
            <h2>{preview.title}</h2>
            <button
              className="icon-btn"
              aria-label="关闭视频预览"
              onClick={() => setPreview(null)}
            >
              <X />
            </button>
          </div>
          <video
            key={preview.id}
            src={`/api/library/${preview.id}/media`}
            controls
            preload="metadata"
            onError={() =>
              notify(
                "此视频编码可能不受浏览器支持，或资源已删除。可尝试下载后播放。",
              )
            }
          >
            浏览器不支持视频播放。
          </video>
          <p>{preview.description || "上传者暂未填写借鉴要点。"}</p>
          <a
            className="btn secondary"
            href={`/api/library/${preview.id}/media?download=true`}
          >
            <DownloadSimple />
            下载此视频
          </a>
        </section>
      )}
      <div className="library-toolbar">
        <label className="library-search">
          搜索共享视频
          <input
            type="search"
            value={query}
            maxLength={120}
            placeholder="视频名称、学科或上传教师"
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setOffset(0);
            }}
          />
          <span>只看我上传的</span>
        </label>
        <span className="subtle">
          {loading ? "正在读取…" : `共 ${total} 个视频`}
        </span>
      </div>
      <div className="library-grid" aria-busy={loading}>
        {items.map((item) => (
          <article className="panel library-card" key={item.id}>
            <div className="library-cover">
              <VideoCamera size={45} weight="duotone" />
              <span>{item.subject}</span>
              <small>{duration(item.duration)}</small>
            </div>
            <div className="library-card-body">
              <h2>{item.title}</h2>
              <p>{item.description || "暂无借鉴要点"}</p>
              <div className="library-meta">
                <span>{item.owner_name}</span>
                <span>{(item.size / 1024 / 1024).toFixed(1)} MB</span>
                <time>
                  {new Date(item.created * 1000).toLocaleDateString("zh-CN")}
                </time>
              </div>
              <div className="button-row">
                <button
                  className="btn secondary"
                  onClick={() =>
                    demo
                      ? notify("合成资源卡片不包含真实视频")
                      : setPreview(item)
                  }
                >
                  <Play />
                  预览
                </button>
                {demo ? (
                  <button
                    className="btn primary"
                    onClick={() => notify("请在学校工作台下载真实共享视频")}
                  >
                    <DownloadSimple />
                    下载视频
                  </button>
                ) : (
                  <a
                    className="btn primary"
                    href={`/api/library/${item.id}/media?download=true`}
                  >
                    <DownloadSimple />
                    下载视频
                  </a>
                )}
                {!demo &&
                  (item.user_id === user.id || user.role === "admin") && (
                    <button
                      className="icon-btn"
                      aria-label={`删除共享视频：${item.title}`}
                      disabled={busy}
                      onClick={() => setDeleteId(item.id)}
                    >
                      <Trash />
                    </button>
                  )}
              </div>
              {deleteId === item.id && (
                <div className="notice">
                  <p>
                    删除后其他教师将无法继续访问此共享视频。已下载副本不受影响。
                  </p>
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => setDeleteId(null)}
                  >
                    保留视频
                  </button>{" "}
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => remove(item)}
                  >
                    确认删除共享视频
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {!loading && !error && !items.length && (
        <div className="panel library-empty">
          <VideoCamera size={40} />
          <h2>{query || mine ? "没有找到匹配的视频" : "共享视频库还是空的"}</h2>
          <p>
            {query || mine
              ? "试试其他关键词，或取消“只看我上传的”。"
              : "上传一段课堂视频，让同校老师可以预览和下载。"}
          </p>
        </div>
      )}
      {total > 12 && (
        <nav className="library-pagination" aria-label="视频库分页">
          <button
            className="btn secondary"
            disabled={offset === 0 || loading}
            onClick={() => setOffset(Math.max(0, offset - 12))}
          >
            上一页
          </button>
          <span>
            第 {Math.floor(offset / 12) + 1} / {Math.ceil(total / 12)} 页
          </span>
          <button
            className="btn secondary"
            disabled={offset + 12 >= total || loading}
            onClick={() => setOffset(offset + 12)}
          >
            下一页
          </button>
        </nav>
      )}
    </div>
  );
}
