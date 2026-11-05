import { useEffect, useState } from "react";
import { api, post } from "./api";
type Item = {
  id: string;
  title: string;
  status: string;
  size: number;
  error: string;
};
export default function VideoDownloads({
  demo,
  notify,
}: {
  demo: boolean;
  notify: (s: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [remove, setRemove] = useState("");
  useEffect(() => {
    if (demo) return;
    let live = true;
    const load = () =>
      api<Item[]>("/video-downloads")
        .then((v) => {
          if (live) {
            setItems(v);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [demo, refresh]);
  return (
    <div className="seedance-studio">
      <header className="seedance-hero">
        <div>
          <span className="seedance-eyebrow">VIDEO / DOWNLOADS</span>
          <h1>输入网址，收藏教学视频。</h1>
          <p>下载到自己的空间，随时预览与取回原文件。</p>
        </div>
      </header>
      <div className="notice">
        支持公开 MP4 / WebM 直链，也可识别页面直接提供的 video / source
        视频地址。需要登录、网盘提取码、动态播放器或 DRM
        的网址暂不支持；不会绕过访问限制。每个视频上限 1 GiB。
        {demo && " 当前仅演示表单，不抓取任何网址。"}
      </div>
      <section className="panel seedance-compose">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (demo) {
              notify("演示不下载真实视频，请在学校工作台使用网址下载。");
              return;
            }
            setBusy(true);
            try {
              await post("/video-downloads", {
                title,
                url,
                allow_download: consent,
              });
              setUrl("");
              setConsent(false);
              setRefresh((n) => n + 1);
              notify("已加入下载队列，完成后可点击下载到电脑。");
            } catch (e) {
              notify(e instanceof Error ? e.message : "提交失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          <fieldset disabled={busy}>
            <label>
              视频名称
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                maxLength={120}
              />
            </label>
            <label>
              视频网址
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                maxLength={4096}
                placeholder="https://学校资源网站/课程.mp4"
              />
            </label>
            <label className="seedance-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              <span>我确认有权下载和使用该视频。</span>
            </label>
            <button className="btn primary">添加网址下载</button>
          </fieldset>
        </form>
      </section>
      <section className="seedance-collection">
        <h2>我的网址下载</h2>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <section className="library-preview">
            <video
              controls
              src={`/api/video-downloads/${preview}/media?download=false`}
            />
            <button className="btn secondary" onClick={() => setPreview("")}>
              关闭预览
            </button>
          </section>
        )}
        {!items.length && (
          <div className="panel library-empty">
            暂无下载记录。成功后的视频仅本人可见。
          </div>
        )}
        <div className="seedance-grid">
          {items.map((v) => (
            <article className="panel seedance-card" key={v.id}>
              <div className="seedance-card-body">
                <h3>{v.title}</h3>
                <p>
                  {
                    {
                      queued: "等待下载",
                      downloading: "正在下载",
                      completed: "可下载",
                      failed: "下载失败",
                    }[v.status]
                  }{" "}
                  · {(v.size / 1024 / 1024).toFixed(1)} MB
                </p>
                {v.error && <p className="error-text">{v.error}</p>}
                <div className="seedance-actions">
                  {v.status === "completed" && (
                    <>
                      <a
                        className="btn primary"
                        href={`/api/video-downloads/${v.id}/media`}
                      >
                        下载到电脑
                      </a>
                      <button
                        className="btn secondary"
                        onClick={() => setPreview(v.id)}
                      >
                        预览
                      </button>
                    </>
                  )}
                  {!["queued", "downloading"].includes(v.status) && (
                    <button
                      className="text-btn"
                      onClick={() => setRemove(v.id)}
                    >
                      删除记录
                    </button>
                  )}
                </div>
                {remove === v.id && (
                  <div role="alert">
                    <p>确认删除本地文件和记录？</p>
                    <button
                      className="btn danger"
                      onClick={async () => {
                        try {
                          await api(`/video-downloads/${v.id}`, {
                            method: "DELETE",
                          });
                          setRemove("");
                          setPreview("");
                          setRefresh((n) => n + 1);
                        } catch (e) {
                          notify(e instanceof Error ? e.message : "删除失败");
                        }
                      }}
                    >
                      确认删除下载
                    </button>
                    <button className="text-btn" onClick={() => setRemove("")}>
                      保留
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
