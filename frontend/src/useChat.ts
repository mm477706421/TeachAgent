import { useCallback, useEffect, useRef, useState } from "react";
import { api, post, streamChat } from "./api";
import type { Lesson, Message, ModelSettings } from "./types";

type Pending = {
  controller: AbortController;
  id: string;
  started: boolean;
  stopping: boolean;
  stopTimer?: number;
};

function requestId() {
  // randomUUID is unavailable on plain HTTP school LAN hosts; getRandomValues works there.
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function useChat(
  lesson: Lesson,
  demo: boolean,
  notify: (s: string) => void,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [modelSettings, setModelSettings] = useState<ModelSettings | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const pending = useRef<Pending | null>(null);
  const remoteRunning = messages.some(
    (m) => m.status === "running" || m.status === "stopping",
  );
  const reload = useCallback(
    () => api<Message[]>(`/lessons/${lesson.id}/chat`),
    [lesson.id],
  );
  useEffect(() => {
    let active = true;
    setMessages([]);
    setModelSettings(null);
    setBusy(false);
    setStopping(false);
    if (!demo)
      Promise.all([reload(), api<ModelSettings>("/model-settings")])
        .then(([history, settings]) => {
          if (active) {
            setMessages(history);
            setModelSettings(settings);
          }
        })
        .catch((e) => {
          if (active) notify(e.message);
        });
    return () => {
      active = false;
      window.clearTimeout(pending.current?.stopTimer);
      pending.current?.controller.abort();
      pending.current = null;
    };
  }, [lesson.id, demo, reload]);
  // Another tab or a reloaded page may own the in-flight request.
  useEffect(() => {
    if (demo || busy || !remoteRunning) return;
    let active = true;
    const timer = window.setInterval(() => {
      reload()
        .then((history) => {
          if (active && !pending.current) setMessages(history);
        })
        .catch(() => {});
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [demo, busy, remoteRunning, reload]);

  async function send(text: string, retryMessage?: Message) {
    if (
      !text.trim() ||
      busy ||
      remoteRunning ||
      pending.current ||
      (!demo && !modelSettings)
    )
      return;
    const id = retryMessage?.request_id || requestId();
    const state: Pending = {
      controller: new AbortController(),
      id,
      started: false,
      stopping: false,
    };
    pending.current = state;
    setBusy(true);
    setStopping(false);
    const patch = (values: Partial<Message>) => {
      if (pending.current !== state) return;
      setMessages((rows) =>
        rows.map((m) => (m.request_id === id ? { ...m, ...values } : m)),
      );
    };
    const empty: Message = {
      role: "assistant",
      content: "",
      request_id: id,
      status: "running",
      attempt: retryMessage?.attempt || 1,
    };
    setMessages((rows) =>
      retryMessage
        ? rows.map((m) => (m.request_id === id ? empty : m))
        : [...rows, { role: "user", content: text }, empty],
    );
    let content = "";
    try {
      if (demo) {
        const s = lesson.analysis!.suggestions[0];
        const example = `### 课堂观察\n\n${s.evidence}\n\n### 可以尝试\n\n1. **调整教学活动**：${s.action}\n2. **回看证据**：对照片段 #${s.segment_id}，记录学生的回应，再决定下一步调整。\n\n> 这是合成课堂的示例回答。实际教研需结合完整原文与课堂情境判断。\n\n本地部署登录后，可配置 Ollama 或 OpenAI 兼容服务进行追问。`;
        const chars = Array.from(
          new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(
            example,
          ),
          (s) => s.segment,
        );
        for (let i = 0; i < chars.length; i += 5) {
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(new DOMException("Stopped", "AbortError"));
            };
            const timer = window.setTimeout(() => {
              state.controller.signal.removeEventListener("abort", abort);
              resolve();
            }, 40);
            state.controller.signal.addEventListener("abort", abort, {
              once: true,
            });
            if (state.controller.signal.aborted) abort();
          });
          content += chars.slice(i, i + 5).join("");
          patch({ content, engine: "demo" });
        }
        patch({ status: "completed" });
      } else {
        await streamChat(
          lesson.id,
          {
            message: text,
            request_id: id,
            retry: Boolean(retryMessage),
            expected_attempt: retryMessage?.attempt || 1,
          },
          state.controller.signal,
          (event) => {
            if (event.type === "start") {
              state.started = true;
              patch({ attempt: event.attempt });
            } else if (event.type === "delta") {
              content += event.content || "";
              patch({ content, engine: event.engine });
            } else {
              patch({
                content: event.content ?? content,
                engine: event.engine,
                status: event.status,
                error: event.error,
                attempt: event.attempt,
              });
            }
          },
        );
      }
    } catch (error) {
      patch({
        status: state.stopping ? "stopped" : "error",
        error: state.stopping
          ? null
          : error instanceof Error
            ? error.message
            : "生成失败，请重试。",
      });
      // Reconcile conflicts and a disconnect racing with successful persistence.
      if (!demo && !state.controller.signal.aborted) {
        try {
          const history = await reload();
          if (
            pending.current === state &&
            history.some((m) => m.request_id === id)
          ) {
            setMessages(history);
            notify(
              error instanceof Error ? error.message : "生成失败，请重试。",
            );
          }
        } catch {
          /* Keep the visible partial answer while offline. */
        }
      }
    } finally {
      window.clearTimeout(state.stopTimer);
      if (pending.current === state) {
        pending.current = null;
        setBusy(false);
        setStopping(false);
      }
    }
  }

  async function stop() {
    const state = pending.current;
    if (state?.stopping) return;
    if (state) state.stopping = true;
    setStopping(true);
    if (demo || (state && !state.started)) {
      state?.controller.abort();
      return;
    }
    const id =
      state?.id ||
      messages.find((m) => m.status === "running" || m.status === "stopping")
        ?.request_id;
    if (!id) {
      setStopping(false);
      return;
    }
    const timer = window.setTimeout(() => state?.controller.abort(), 3000);
    if (state) state.stopTimer = timer;
    try {
      await post(`/lessons/${lesson.id}/chat/${id}/stop`);
      if (!state) setMessages(await reload());
    } catch (error) {
      if (state) state.controller.abort();
      else
        notify(error instanceof Error ? error.message : "停止失败，请重试。");
    } finally {
      // Keep the timeout until the stream acknowledges the stop, even if POST succeeds.
      if (!state || pending.current !== state) window.clearTimeout(timer);
      if (!state) setStopping(false);
    }
  }
  return {
    messages,
    modelSettings,
    busy: busy || remoteRunning,
    stopping,
    send,
    stop,
  };
}
