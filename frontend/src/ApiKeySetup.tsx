import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowUpRight,
  CircleNotch,
  Key,
  ShieldCheck,
} from "@phosphor-icons/react";
import { api, post } from "./api";
import presets from "./model-presets.json";
import "./api-key-setup.css";

export const SEEDANCE_APPLY_URL =
  "https://ark.volcengine.com/region:cn-beijing/apiKey";
const skipKey = (userId: string) => `teachagent:api-setup-skipped:${userId}`;
export function resetApiSetupPrompt(userId: string) {
  try {
    sessionStorage.removeItem(skipKey(userId));
  } catch {
    /* Storage can be disabled. */
  }
}

export default function ApiKeySetup({
  userId,
  onSaved,
}: {
  userId: string;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [checkError, setCheckError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState("seedance");
  const [presetId, setPresetId] = useState("deepseek");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [key, setKey] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = presets.find((p) => p.id === presetId);
  const applyUrl =
    kind === "seedance" ? SEEDANCE_APPLY_URL : selected?.apply_url;
  const providerName =
    kind === "seedance" ? "火山方舟" : selected?.name || "自定义服务";

  useEffect(() => {
    try {
      if (sessionStorage.getItem(skipKey(userId))) return;
    } catch {
      /* Optional preference. */
    }
    let active = true;
    setCheckError("");
    api<{ needs_api_key: boolean }>("/model-settings/onboarding")
      .then((result) => {
        if (active) setOpen(result.needs_api_key === true);
      })
      .catch(() => {
        if (active) {
          setCheckError("暂时无法检查模型配置，请重试或稍后配置。");
          setOpen(true);
        }
      });
    return () => {
      active = false;
    };
  }, [userId, attempt]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const current = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    current?.showModal();
    return () => {
      current?.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  function skip() {
    if (busy) return;
    try {
      sessionStorage.setItem(skipKey(userId), "1");
    } catch {
      /* Optional preference. */
    }
    setKey("");
    setOpen(false);
  }
  function choose(nextKind: string, nextPreset = presetId) {
    setKind(nextKind);
    setPresetId(nextPreset);
    const preset = presets.find((p) => p.id === nextPreset);
    setModel(nextKind === "seedance" ? "" : preset?.model || "");
    setBaseUrl(preset?.base_url || "https://api.openai.com/v1");
    setKey("");
    setConsent(false);
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !key.trim() || !consent) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "seedance") {
        await post("/seedance/settings/verify-and-save", {
          model: model.trim(),
          api_key: key.trim(),
        });
      } else {
        await post("/model-settings/verify-and-save", {
          provider: "openai",
          preset_id:
            selected && model.trim() === selected.model ? presetId : "custom",
          base_url: baseUrl.trim(),
          model: model.trim(),
          api_key: key.trim(),
          allow_external: true,
          timeout_seconds: 30,
        });
      }
      setKey("");
      setOpen(false);
      onSaved();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "测试未通过，配置尚未保存，请检查后重试。",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!open) return null;
  return (
    <dialog
      ref={dialog}
      className="modal api-key-setup"
      aria-labelledby="api-key-setup-title"
      aria-describedby="api-key-setup-description"
      onCancel={(e) => {
        e.preventDefault();
        skip();
      }}
    >
      <header>
        <div className="api-key-setup-icon">
          <Key size={28} weight="duotone" />
        </div>
        <div>
          <span className="eyebrow">连接你的 AI 服务</span>
          <h2 id="api-key-setup-title">配置你的 API Key</h2>
        </div>
      </header>
      <p id="api-key-setup-description" className="api-key-setup-description">
        {checkError
          ? "连接你的 AI 服务，配置会独立保存在当前账号。"
          : "当前账号尚未配置 API Key。先连接一个服务，即可开始生成教学视频或使用在线教研助手。"}
      </p>
      {checkError ? (
        <div>
          <p className="error-text" role="alert">
            {checkError}
          </p>
          <button
            className="btn primary"
            onClick={() => setAttempt((n) => n + 1)}
          >
            重新检查配置
          </button>
        </div>
      ) : (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            <label>
              配置用途
              <select value={kind} onChange={(e) => choose(e.target.value)}>
                <option value="seedance">教学视频生成 · Seedance</option>
                <option value="chat">在线教研助手 · 兼容模型</option>
              </select>
            </label>
            {kind === "chat" && (
              <label>
                服务商
                <select
                  value={presetId}
                  onChange={(e) => choose("chat", e.target.value)}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value="custom">自定义 OpenAI 兼容服务</option>
                </select>
              </label>
            )}
            <div className="api-key-apply">
              <div>
                <strong>还没有 API Key？</strong>
                <p>前往{providerName}申请后，返回此处填写。</p>
              </div>
              {applyUrl ? (
                <a href={applyUrl} target="_blank" rel="noopener noreferrer">
                  申请 API Key <ArrowUpRight size={16} />
                </a>
              ) : (
                <span className="subtle">请向服务提供方或学校管理员申请</span>
              )}
            </div>
            {kind === "chat" && !selected && (
              <label>
                API 服务地址
                <input
                  type="url"
                  required
                  maxLength={2048}
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setError("");
                  }}
                  placeholder="https://api.example.com/v1"
                />
              </label>
            )}
            <label>
              {kind === "seedance" ? "Seedance 模型 ID" : "模型 ID"}
              <input
                required
                maxLength={kind === "seedance" ? 160 : 200}
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setError("");
                }}
                placeholder={
                  kind === "seedance"
                    ? "填写方舟控制台已开通的模型 ID"
                    : "填写服务支持的模型名称"
                }
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                required
                maxLength={8192}
                autoComplete="new-password"
                spellCheck={false}
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setError("");
                }}
                placeholder="粘贴你的 API Key"
              />
            </label>
            <label className="checkbox-label api-key-setup-consent">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {kind === "seedance"
                  ? "同意向火山方舟验证密钥。测试只查询任务列表，不生成视频；模型生成权限与额度以方舟控制台为准。"
                  : "同意发送固定测试语句，可能产生少量费用。启用后，教研追问会将课堂文本上下文发送至所选服务。"}
              </span>
            </label>
            <p className="api-key-security">
              <ShieldCheck size={17} /> 验证通过后加密保存，仅用于当前账号。
            </p>
            {error && (
              <p className="error-text" role="alert">
                {error} 配置未保存，请修改后重试。
              </p>
            )}
            <button
              className="btn primary api-key-save"
              type="submit"
              disabled={busy || !key.trim() || !model.trim() || !consent}
            >
              {busy ? (
                <>
                  <CircleNotch className="spin" size={18} /> 正在测试并保存…
                </>
              ) : (
                "测试并保存 API Key"
              )}
            </button>
            <p className="api-key-progress" role="status" aria-live="polite">
              {busy
                ? "正在连接所选服务，请稍候。测试失败不会覆盖已有配置。"
                : ""}
            </p>
          </fieldset>
        </form>
      )}
      <button
        className="api-key-skip"
        type="button"
        disabled={busy}
        onClick={skip}
      >
        稍后配置
      </button>
    </dialog>
  );
}
