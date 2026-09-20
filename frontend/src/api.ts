import { STATIC_DEMO } from "./runtime";

function requireLocalDeployment() {
  if (STATIC_DEMO)
    throw new Error("在线演示不连接课堂服务，请使用学校本地部署。");
}

let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  requireLocalDeployment();
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      "X-CSRF-Token": csrf,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ detail: "请求失败，请稍后重试" }));
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "输入内容不符合要求，请检查后重试",
    );
  }
  return response.json();
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });

export type ChatEvent = {
  type: "start" | "delta" | "done";
  content?: string;
  engine?: string;
  request_id?: string;
  attempt?: number;
  status?: import("./types").Message["status"];
  error?: string;
};

export async function streamChat(
  lessonId: string,
  body: {
    message: string;
    request_id: string;
    retry: boolean;
    expected_attempt: number;
  },
  signal: AbortSignal,
  onEvent: (event: ChatEvent) => void,
) {
  requireLocalDeployment();
  const response = await fetch(`/api/lessons/${lessonId}/chat/stream`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "无法开始生成，请刷新后重试。",
    );
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error("服务器未返回流式回答，请检查部署配置。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "",
    data: string[] = [],
    done = false;
  try {
    while (!done) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (line.startsWith("data:"))
          data.push(line.slice(5).replace(/^ /, ""));
        if (!line && data.length) {
          const event: ChatEvent = JSON.parse(data.join("\n"));
          data = [];
          if (!["start", "delta", "done"].includes(event.type))
            throw new Error("流式事件格式无效。");
          onEvent(event);
          if (event.type === "done") {
            done = true;
            break;
          }
        }
      }
      if (chunk.done) break;
    }
    if (!done) throw new Error("连接已中断，回答尚未完成，可重试此问题。");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function upload(
  form: FormData,
  progress: (percent: number) => void,
): Promise<import("./types").Lesson> {
  requireLocalDeployment();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/lessons/upload");
    xhr.setRequestHeader("X-CSRF-Token", csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let body;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("服务器未返回有效结果"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else
        reject(
          new Error(typeof body.detail === "string" ? body.detail : "上传失败"),
        );
    };
    xhr.onerror = () => reject(new Error("连接中断，请检查内网连接"));
    xhr.send(form);
  });
}
export async function download(path: string, fallback: string) {
  requireLocalDeployment();
  const response = await fetch("/api" + path);
  if (!response.ok) {
    const b = await response.json().catch(() => ({ detail: "下载失败" }));
    throw new Error(b.detail);
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download =
    response.headers
      .get("content-disposition")
      ?.match(/filename="([^"]+)"/)?.[1] || fallback;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
