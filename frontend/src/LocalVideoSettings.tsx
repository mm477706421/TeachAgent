import { useEffect, useState } from "react";
import { api } from "./api";

export default function LocalVideoSettings({
  demo,
  notify,
  onReady,
}: {
  demo: boolean;
  notify: (s: string) => void;
  onReady: (v: boolean) => void;
}) {
  const [base, setBase] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [key, setKey] = useState("");
  const [clear, setClear] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (demo) return;
    let live = true;
    api<{ base_url: string; workflow: string; configured: boolean }>(
      "/local-video/settings",
    )
      .then((v) => {
        if (live) {
          setBase(v.base_url);
          setWorkflow(v.workflow);
          onReady(v.configured);
        }
      })
      .catch((e) => notify(e.message));
    return () => {
      live = false;
    };
  }, [demo, onReady]);
  if (demo)
    return (
      <div className="notice">
        本地 GPU 模式使用老师自己部署的 ComfyUI
        视频工作流。演示不保存地址或密钥，不连接外部算力。
      </div>
    );
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("/local-video/settings", {
            method: "PUT",
            body: JSON.stringify({
              base_url: base,
              workflow,
              api_key: key,
              clear_api_key: clear,
            }),
          });
          setKey("");
          setClear(false);
          onReady(true);
          notify(
            "本地算力配置已保存；请确保工作流已在 ComfyUI 中成功导出 MP4。",
          );
        } catch (e) {
          notify(e instanceof Error ? e.message : "保存失败");
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy}>
        <label>
          ComfyUI 服务地址
          <input
            value={base}
            onChange={(e) => {
              setBase(e.target.value);
              onReady(false);
            }}
            type="url"
            placeholder="http://学校GPU地址:8188"
            required
          />
        </label>
        <p className="subtle">
          地址须能从学校服务器访问。127.0.0.1
          指学校服务器，不是老师的浏览器电脑。部署 WAN 等视频模型与节点后，先在
          ComfyUI 验证工作流。
        </p>
        <label>
          API 工作流 JSON
          <textarea
            rows={8}
            value={workflow}
            onChange={(e) => {
              setWorkflow(e.target.value);
              onReady(false);
            }}
            required
            maxLength={200000}
            placeholder="粘贴 ComfyUI 导出的 API 格式工作流，将正向提示词替换为 __PROMPT__"
          />
        </label>
        <p className="subtle">
          工作流必须包含 __PROMPT__ 并输出
          MP4。可将完整数值占位符设为字符串：__FRAMES__（时长×16+1）、__FPS__（16）、__WIDTH__、__HEIGHT__、__DURATION__。模型、采样器等由你的工作流决定。
        </p>
        <label>
          本地服务 Bearer Key（可选）
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="无认证服务可留空；更换地址不沿用旧密钥"
            disabled={clear}
          />
        </label>
        <label className="seedance-consent">
          <input
            type="checkbox"
            checked={clear}
            onChange={(e) => setClear(e.target.checked)}
          />
          <span>清除本地服务密钥</span>
        </label>
        <button className="btn secondary">保存本地算力设置</button>
      </fieldset>
    </form>
  );
}
