import { useEffect, useState } from "react";
import {
  CircleNotch,
  PlugsConnected,
  ShieldCheck,
} from "@phosphor-icons/react";
import { api, post } from "./api";
import type { ModelSettings } from "./types";

const defaults: ModelSettings = {
  provider: "local",
  base_url: "https://api.openai.com/v1",
  model: "",
  api_key_configured: false,
  allow_external: false,
  timeout_seconds: 60,
  temperature: 0.3,
  max_tokens: 900,
  local_model: "本机 Ollama",
};

export default function ModelSettingsPanel({
  demo,
  onSaved,
}: {
  demo: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<ModelSettings>(defaults);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [savedBase, setSavedBase] = useState(defaults.base_url);
  const [loading, setLoading] = useState(!demo);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [ready, setReady] = useState(demo);
  useEffect(() => {
    if (demo) return;
    let active = true;
    api<ModelSettings>("/model-settings")
      .then((data) => {
        if (active) {
          setValue(data);
          setSavedBase(data.base_url);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [demo]);
  function change<K extends keyof ModelSettings>(
    field: K,
    next: ModelSettings[K],
  ) {
    setValue((v) => ({ ...v, [field]: next }));
    setResult("");
    setError("");
  }
  async function execute(action: "save" | "test") {
    if (demo) return;
    setBusy(action);
    setResult("");
    setError("");
    const {
      api_key_configured: _configured,
      local_model: _local,
      ...settings
    } = value;
    const payload = {
      ...settings,
      ...(key.trim() ? { api_key: key.trim() } : {}),
      clear_api_key: clearKey,
    };
    try {
      if (action === "save") {
        const data = await api<ModelSettings>("/model-settings", {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setValue(data);
        setSavedBase(data.base_url);
        setKey("");
        setClearKey(false);
        setResult("设置已保存，仅作用于当前账号。下一次教研追问将使用此配置。");
        onSaved();
      } else {
        const data = await post<{ message: string; latency_ms: number }>(
          "/model-settings/test",
          payload,
        );
        setResult(`${data.message}（${data.latency_ms} ms）`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "模型配置操作失败");
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel model-settings">
      <div className="panel-inner">
        <div className="section-heading">
          <div>
            <h2>
              <PlugsConnected size={21} />
              模型服务设置
            </h2>
            <p>
              按账号独立配置，仅用于教研追问；基础课堂分析与语音转写始终在本地。
            </p>
          </div>
          <span className="badge green">账号独立</span>
        </div>
        {demo && (
          <div className="notice">
            这里可预览设置项。GitHub Pages / 示例模式不接收 API
            Key，不连接模型；请在本地部署中登录后配置。
          </div>
        )}
        {loading ? (
          <p className="subtle">正在读取模型设置…</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              execute("save");
            }}
          >
            <fieldset disabled={!!busy || !ready} className="model-fieldset">
              <label>
                模型提供方式
                <select
                  value={value.provider}
                  onChange={(e) =>
                    change(
                      "provider",
                      e.target.value as ModelSettings["provider"],
                    )
                  }
                >
                  <option value="local">本机 Ollama（默认）</option>
                  <option value="rules">本地规则建议（无模型请求）</option>
                  <option value="openai">OpenAI 兼容服务</option>
                </select>
              </label>
              {value.provider === "openai" ? (
                <>
                  <div className="form-grid">
                    <label>
                      Base URL
                      <input
                        type="url"
                        value={value.base_url}
                        onChange={(e) => change("base_url", e.target.value)}
                        required
                        maxLength={2048}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                    <label>
                      模型 ID
                      <input
                        value={value.model}
                        onChange={(e) => change("model", e.target.value)}
                        required
                        maxLength={200}
                        placeholder="填写服务商支持的模型名"
                      />
                    </label>
                  </div>
                  <p className="subtle">
                    填写 API 前缀（通常含 /v1），系统调用
                    /chat/completions。在线地址需 HTTPS，本机回环地址支持 HTTP。
                  </p>
                  {demo ? (
                    <div className="privacy-note">
                      <ShieldCheck size={21} />
                      <p>
                        <strong>API Key 仅在本地部署中设置</strong>
                        <span>公开演示不读取、不保存密钥。</span>
                      </p>
                    </div>
                  ) : (
                    <>
                      <label>
                        API Key
                        <input
                          type="password"
                          value={key}
                          onChange={(e) => {
                            setKey(e.target.value);
                            setClearKey(false);
                            setResult("");
                          }}
                          maxLength={8192}
                          autoComplete="new-password"
                          spellCheck={false}
                          placeholder={
                            value.api_key_configured
                              ? "已保存；留空保留，不会回显密钥"
                              : "可选：免鉴权的兼容服务可留空"
                          }
                        />
                      </label>
                      {value.api_key_configured && (
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={clearKey}
                            onChange={(e) => {
                              setClearKey(e.target.checked);
                              setKey("");
                              setResult("");
                            }}
                          />
                          <span>清除已保存的 API Key</span>
                        </label>
                      )}
                      {value.api_key_configured &&
                        value.base_url !== savedBase && (
                          <p className="subtle">
                            修改服务地址后旧密钥不会沿用，请按需填写新密钥。
                          </p>
                        )}
                    </>
                  )}
                  <div className="model-parameters">
                    <label>
                      超时（秒）
                      <input
                        type="number"
                        min={5}
                        max={120}
                        required
                        value={value.timeout_seconds}
                        onChange={(e) =>
                          change("timeout_seconds", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      温度
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        required
                        value={value.temperature}
                        onChange={(e) =>
                          change("temperature", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      输出 token 上限
                      <input
                        type="number"
                        min={128}
                        max={4096}
                        required
                        value={value.max_tokens}
                        onChange={(e) =>
                          change("max_tokens", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <div className="notice model-consent">
                    <strong>启用后的数据流向</strong>
                    <p>
                      追问时将把本课摘要、指标、建议、前 100 个转写片段、最近 8
                      条对话及当前问题发送到上述服务。不会发送视频、音频或抽帧。连接测试只发送固定测试语句，可能产生少量服务费用。
                    </p>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={value.allow_external}
                        onChange={(e) =>
                          change("allow_external", e.target.checked)
                        }
                        required
                      />
                      <span>我确认允许向配置的服务发送上述课堂文本上下文</span>
                    </label>
                  </div>
                </>
              ) : (
                <div className="privacy-note">
                  <ShieldCheck size={21} />
                  <p>
                    <strong>
                      {value.provider === "rules"
                        ? "全程使用本地规则"
                        : `本机模型：${value.local_model}`}
                    </strong>
                    <span>
                      {value.provider === "rules"
                        ? "不向模型服务发起请求，提供可回溯的文本建议。"
                        : "只连接本机回环地址；Ollama 不可用时明确使用本地规则建议。"}
                    </span>
                  </p>
                </div>
              )}
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              {result && (
                <p className="model-result" role="status">
                  {result}
                </p>
              )}
              <div className="button-row model-actions">
                <button
                  className="btn primary"
                  type="submit"
                  disabled={!!busy || demo}
                >
                  {busy === "save" && <CircleNotch className="spin" />}
                  保存模型设置
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  disabled={!!busy || demo}
                  onClick={(e) => {
                    if (e.currentTarget.form?.reportValidity()) execute("test");
                  }}
                >
                  {busy === "test" ? (
                    <CircleNotch className="spin" />
                  ) : (
                    <PlugsConnected />
                  )}
                  测试连接
                </button>
              </div>
            </fieldset>
          </form>
        )}
        {!loading && !ready && (
          <p className="error-text" role="alert">
            {error} 请刷新页面后重试。
          </p>
        )}
      </div>
    </section>
  );
}
